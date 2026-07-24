#!/usr/bin/env python3
"""
MinerU OCR 批处理脚本
将 input/classified/ 中的图片、PDF、PPT、DOCX、RTF 等转为结构化 Markdown

依赖安装：
  pip install -U mineru

用法：
  python scripts/ocr_process.py                    # 处理所有分类文件
  python scripts/ocr_process.py --bucket images     # 只处理图片
  python scripts/ocr_process.py --file input/classified/pdfs/xxx.pdf
"""

import os
import sys
import json
import subprocess
import argparse
import hashlib
import re
from pathlib import Path
from datetime import datetime

os.environ.setdefault("PADDLE_PDX_ENABLE_MKLDNN_BYDEFAULT", "0")
os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

PROJECT_ROOT = Path(__file__).resolve().parent.parent
INPUT_CLASSIFIED = PROJECT_ROOT / "input" / "classified"
OUTPUT_OCR = PROJECT_ROOT / "output" / "recognized" / "mineru"
CACHE_FILE = PROJECT_ROOT / "output" / "recognized" / ".mineru_cache.json"
ERRORS_FILE = OUTPUT_OCR / "errors.json"


def load_env_file():
    """Load simple KEY=VALUE entries from .env for direct script runs."""
    env_path = PROJECT_ROOT / ".env"
    if not env_path.exists():
        return
    for raw_line in env_path.read_text("utf-8", errors="ignore").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("'\"")
        if key and key not in os.environ:
            os.environ[key] = value


load_env_file()

# 需要 OCR 处理的文件桶及其扩展名
OCR_BUCKETS = {
    "images":        [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".svg"],
    "pdfs":          [".pdf"],
    "presentations": [".pptx", ".ppt"],
    "documents":     [".docx", ".doc", ".rtf"],
}

# 不需要 OCR 的桶（直接解析）
SKIP_BUCKETS = {"excels", "texts"}


def file_hash(filepath: Path) -> str:
    """SHA-256 content hash for cache invalidation."""
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def load_cache() -> dict:
    try:
        return json.loads(CACHE_FILE.read_text("utf-8"))
    except Exception:
        return {}


def save_cache(cache: dict):
    CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    CACHE_FILE.write_text(json.dumps(cache, indent=2, ensure_ascii=False), "utf-8")


def get_mineru_command() -> str | None:
    """Return the available MinerU CLI command."""
    for command in ("mineru", "magic-pdf"):
        try:
            result = subprocess.run(
                [command, "--version"],
                capture_output=True, text=True, timeout=10
            )
            if result.returncode == 0:
                return command
        except FileNotFoundError:
            continue
    return None


def env_bool(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None or value == "":
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "") or default)
    except ValueError:
        return default


def build_mineru_command(command: str, filepath: Path, output_dir: Path) -> list[str]:
    """Build MinerU CLI command from MINERU_* configuration."""
    method = os.environ.get("MINERU_METHOD", "auto").strip().lower() or "auto"
    if method not in {"ocr", "txt", "auto"}:
        method = "auto"

    output_flag = "--output" if command == "mineru" else "--output-dir"
    cmd = [command, "--path", str(filepath), output_flag, str(output_dir), "--method", method]

    lang = os.environ.get("MINERU_LANG", "").strip()
    if lang:
        cmd.extend(["--lang", lang])

    if command == "mineru":
        backend = os.environ.get("MINERU_BACKEND", "pipeline").strip() or "pipeline"
        if backend in {"pipeline", "vlm-engine", "hybrid-engine", "vlm-http-client", "hybrid-http-client"}:
            cmd.extend(["--backend", backend])

        effort = os.environ.get("MINERU_EFFORT", "medium").strip() or "medium"
        if effort in {"medium", "high"}:
            cmd.extend(["--effort", effort])

        table = os.environ.get("MINERU_TABLE", "").strip()
        if table:
            cmd.extend(["--table", "true" if env_bool("MINERU_TABLE", True) else "false"])

        formula = os.environ.get("MINERU_FORMULA", "").strip()
        if formula:
            cmd.extend(["--formula", "true" if env_bool("MINERU_FORMULA", True) else "false"])

        image_analysis = os.environ.get("MINERU_IMAGE_ANALYSIS", "").strip()
        if image_analysis:
            cmd.extend(["--image-analysis", "true" if env_bool("MINERU_IMAGE_ANALYSIS", True) else "false"])

    if command == "magic-pdf" and env_bool("MINERU_DEBUG", False):
        cmd.extend(["--debug", "true"])

    start_page = os.environ.get("MINERU_START_PAGE", "").strip()
    if start_page:
        cmd.extend(["--start", start_page])

    end_page = os.environ.get("MINERU_END_PAGE", "").strip()
    if end_page:
        cmd.extend(["--end", end_page])

    return cmd


def check_paddleocr_installed() -> bool:
    """Check if PaddleOCR is installed (fallback for images)."""
    try:
        result = subprocess.run(
            [sys.executable, "-c", "import paddleocr; print('ok')"],
            capture_output=True, text=True, timeout=10
        )
        return "ok" in result.stdout
    except Exception:
        return False


def convert_pptx_to_pdf(pptx_path: Path, output_dir: Path) -> Path:
    """Convert PPTX to PDF using LibreOffice (if available) for MinerU processing."""
    pdf_path = output_dir / (pptx_path.stem + ".pdf")
    try:
        subprocess.run(
            ["soffice", "--headless", "--convert-to", "pdf",
             "--outdir", str(output_dir), str(pptx_path)],
            capture_output=True, timeout=120
        )
        if pdf_path.exists():
            return pdf_path
    except FileNotFoundError:
        pass

    # Fallback: try python-pptx extraction
    try:
        from pptx import Presentation
        prs = Presentation(str(pptx_path))
        texts = []
        for slide_num, slide in enumerate(prs.slides, 1):
            slide_texts = []
            for shape in slide.shapes:
                if hasattr(shape, "text") and shape.text.strip():
                    slide_texts.append(shape.text.strip())
                if shape.has_table:
                    table = shape.table
                    for row in table.rows:
                        row_data = [cell.text.strip() for cell in row.cells]
                        slide_texts.append(" | ".join(row_data))
            if slide_texts:
                texts.append(f"## Slide {slide_num}\n\n" + "\n\n".join(slide_texts))

        md_path = output_dir / (pptx_path.stem + ".md")
        md_path.write_text("\n\n---\n\n".join(texts), "utf-8")
        return md_path
    except ImportError:
        print(f"  ⚠️  python-pptx not installed, skipping {pptx_path.name}")
        return None


def convert_docx_to_text(docx_path: Path, output_dir: Path) -> Path:
    """Extract text from DOCX."""
    try:
        from docx import Document
        doc = Document(str(docx_path))
        texts = []
        for para in doc.paragraphs:
            if para.text.strip():
                texts.append(para.text.strip())
        for table in doc.tables:
            header = [cell.text.strip() for cell in table.rows[0].cells]
            texts.append("| " + " | ".join(header) + " |")
            texts.append("| " + " | ".join(["---"] * len(header)) + " |")
            for row in table.rows[1:]:
                row_data = [cell.text.strip() for cell in row.cells]
                texts.append("| " + " | ".join(row_data) + " |")

        md_path = output_dir / (docx_path.stem + ".md")
        md_path.write_text("\n\n".join(texts), "utf-8")
        return md_path
    except ImportError:
        print(f"  ⚠️  python-docx not installed, skipping {docx_path.name}")
        return None


def convert_rtf_to_text(rtf_path: Path, output_dir: Path) -> Path:
    """Extract plain text from simple RTF without adding a heavyweight dependency."""
    raw = rtf_path.read_text("utf-8", errors="ignore")
    text = raw
    text = text.replace("\\par", "\n").replace("\\line", "\n").replace("\\tab", "\t")
    text = re.sub(r"\\'[0-9a-fA-F]{2}", " ", text)
    text = re.sub(r"\\[a-zA-Z]+-?\d* ?", "", text)
    text = re.sub(r"[{}]", "", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = "\n".join(line.strip() for line in text.splitlines()).strip()

    if not text:
        return None

    output_dir.mkdir(parents=True, exist_ok=True)
    md_path = output_dir / (rtf_path.stem + ".md")
    md_path.write_text(text, "utf-8")
    return md_path


def process_with_mineru(filepath: Path, output_dir: Path, command: str) -> Path | None:
    """Process a single file with MinerU CLI."""
    output_dir.mkdir(parents=True, exist_ok=True)
    started_at = datetime.now().timestamp()
    try:
        cmd = build_mineru_command(command, filepath, output_dir)
        timeout_seconds = env_int("MINERU_TIMEOUT_SECONDS", 300)
        result = subprocess.run(
            cmd,
            capture_output=True, text=True, timeout=timeout_seconds
        )
        if result.returncode == 0:
            # MinerU outputs to method/backend-specific subdirectories.
            stem = filepath.stem
            md_candidates = list(output_dir.rglob(f"*{stem}*.md"))
            if md_candidates:
                fresh_candidates = [
                    candidate for candidate in md_candidates
                    if candidate.stat().st_mtime >= started_at - 1
                ]
                candidates = fresh_candidates or md_candidates
                return max(candidates, key=lambda candidate: candidate.stat().st_mtime)
        else:
            print(f"  ⚠️  MinerU error: {result.stderr[:2000]}")
    except subprocess.TimeoutExpired:
        print(f"  ⚠️  MinerU timeout on {filepath.name}")
    except Exception as e:
        print(f"  ⚠️  MinerU exception: {e}")
    return None


def create_paddleocr_reader():
    """Create a PaddleOCR reader using arguments accepted by current 3.x releases."""
    from paddleocr import PaddleOCR
    try:
        return PaddleOCR(
            lang="ch",
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
        )
    except Exception:
        return PaddleOCR(lang="ch")


def parse_paddleocr_result(result) -> list[str]:
    """Normalize PaddleOCR 2.x/3.x result shapes to plain text lines."""
    lines = []

    def append_text(value, score=None):
        if value is None:
            return
        text = str(value).strip()
        if not text:
            return
        if score is None or float(score) >= 0.5:
            lines.append(text)

    for page in result or []:
        if isinstance(page, dict):
            texts = page.get("rec_texts") or page.get("texts") or []
            scores = page.get("rec_scores") or page.get("scores") or [None] * len(texts)
            for text, score in zip(texts, scores):
                append_text(text, score)
            continue

        if hasattr(page, "json"):
            try:
                data = page.json
                if isinstance(data, dict):
                    texts = data.get("rec_texts") or data.get("texts") or []
                    scores = data.get("rec_scores") or data.get("scores") or [None] * len(texts)
                    for text, score in zip(texts, scores):
                        append_text(text, score)
                    continue
            except Exception:
                pass

        if isinstance(page, list):
            for line in page:
                try:
                    append_text(line[1][0], line[1][1])
                except Exception:
                    continue

    return lines


def process_with_paddleocr(filepath: Path, output_dir: Path) -> Path | None:
    """Fallback: process image with PaddleOCR directly."""
    try:
        ocr = create_paddleocr_reader()
        if hasattr(ocr, "predict"):
            result = ocr.predict(str(filepath))
        else:
            result = ocr.ocr(str(filepath))
        lines = parse_paddleocr_result(result)
        output_dir.mkdir(parents=True, exist_ok=True)
        md_path = output_dir / (filepath.stem + ".md")
        md_path.write_text("\n".join(lines), "utf-8")
        return md_path if lines else None
    except ImportError:
        print(f"  ⚠️  PaddleOCR not installed")
        return None
    except Exception as e:
        print(f"  ⚠️  PaddleOCR error: {e}")
        return None


def process_file(filepath: Path, cache: dict, mineru_command: str | None, engine: str) -> tuple[dict | None, dict | None]:
    """Process a single file, return metadata dict or None."""
    fhash = file_hash(filepath)
    rel = str(filepath.relative_to(INPUT_CLASSIFIED))
    cache_key = f"{rel}::{fhash}"

    # Check cache
    if cache_key in cache:
        cached = cache[cache_key]
        if Path(cached["output_path"]).exists():
            print(f"  ⏭️  Cached: {rel}")
            return cached, None

    ext = filepath.suffix.lower()
    output_subdir = OUTPUT_OCR / filepath.parent.relative_to(INPUT_CLASSIFIED)
    output_subdir.mkdir(parents=True, exist_ok=True)

    result_path = None

    if engine == "mineru" and not mineru_command:
        return None, {
            "source": str(filepath),
            "source_rel": rel,
            "error": "MinerU CLI is not installed",
        }

    if engine == "paddleocr":
        if ext in [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff"]:
            result_path = process_with_paddleocr(filepath, output_subdir)
    elif ext in [".pptx", ".ppt"]:
        result_path = convert_pptx_to_pdf(filepath, output_subdir)
        # If got PDF, process it further with MinerU
        if result_path and result_path.suffix == ".pdf" and mineru_command:
            mineru_result = process_with_mineru(result_path, output_subdir, mineru_command)
            if mineru_result:
                result_path = mineru_result

    elif ext == ".docx":
        result_path = convert_docx_to_text(filepath, output_subdir)

    elif ext == ".rtf":
        result_path = convert_rtf_to_text(filepath, output_subdir)
        if not result_path and mineru_command:
            result_path = process_with_mineru(filepath, output_subdir, mineru_command)

    elif ext == ".doc":
        if mineru_command:
            result_path = process_with_mineru(filepath, output_subdir, mineru_command)

    elif ext == ".pdf":
        if mineru_command:
            result_path = process_with_mineru(filepath, output_subdir, mineru_command)

    elif ext in [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".svg"]:
        if mineru_command:
            result_path = process_with_mineru(filepath, output_subdir, mineru_command)

    if result_path:
        entry = {
            "source": str(filepath),
            "source_rel": rel,
            "output_path": str(result_path),
            "content_hash": fhash,
            "processed_at": datetime.now().isoformat(),
            "method": engine,
        }
        cache[cache_key] = entry
        return entry, None
    return None, {
        "source": str(filepath),
        "source_rel": rel,
        "error": f"No recognized markdown output generated for {filepath.name}",
    }


def main():
    parser = argparse.ArgumentParser(description="MinerU/PaddleOCR batch processor")
    parser.add_argument("--bucket", help="Only process one bucket (images/pdfs/etc)")
    parser.add_argument("--file", help="Process single file")
    parser.add_argument("--engine", choices=["mineru", "paddleocr"], default="mineru", help="Recognition engine")
    parser.add_argument("--force", action="store_true", help="Ignore cache, reprocess all")
    args = parser.parse_args()

    mineru_command = get_mineru_command()
    use_paddle = check_paddleocr_installed()

    print(f"🔧 MinerU installed: {'✅' if mineru_command else '❌'}")
    print(f"🔧 PaddleOCR installed: {'✅' if use_paddle else '❌'}")

    if args.engine == "mineru" and not mineru_command:
        print("\n❌ MinerU is not installed. Professional recognition cannot continue.")
        print("   Install MinerU:    pip install -U mineru")
        sys.exit(1)
    if args.engine == "paddleocr" and not use_paddle:
        print("\n❌ PaddleOCR is not installed.")
        print("   Install PaddleOCR: pip install paddleocr paddlepaddle")
        sys.exit(1)

    cache = {} if args.force else load_cache()
    results = []
    errors = []

    if args.file:
        # Single file mode
        fp = Path(args.file).resolve()
        print(f"\n📄 Processing: {fp.name}")
        entry, error = process_file(fp, cache, mineru_command, args.engine)
        if entry:
            results.append(entry)
        if error:
            errors.append(error)
    else:
        # Batch mode
        buckets_to_process = [args.bucket] if args.bucket else list(OCR_BUCKETS.keys())
        for bucket in buckets_to_process:
            bucket_dir = INPUT_CLASSIFIED / bucket
            if not bucket_dir.exists():
                continue
            files = sorted(bucket_dir.iterdir())
            print(f"\n📁 {bucket}/ — {len(files)} files")
            for fp in files:
                if fp.is_file():
                    print(f"  📄 {fp.name}...")
                    entry, error = process_file(fp, cache, mineru_command, args.engine)
                    if entry:
                        results.append(entry)
                    if error:
                        errors.append(error)

    save_cache(cache)

    # Write manifest for downstream pipeline
    manifest_path = OUTPUT_OCR / "manifest.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest = {
        "processed_at": datetime.now().isoformat(),
        "engine": args.engine,
        "total_files": len(results),
        "files": results,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), "utf-8")
    ERRORS_FILE.write_text(json.dumps({
        "processed_at": datetime.now().isoformat(),
        "engine": args.engine,
        "total_errors": len(errors),
        "errors": errors,
    }, indent=2, ensure_ascii=False), "utf-8")

    print(f"\n✅ OCR complete: {len(results)} files processed")
    print(f"   Manifest: {manifest_path}")
    if errors:
        print(f"   Errors: {ERRORS_FILE} ({len(errors)} files)")


if __name__ == "__main__":
    main()
