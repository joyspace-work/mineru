from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
import csv
import json
import os
import queue
import shutil
import signal
import sqlite3
import subprocess
import sys
import threading
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from dotenv import load_dotenv

from .gemini_extract import default_prompt_template
from .pipeline import PROJECT_ROOT


GUI_INPUT_ROOT = PROJECT_ROOT / "input" / "gui_current"


FILE_TYPE_EXTENSIONS: dict[str, set[str]] = {
    "images": {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".svg"},
    "pdfs": {".pdf"},
    "excels": {".xlsx", ".xls", ".csv"},
    "documents": {".docx", ".doc", ".rtf"},
    "presentations": {".pptx", ".ppt"},
    "texts": {".txt", ".md"},
}

PROVIDER_DEFAULTS = {
    "deepseek": {
        "api_key_var": "DEEPSEEK_API_KEY",
        "model_var": "DEEPSEEK_SOURCE_IMPORT_MODEL",
        "base_url_var": "DEEPSEEK_BASE_URL",
        "model": "deepseek-v4-pro",
        "base_url": "https://api.deepseek.com",
    },
    "openrouter": {
        "api_key_var": "OPENROUTER_API_KEY",
        "model_var": "OPENROUTER_SOURCE_IMPORT_MODEL",
        "base_url_var": "OPENROUTER_BASE_URL",
        "model": "nvidia/nemotron-3-ultra-550b-a55b:free",
        "base_url": "https://openrouter.ai/api/v1",
    },
    "gemini": {
        "api_key_var": "GEMINI_API_KEY",
        "model_var": "GEMINI_SOURCE_IMPORT_MODEL",
        "base_url_var": "",
        "model": "gemini-3.5-flash",
        "base_url": "",
    },
}


@dataclass
class RunOptions:
    provider: str
    api_key: str
    model: str
    base_url: str
    backend: str = "hybrid-engine"
    effort: str = "medium"
    method: str = "ocr"
    confidence_threshold: str = "0.6"
    prompt_template: str = ""


def selected_extensions(selected_types: list[str]) -> set[str]:
    if not selected_types:
        return {ext for extensions in FILE_TYPE_EXTENSIONS.values() for ext in extensions}
    extensions: set[str] = set()
    for file_type in selected_types:
        extensions.update(FILE_TYPE_EXTENSIONS.get(file_type, set()))
    return extensions


def provider_environment(options: RunOptions) -> dict[str, str]:
    provider = options.provider.lower()
    defaults = PROVIDER_DEFAULTS[provider]
    env = {
        "AI_PROVIDER": provider,
        defaults["api_key_var"]: options.api_key,
        defaults["model_var"]: options.model,
        "MINERU_BACKEND": options.backend,
        "MINERU_EFFORT": options.effort,
        "MINERU_METHOD": options.method,
        "MINERU_CONFIDENCE_THRESHOLD": options.confidence_threshold,
        "LLM_PROMPT_TEMPLATE": options.prompt_template,
    }
    if defaults["base_url_var"]:
        env[defaults["base_url_var"]] = options.base_url
    return {key: value for key, value in env.items() if value not in (None, "")}


def build_pipeline_command(
    action: str,
    options: RunOptions,
    *,
    dry_run: bool = False,
    force_ocr: bool = True,
    ocr_output: Path | None = None,
    raw_candidates: Path | None = None,
) -> list[str]:
    command = [sys.executable, "-m", "mineru_pipeline", "--action", action]
    if dry_run:
        command.append("--dry-run")
    if ocr_output:
        command.extend(["--ocr-output", str(ocr_output)])
    if raw_candidates:
        command.extend(["--raw-candidates", str(raw_candidates)])
    if action in {"run", "recognize"} and force_ocr:
        command.append("--force-ocr")
    if action in {"run", "recognize"}:
        command.extend(["--backend", options.backend, "--effort", options.effort, "--method", options.method])
    return command


def iter_selected_files(source_path: Path, selected_types: list[str]) -> list[Path]:
    extensions = selected_extensions(selected_types)
    if source_path.is_file():
        return [source_path] if source_path.suffix.lower() in extensions else []
    if source_path.is_dir():
        return sorted(path for path in source_path.rglob("*") if path.is_file() and path.suffix.lower() in extensions)
    return []


def stage_selected_input(
    source: str,
    selected_types: list[str],
    input_dir: Path = GUI_INPUT_ROOT,
    batch_name: str | None = None,
) -> tuple[Path, int]:
    input_dir = input_dir.resolve()
    if input_dir.exists():
        shutil.rmtree(input_dir)
    input_dir.mkdir(parents=True, exist_ok=True)
    if not source:
        return input_dir, 0
    source_path = Path(source).expanduser().resolve()
    files = iter_selected_files(source_path, selected_types)
    if not files:
        return input_dir, 0
    try:
        source_path.relative_to(input_dir.resolve())
        return input_dir, len(files)
    except ValueError:
        pass
    batch = batch_name or datetime.now().strftime("gui_%Y%m%d_%H%M%S")
    target_root = input_dir / batch
    for file_path in files:
        relative = file_path.name if source_path.is_file() else file_path.relative_to(source_path)
        target = target_root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(file_path, target)
    return input_dir, len(files)


def safe_relative(path: Path, root: Path = PROJECT_ROOT) -> str:
    try:
        return str(path.relative_to(root))
    except ValueError:
        return str(path)


def newest_files(root: Path, patterns: tuple[str, ...], limit: int = 80) -> list[Path]:
    if not root.exists():
        return []
    files: list[Path] = []
    for pattern in patterns:
        files.extend(path for path in root.rglob(pattern) if path.is_file())
    return sorted(set(files), key=lambda path: path.stat().st_mtime, reverse=True)[:limit]


def recognized_manifest_files(root: Path = PROJECT_ROOT / "output" / "recognized" / "mineru") -> list[Path]:
    manifest = root / "manifest.json"
    errors = root / "errors.json"
    if not manifest.exists():
        return newest_files(root, ("*.md", "*.json"), 120)
    try:
        data = json.loads(manifest.read_text("utf-8"))
    except json.JSONDecodeError:
        return [manifest]
    files: list[Path] = []
    for item in data.get("files") or []:
        if not isinstance(item, dict) or not item.get("output_path"):
            continue
        output_path = Path(item["output_path"])
        if output_path.exists():
            files.append(output_path)
            files.extend(path for path in output_path.parent.glob("*.json") if path.is_file())
    if files:
        return sorted(set(files), key=lambda path: path.stat().st_mtime, reverse=True)
    empty_run_files = [path for path in (manifest, errors) if path.exists()]
    return empty_run_files


def read_text_preview(path: Path, limit: int = 6000) -> str:
    if path.suffix.lower() in {".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff"}:
        return f"{safe_relative(path)}\n\nBinary file preview is not available here."
    text = path.read_text("utf-8", errors="replace")
    return text[:limit] + ("\n\n... preview truncated ..." if len(text) > limit else "")


def summarize_llm_raw(path: Path) -> str:
    data = json.loads(path.read_text("utf-8"))
    api_response = data.get("api_response") or {}
    choice = (api_response.get("choices") or [{}])[0]
    usage = api_response.get("usage") or {}
    lines = [
        f"file: {safe_relative(path)}",
        f"provider: {data.get('provider')}",
        f"candidate_count: {data.get('candidate_count')}",
        f"finish_reason: {choice.get('finish_reason')}",
        f"completion_tokens: {usage.get('completion_tokens')}",
        f"prompt_hash: {data.get('prompt_hash')}",
        "",
        "raw_message_text:",
        str(data.get("raw_message_text") or "")[:5000],
    ]
    return "\n".join(lines)


def summarize_candidates(path: Path) -> str:
    data = json.loads(path.read_text("utf-8"))
    rows = data if isinstance(data, list) else []
    brands: dict[str, int] = {}
    sources: dict[str, int] = {}
    stock_sum = 0
    for row in rows:
        if not isinstance(row, dict):
            continue
        brand = str(row.get("brand") or "")
        source = str(row.get("source_file") or "")
        brands[brand] = brands.get(brand, 0) + 1
        sources[source] = sources.get(source, 0) + 1
        stock_sum += int(row.get("stock_quantity") or 0)
    lines = [
        f"file: {safe_relative(path)}",
        f"candidate_count: {len(rows)}",
        f"stock_sum: {stock_sum}",
        "",
        "top brands:",
        *[f"  {name}: {count}" for name, count in sorted(brands.items(), key=lambda item: item[1], reverse=True)[:12]],
        "",
        "top sources:",
        *[f"  {name}: {count}" for name, count in sorted(sources.items(), key=lambda item: item[1], reverse=True)[:12]],
        "",
        "preview:",
        json.dumps(rows[:3], ensure_ascii=False, indent=2),
    ]
    return "\n".join(lines)


def summarize_csv(path: Path) -> str:
    with path.open("r", encoding="utf-8", newline="") as handle:
        rows = list(csv.reader(handle))
    preview = rows[:8]
    return "\n".join([
        f"file: {safe_relative(path)}",
        f"row_count: {max(0, len(rows) - 1)}",
        "",
        *[" | ".join(row) for row in preview],
    ])


def sqlite_status(db_path: Path = PROJECT_ROOT / "local_source.db") -> str:
    if not db_path.exists():
        return "local_source.db does not exist."
    db = sqlite3.connect(db_path)
    db.row_factory = sqlite3.Row
    try:
        total = db.execute("SELECT count(*) FROM source_candidates").fetchone()[0]
        statuses = [dict(row) for row in db.execute("SELECT status, count(*) AS count FROM source_candidates GROUP BY status").fetchall()]
        latest = [dict(row) for row in db.execute(
            "SELECT id, brand, model, stock_quantity, status, created_at FROM source_candidates ORDER BY id DESC LIMIT 10"
        ).fetchall()]
    finally:
        db.close()
    return "\n".join([
        f"local_source.db: {db_path}",
        f"total: {total}",
        f"status_counts: {json.dumps(statuses, ensure_ascii=False)}",
        "",
        json.dumps(latest, ensure_ascii=False, indent=2),
    ])


class PipelineGui:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("MinerU 车源导入")
        self.root.geometry("1180x820")
        self.output_queue: queue.Queue[str | None] = queue.Queue()
        self.process: subprocess.Popen[str] | None = None

        load_dotenv(PROJECT_ROOT / ".env", override=False)

        self.source_path = tk.StringVar()
        self.provider = tk.StringVar(value=os.getenv("AI_PROVIDER", "deepseek"))
        self.api_key = tk.StringVar()
        self.model = tk.StringVar()
        self.base_url = tk.StringVar()
        self.backend = tk.StringVar(value=os.getenv("MINERU_BACKEND", "hybrid-engine") or "hybrid-engine")
        self.effort = tk.StringVar(value=os.getenv("MINERU_EFFORT", "medium") or "medium")
        self.method = tk.StringVar(value=os.getenv("MINERU_METHOD", "ocr") or "ocr")
        self.confidence_threshold = tk.StringVar(value=os.getenv("MINERU_CONFIDENCE_THRESHOLD", "0.6") or "0.6")
        self.file_type_vars = {name: tk.BooleanVar(value=False) for name in FILE_TYPE_EXTENSIONS}

        self._build_layout()
        self._refresh_provider_fields()
        self.source_path.trace_add("write", lambda *_args: self._refresh_source_labels())
        self.root.after(150, self._drain_output)

    def _build_layout(self) -> None:
        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(2, weight=1)

        top = ttk.Frame(self.root, padding=12)
        top.grid(row=0, column=0, sticky="ew")
        top.columnconfigure(1, weight=1)

        ttk.Label(top, text="输入").grid(row=0, column=0, sticky="w")
        ttk.Entry(top, textvariable=self.source_path).grid(row=0, column=1, sticky="ew", padx=8)
        ttk.Button(top, text="选择文件", command=self._choose_file).grid(row=0, column=2, padx=4)
        ttk.Button(top, text="选择文件夹", command=self._choose_folder).grid(row=0, column=3)

        type_frame = ttk.LabelFrame(self.root, text="文件类型（不选则自动匹配）", padding=12)
        type_frame.grid(row=1, column=0, sticky="ew", padx=12)
        for index, name in enumerate(FILE_TYPE_EXTENSIONS):
            ttk.Checkbutton(type_frame, text=name, variable=self.file_type_vars[name]).grid(row=0, column=index, padx=6, sticky="w")

        main = ttk.PanedWindow(self.root, orient=tk.HORIZONTAL)
        main.grid(row=2, column=0, sticky="nsew", padx=12, pady=12)

        controls = ttk.Frame(main, padding=10)
        controls.columnconfigure(1, weight=1)
        main.add(controls, weight=1)

        self.tabs = ttk.Notebook(main)
        main.add(self.tabs, weight=2)

        row = 0
        ttk.Label(controls, text="MinerU 后端").grid(row=row, column=0, sticky="w", pady=4)
        ttk.Combobox(controls, textvariable=self.backend, values=["hybrid-engine", "pipeline", "vlm-engine", "vlm-http-client", "hybrid-http-client"], state="readonly").grid(row=row, column=1, sticky="ew", pady=4)
        row += 1
        ttk.Label(controls, text="推理强度").grid(row=row, column=0, sticky="w", pady=4)
        ttk.Combobox(controls, textvariable=self.effort, values=["medium", "high"], state="readonly").grid(row=row, column=1, sticky="ew", pady=4)
        row += 1
        ttk.Label(controls, text="解析方法").grid(row=row, column=0, sticky="w", pady=4)
        ttk.Combobox(controls, textvariable=self.method, values=["ocr", "auto", "txt"], state="readonly").grid(row=row, column=1, sticky="ew", pady=4)
        row += 1
        ttk.Label(controls, text="置信度报警 <").grid(row=row, column=0, sticky="w", pady=4)
        ttk.Entry(controls, textvariable=self.confidence_threshold, width=12).grid(row=row, column=1, sticky="ew", pady=4)
        row += 1

        ttk.Separator(controls).grid(row=row, column=0, columnspan=2, sticky="ew", pady=10)
        row += 1

        ttk.Label(controls, text="LLM 服务").grid(row=row, column=0, sticky="w", pady=4)
        provider_box = ttk.Combobox(controls, textvariable=self.provider, values=["deepseek", "openrouter", "gemini"], state="readonly")
        provider_box.grid(row=row, column=1, sticky="ew", pady=4)
        provider_box.bind("<<ComboboxSelected>>", lambda _event: self._refresh_provider_fields())
        row += 1
        ttk.Label(controls, text="API Key").grid(row=row, column=0, sticky="w", pady=4)
        ttk.Entry(controls, textvariable=self.api_key, show="*").grid(row=row, column=1, sticky="ew", pady=4)
        row += 1
        ttk.Label(controls, text="模型").grid(row=row, column=0, sticky="w", pady=4)
        ttk.Entry(controls, textvariable=self.model).grid(row=row, column=1, sticky="ew", pady=4)
        row += 1
        self.base_url_label = ttk.Label(controls, text="Base URL")
        self.base_url_entry = ttk.Entry(controls, textvariable=self.base_url)
        self.base_url_label.grid(row=row, column=0, sticky="w", pady=4)
        self.base_url_entry.grid(row=row, column=1, sticky="ew", pady=4)
        row += 1

        ttk.Separator(controls).grid(row=row, column=0, columnspan=2, sticky="ew", pady=10)
        row += 1

        buttons = [
            ("运行（dry-run）", lambda: self._start("run", dry_run=True)),
            ("中停", self._stop),
            ("识别层", lambda: self._start("recognize")),
            ("转化层", lambda: self._start("extract")),
            ("汇总层", lambda: self._start("aggregate")),
            ("一键图片到飞书", lambda: self._start("run", dry_run=False)),
        ]
        for label, command in buttons:
            ttk.Button(controls, text=label, command=command).grid(row=row, column=0, columnspan=2, sticky="ew", pady=4)
            row += 1

        settings_tab = ttk.Frame(self.tabs, padding=10)
        settings_tab.rowconfigure(1, weight=1)
        settings_tab.columnconfigure(0, weight=1)
        self.tabs.add(settings_tab, text="① 设置/提示词")

        ttk.Label(settings_tab, text="提示词模板（支持 {supplier_name}、{mode}、{text} 占位符）").grid(row=0, column=0, sticky="w")
        self.prompt_text = tk.Text(settings_tab, wrap="word", height=24, undo=True)
        self.prompt_text.grid(row=1, column=0, sticky="nsew", pady=(6, 0))
        self.prompt_text.insert("1.0", default_prompt_template())

        self.layer_lists: dict[str, tk.Listbox] = {}
        self.layer_previews: dict[str, tk.Text] = {}
        self.layer_paths: dict[str, list[Path]] = {}
        self._build_layer_tab(self.tabs, "recognition", "② 识别层：MinerU输出")
        self._build_layer_tab(self.tabs, "transformation", "③ 转化层：LLM输出")
        self._build_layer_tab(self.tabs, "aggregation", "④ 汇总层：最终结果")
        self.tabs.select(1)

        log_frame = ttk.LabelFrame(self.root, text="运行日志", padding=8)
        log_frame.grid(row=3, column=0, sticky="nsew", padx=12, pady=(0, 12))
        log_frame.rowconfigure(0, weight=1)
        log_frame.columnconfigure(0, weight=1)
        self.log_text = tk.Text(log_frame, height=10, wrap="word", state="disabled")
        self.log_text.grid(row=0, column=0, sticky="nsew")

        self.refresh_layer_views()

    def _build_layer_tab(self, tabs: ttk.Notebook, key: str, title: str) -> None:
        tab = ttk.Frame(tabs, padding=10)
        tab.columnconfigure(0, weight=1)
        tab.columnconfigure(1, weight=2)
        tab.rowconfigure(2, weight=1)
        tabs.add(tab, text=title)

        ttk.Label(tab, textvariable=self._layer_input_variable(key)).grid(row=0, column=0, columnspan=2, sticky="ew")
        ttk.Label(tab, text="左侧是该层输出文件列表；点击文件后，右侧显示预览或摘要。").grid(row=1, column=0, columnspan=2, sticky="w", pady=(8, 2))
        ttk.Button(tab, text="刷新本层结果", command=self.refresh_layer_views).grid(row=2, column=0, sticky="w", pady=(4, 6))

        listbox = tk.Listbox(tab, exportselection=False)
        listbox.grid(row=3, column=0, sticky="nsew", padx=(0, 8))
        preview = tk.Text(tab, wrap="word", state="disabled")
        preview.grid(row=3, column=1, sticky="nsew")
        listbox.bind("<<ListboxSelect>>", lambda _event, layer=key: self._show_selected_layer_file(layer))
        self.layer_lists[key] = listbox
        self.layer_previews[key] = preview
        self.layer_paths[key] = []

    def _layer_input_variable(self, key: str) -> tk.StringVar:
        if not hasattr(self, "layer_input_vars"):
            self.layer_input_vars = {
                "recognition": tk.StringVar(),
                "transformation": tk.StringVar(),
                "aggregation": tk.StringVar(),
            }
        return self.layer_input_vars[key]

    def _refresh_provider_fields(self) -> None:
        provider = self.provider.get().lower()
        defaults = PROVIDER_DEFAULTS[provider]
        self.api_key.set(os.getenv(defaults["api_key_var"], ""))
        self.model.set(os.getenv(defaults["model_var"], defaults["model"]))
        self.base_url.set(os.getenv(defaults["base_url_var"], defaults["base_url"]) if defaults["base_url_var"] else "")
        if defaults["base_url_var"]:
            self.base_url_label.grid()
            self.base_url_entry.grid()
        else:
            self.base_url_label.grid_remove()
            self.base_url_entry.grid_remove()

    def refresh_layer_views(self) -> None:
        self._refresh_source_labels()
        self.layer_input_vars["transformation"].set(
            f"输入：MinerU manifest 和 Markdown；目录：{safe_relative(PROJECT_ROOT / 'output' / 'recognized' / 'mineru')}"
        )
        self.layer_input_vars["aggregation"].set(
            f"输入：LLM raw candidates / Excel parsed；输出：final JSON/CSV、local_source.db"
        )
        self._populate_layer_list(
            "recognition",
            recognized_manifest_files(),
        )
        self._populate_layer_list(
            "transformation",
            newest_files(PROJECT_ROOT / "output" / "final" / "llm_raw", ("*.json",), 120),
        )
        aggregation_files = newest_files(PROJECT_ROOT / "output" / "final", ("candidates_*.json", "candidates_*.csv", "raw_candidates_*.json"), 80)
        db_path = PROJECT_ROOT / "local_source.db"
        if db_path.exists():
            aggregation_files = [db_path, *aggregation_files]
        self._populate_layer_list("aggregation", aggregation_files)

    def _refresh_source_labels(self) -> None:
        if not hasattr(self, "layer_input_vars"):
            return
        source = self.source_path.get().strip() or "(未选择)"
        self.layer_input_vars["recognition"].set(
            f"输入：{source}；本次运行目录：{safe_relative(GUI_INPUT_ROOT)}"
        )

    def _populate_layer_list(self, key: str, paths: list[Path]) -> None:
        self.layer_paths[key] = paths
        listbox = self.layer_lists[key]
        listbox.delete(0, "end")
        for path in paths:
            timestamp = datetime.fromtimestamp(path.stat().st_mtime).strftime("%m-%d %H:%M")
            listbox.insert("end", f"{timestamp}  {safe_relative(path)}")
        if paths:
            listbox.selection_set(0)
            self._show_selected_layer_file(key)
        else:
            self._set_layer_preview(key, "No output files found for this layer.")

    def _show_selected_layer_file(self, key: str) -> None:
        selection = self.layer_lists[key].curselection()
        if not selection:
            return
        path = self.layer_paths[key][selection[0]]
        try:
            if key == "transformation":
                text = summarize_llm_raw(path)
            elif key == "aggregation" and path.name == "local_source.db":
                text = sqlite_status(path)
            elif key == "aggregation" and path.suffix.lower() == ".json":
                text = summarize_candidates(path)
            elif key == "aggregation" and path.suffix.lower() == ".csv":
                text = summarize_csv(path)
            else:
                text = read_text_preview(path)
        except Exception as exc:
            text = f"Failed to preview {path}:\n{exc}"
        self._set_layer_preview(key, text)

    def _set_layer_preview(self, key: str, text: str) -> None:
        preview = self.layer_previews[key]
        preview.configure(state="normal")
        preview.delete("1.0", "end")
        preview.insert("1.0", text)
        preview.configure(state="disabled")

    def _choose_file(self) -> None:
        path = filedialog.askopenfilename(title="选择车源文件")
        if path:
            self.source_path.set(path)
            self.refresh_layer_views()

    def _choose_folder(self) -> None:
        path = filedialog.askdirectory(title="选择车源文件夹")
        if path:
            self.source_path.set(path)
            self.refresh_layer_views()

    def _selected_types(self) -> list[str]:
        return [name for name, var in self.file_type_vars.items() if var.get()]

    def _options(self) -> RunOptions:
        return RunOptions(
            provider=self.provider.get(),
            api_key=self.api_key.get().strip(),
            model=self.model.get().strip(),
            base_url=self.base_url.get().strip(),
            backend=self.backend.get(),
            effort=self.effort.get(),
            method=self.method.get(),
            confidence_threshold=self.confidence_threshold.get().strip() or "0.6",
            prompt_template=self.prompt_text.get("1.0", "end").strip(),
        )

    def _start(self, action: str, dry_run: bool = False) -> None:
        if self.process and self.process.poll() is None:
            messagebox.showwarning("任务运行中", "已有任务正在运行。请先中停或等待完成。")
            return
        options = self._options()
        pipeline_input = GUI_INPUT_ROOT.resolve()
        if action in {"run", "recognize"}:
            if not self.source_path.get().strip():
                messagebox.showwarning("未选择输入", "请先选择单个文件或文件夹。")
                return
            try:
                pipeline_input, staged = stage_selected_input(self.source_path.get(), self._selected_types())
            except Exception as exc:
                messagebox.showerror("输入准备失败", str(exc))
                return
            if staged <= 0:
                messagebox.showwarning("没有可处理文件", "当前输入中没有匹配的文件。请检查文件类型筛选或重新选择输入。")
                return
            self._append_log(f"已准备输入文件：{staged}\n")
        ocr_output = self._selected_layer_path("recognition") if action == "extract" else None
        if ocr_output and ocr_output.suffix.lower() != ".md":
            ocr_output = None
        raw_candidates = self._selected_layer_path("aggregation") if action == "aggregate" else None
        if raw_candidates and not raw_candidates.name.startswith("raw_candidates_"):
            raw_candidates = None
        command = build_pipeline_command(
            action,
            options,
            dry_run=dry_run,
            ocr_output=ocr_output,
            raw_candidates=raw_candidates,
        )
        env = os.environ.copy()
        env.update(provider_environment(options))
        env["PIPELINE_INPUT_DIR"] = str(pipeline_input)
        self._append_log(f"> {' '.join(command)}\n")
        flags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
        self.process = subprocess.Popen(
            command,
            cwd=PROJECT_ROOT,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            creationflags=flags,
        )
        threading.Thread(target=self._reader_thread, daemon=True).start()

    def _selected_layer_path(self, key: str) -> Path | None:
        if key not in self.layer_lists:
            return None
        selection = self.layer_lists[key].curselection()
        if not selection:
            return None
        return self.layer_paths[key][selection[0]]

    def _stop(self) -> None:
        if not self.process or self.process.poll() is not None:
            self._append_log("没有正在运行的任务。\n")
            return
        self._append_log("正在停止当前任务...\n")
        if os.name == "nt":
            self.process.send_signal(signal.CTRL_BREAK_EVENT)
        else:
            self.process.terminate()

    def _reader_thread(self) -> None:
        assert self.process is not None
        assert self.process.stdout is not None
        for line in self.process.stdout:
            self.output_queue.put(line)
        code = self.process.wait()
        self.output_queue.put(f"任务结束，退出码：{code}\n")
        self.output_queue.put(None)

    def _drain_output(self) -> None:
        while True:
            try:
                item = self.output_queue.get_nowait()
            except queue.Empty:
                break
            if item is not None:
                self._append_log(item)
            else:
                self.refresh_layer_views()
        self.root.after(150, self._drain_output)

    def _append_log(self, text: str) -> None:
        self.log_text.configure(state="normal")
        self.log_text.insert("end", text)
        self.log_text.see("end")
        self.log_text.configure(state="disabled")


def main() -> int:
    root = tk.Tk()
    PipelineGui(root)
    root.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
