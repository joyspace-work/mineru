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

try:
    from mineru.cli.common import do_parse as mineru_sdk_do_parse, read_fn as mineru_sdk_read_fn
except Exception:
    mineru_sdk_do_parse = None
    mineru_sdk_read_fn = None

os.environ.setdefault("PADDLE_PDX_ENABLE_MKLDNN_BYDEFAULT", "0")
os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

PROJECT_ROOT = Path(__file__).resolve().parents[2]
INPUT_CLASSIFIED = PROJECT_ROOT / "input" / "classified"
OUTPUT_OCR = PROJECT_ROOT / "output" / "recognized" / "mineru"
CACHE_FILE = PROJECT_ROOT / "output" / "recognized" / ".mineru_cache.json"
ERRORS_FILE = OUTPUT_OCR / "errors.json"
DEFAULT_CONFIDENCE_THRESHOLD = 0.6
CONFIDENCE_KEYS = {"score", "confidence", "conf"}
CONFIDENCE_LIST_KEYS = {"scores", "rec_scores", "det_scores", "cls_scores"}


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


def mineru_sdk_available() -> bool:
    return mineru_sdk_do_parse is not None and mineru_sdk_read_fn is not None


def env_bool(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None or value == "":
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def recognition_confidence_threshold() -> float:
    raw = os.environ.get("MINERU_CONFIDENCE_THRESHOLD", "").strip()
    if not raw:
        return DEFAULT_CONFIDENCE_THRESHOLD
    try:
        return float(raw)
    except ValueError:
        return DEFAULT_CONFIDENCE_THRESHOLD


def _coerce_confidence_score(value) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        score = float(value)
    elif isinstance(value, str):
        try:
            score = float(value.strip())
        except ValueError:
            return None
    else:
        return None
    if 0 <= score <= 1:
        return score
    return None


def _collect_confidence_scores(data, parent_key: str = "") -> list[float]:
    scores: list[float] = []
    key = parent_key.lower()
    if isinstance(data, dict):
        for child_key, value in data.items():
            child_key_lower = str(child_key).lower()
            if child_key_lower in CONFIDENCE_KEYS:
                score = _coerce_confidence_score(value)
                if score is not None:
                    scores.append(score)
                    continue
            scores.extend(_collect_confidence_scores(value, child_key_lower))
        return scores
    if isinstance(data, list):
        for item in data:
            if key in CONFIDENCE_LIST_KEYS:
                score = _coerce_confidence_score(item)
                if score is not None:
                    scores.append(score)
                    continue
            scores.extend(_collect_confidence_scores(item, key))
    return scores


def analyze_recognition_confidence(markdown_path: Path, threshold: float | None = None) -> dict:
    threshold = recognition_confidence_threshold() if threshold is None else threshold
    scores: list[float] = []
    for json_path in sorted(markdown_path.parent.glob("*.json")):
        try:
            data = json.loads(json_path.read_text("utf-8"))
        except Exception:
            continue
        scores.extend(_collect_confidence_scores(data))
    low_scores = [score for score in scores if score < threshold]
    quality = {
        "confidence_available": bool(scores),
        "threshold": threshold,
        "score_count": len(scores),
        "low_confidence_count": len(low_scores),
        "min_confidence": round(min(scores), 4) if scores else None,
        "requires_manual_review": bool(low_scores),
    }
    if low_scores:
        quality["warning"] = "recognition_confidence_below_threshold"
    return quality


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


def mineru_parse_options() -> dict:
    method = os.environ.get("MINERU_METHOD", "auto").strip().lower() or "auto"
    if method not in {"ocr", "txt", "auto"}:
        method = "auto"
    backend = os.environ.get("MINERU_BACKEND", "pipeline").strip() or "pipeline"
    if backend not in {"pipeline", "vlm-engine", "hybrid-engine", "vlm-http-client", "hybrid-http-client"}:
        backend = "pipeline"
    effort = os.environ.get("MINERU_EFFORT", "medium").strip() or "medium"
    if effort not in {"medium", "high"}:
        effort = "medium"
    lang = os.environ.get("MINERU_LANG", "ch").strip() or "ch"
    options = {
        "backend": backend,
        "parse_method": method,
        "p_lang_list": [lang],
        "formula_enable": env_bool("MINERU_FORMULA", True),
        "table_enable": env_bool("MINERU_TABLE", True),
        "image_analysis": env_bool("MINERU_IMAGE_ANALYSIS", True),
        "effort": effort,
    }
    start_page = os.environ.get("MINERU_START_PAGE", "").strip()
    end_page = os.environ.get("MINERU_END_PAGE", "").strip()
    if start_page:
        options["start_page_id"] = int(start_page)
    if end_page:
        options["end_page_id"] = int(end_page)
    return options


def newest_mineru_markdown(filepath: Path, output_dir: Path, started_at: float) -> Path | None:
    stem = filepath.stem
    md_candidates = list(output_dir.rglob(f"*{stem}*.md"))
    if not md_candidates:
        return None
    fresh_candidates = [
        candidate for candidate in md_candidates
        if candidate.stat().st_mtime >= started_at - 1
    ]
    candidates = fresh_candidates or md_candidates
    return max(candidates, key=lambda candidate: candidate.stat().st_mtime)


def process_with_mineru_sdk(filepath: Path, output_dir: Path) -> Path | None:
    """Process a single file with MinerU Python SDK."""
    if not mineru_sdk_available():
        return None
    output_dir.mkdir(parents=True, exist_ok=True)
    started_at = datetime.now().timestamp()
    try:
        options = mineru_parse_options()
        p_lang_list = options.pop("p_lang_list")
        file_bytes = mineru_sdk_read_fn(filepath)
        mineru_sdk_do_parse(
            str(output_dir),
            pdf_file_names=[filepath.stem],
            pdf_bytes_list=[file_bytes],
            p_lang_list=p_lang_list,
            **options,
        )
        return newest_mineru_markdown(filepath, output_dir, started_at)
    except Exception as e:
        print(f"  ⚠️  MinerU SDK exception: {e}")
        return None


def process_with_mineru(filepath: Path, output_dir: Path, command: str | None = None) -> Path | None:
    """Process with MinerU SDK only."""
    result = process_with_mineru_sdk(filepath, output_dir)
    if result:
        return result
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


def process_file(filepath: Path, cache: dict, engine: str) -> tuple[dict | None, dict | None]:
    """Process a single file, return metadata dict or None."""
    fhash = file_hash(filepath)
    rel = str(filepath.relative_to(INPUT_CLASSIFIED))
    cache_key = f"{rel}::{fhash}"

    # Check cache
    if cache_key in cache:
        cached = cache[cache_key]
        if Path(cached["output_path"]).exists():
            if "recognition_quality" not in cached:
                cached["recognition_quality"] = analyze_recognition_confidence(Path(cached["output_path"]))
            quality = cached.get("recognition_quality") or {}
            print(f"  ⏭️  Cached: {rel}")
            if quality.get("requires_manual_review"):
                print(
                    "  ⚠️  Recognition confidence below "
                    f"{quality['threshold']:.2f}; manual review recommended "
                    f"({quality['low_confidence_count']} segments, min={quality['min_confidence']})"
                )
            return cached, None

    ext = filepath.suffix.lower()
    output_subdir = OUTPUT_OCR / filepath.parent.relative_to(INPUT_CLASSIFIED)
    output_subdir.mkdir(parents=True, exist_ok=True)

    result_path = None

    if engine == "mineru" and not mineru_sdk_available():
        return None, {
            "source": str(filepath),
            "source_rel": rel,
            "error": "MinerU SDK is not installed",
        }

    if engine == "paddleocr":
        if ext in [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff"]:
            result_path = process_with_paddleocr(filepath, output_subdir)
    elif ext in [".pptx", ".ppt"]:
        result_path = convert_pptx_to_pdf(filepath, output_subdir)
        # If got PDF, process it further with MinerU
        if result_path and result_path.suffix == ".pdf":
            mineru_result = process_with_mineru(result_path, output_subdir)
            if mineru_result:
                result_path = mineru_result

    elif ext == ".docx":
        result_path = convert_docx_to_text(filepath, output_subdir)

    elif ext == ".rtf":
        result_path = convert_rtf_to_text(filepath, output_subdir)
        if not result_path:
            result_path = process_with_mineru(filepath, output_subdir)

    elif ext == ".doc":
        result_path = process_with_mineru(filepath, output_subdir)

    elif ext == ".pdf":
        result_path = process_with_mineru(filepath, output_subdir)

    elif ext in [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".svg"]:
        result_path = process_with_mineru(filepath, output_subdir)

    if result_path:
        recognition_quality = analyze_recognition_confidence(result_path)
        entry = {
            "source": str(filepath),
            "source_rel": rel,
            "output_path": str(result_path),
            "content_hash": fhash,
            "processed_at": datetime.now().isoformat(),
            "method": engine,
            "recognition_quality": recognition_quality,
        }
        if recognition_quality.get("requires_manual_review"):
            print(
                "  ⚠️  Recognition confidence below "
                f"{recognition_quality['threshold']:.2f}; manual review recommended "
                f"({recognition_quality['low_confidence_count']} segments, "
                f"min={recognition_quality['min_confidence']})"
            )
        cache[cache_key] = entry
        return entry, None
    return None, {
        "source": str(filepath),
        "source_rel": rel,
        "error": f"No recognized markdown output generated for {filepath.name}",
    }


def main(argv: list[str] | None = None):
    parser = argparse.ArgumentParser(description="MinerU/PaddleOCR batch processor")
    parser.add_argument("--bucket", help="Only process one bucket (images/pdfs/etc)")
    parser.add_argument("--file", help="Process single file")
    parser.add_argument("--engine", choices=["mineru", "paddleocr"], default="mineru", help="Recognition engine")
    parser.add_argument("--force", action="store_true", help="Ignore cache, reprocess all")
    args = parser.parse_args(argv)

    use_paddle = check_paddleocr_installed()

    print(f"🔧 MinerU SDK installed: {'✅' if mineru_sdk_available() else '❌'}")
    print(f"🔧 PaddleOCR installed: {'✅' if use_paddle else '❌'}")

    if args.engine == "mineru" and not mineru_sdk_available():
        print("\n❌ MinerU is not installed. Professional recognition cannot continue.")
        print("   Install MinerU:    pip install -U mineru")
        return 1
    if args.engine == "paddleocr" and not use_paddle:
        print("\n❌ PaddleOCR is not installed.")
        print("   Install PaddleOCR: pip install paddleocr paddlepaddle")
        return 1

    cache = {} if args.force else load_cache()
    results = []
    errors = []

    if args.file:
        # Single file mode
        fp = Path(args.file).resolve()
        print(f"\n📄 Processing: {fp.name}")
        entry, error = process_file(fp, cache, args.engine)
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
                    entry, error = process_file(fp, cache, args.engine)
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
    return 0


if __name__ == "__main__":
    sys.exit(main())
