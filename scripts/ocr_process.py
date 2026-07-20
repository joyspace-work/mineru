#!/usr/bin/env python3
"""
MinerU OCR 批处理脚本
将 input/classified/ 中的图片、PDF、PPT、DOCX 转为结构化 Markdown

依赖安装：
  pip install magic-pdf[full]   # MinerU (内置 PaddleOCR)

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
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parent.parent
INPUT_CLASSIFIED = PROJECT_ROOT / "input" / "classified"
OUTPUT_OCR = PROJECT_ROOT / "output" / "ocr"
CACHE_FILE = PROJECT_ROOT / "output" / ".ocr_cache.json"

# 需要 OCR 处理的文件桶及其扩展名
OCR_BUCKETS = {
    "images":        [".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff"],
    "pdfs":          [".pdf"],
    "presentations": [".pptx", ".ppt"],
    "documents":     [".docx", ".doc"],
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


def check_mineru_installed() -> bool:
    """Check if MinerU (magic-pdf) is installed."""
    try:
        result = subprocess.run(
            ["magic-pdf", "--version"],
            capture_output=True, text=True, timeout=10
        )
        return result.returncode == 0
    except FileNotFoundError:
        return False


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


def process_with_mineru(filepath: Path, output_dir: Path) -> Path | None:
    """Process a single file with MinerU magic-pdf."""
    output_dir.mkdir(parents=True, exist_ok=True)
    try:
        result = subprocess.run(
            ["magic-pdf", "-p", str(filepath), "-o", str(output_dir), "-m", "auto"],
            capture_output=True, text=True, timeout=300
        )
        if result.returncode == 0:
            # MinerU outputs to: output_dir/<filename>/auto/<filename>.md
            stem = filepath.stem
            md_candidates = list(output_dir.rglob(f"*{stem}*.md"))
            if md_candidates:
                return md_candidates[0]
        else:
            print(f"  ⚠️  MinerU error: {result.stderr[:200]}")
    except subprocess.TimeoutExpired:
        print(f"  ⚠️  MinerU timeout on {filepath.name}")
    except Exception as e:
        print(f"  ⚠️  MinerU exception: {e}")
    return None


def process_with_paddleocr(filepath: Path, output_dir: Path) -> Path | None:
    """Fallback: process image with PaddleOCR directly."""
    try:
        from paddleocr import PaddleOCR
        ocr = PaddleOCR(use_angle_cls=True, lang='ch', show_log=False)
        result = ocr.ocr(str(filepath), cls=True)
        lines = []
        if result and result[0]:
            for line in result[0]:
                text = line[1][0]
                confidence = line[1][1]
                lines.append(f"{text}")
        output_dir.mkdir(parents=True, exist_ok=True)
        md_path = output_dir / (filepath.stem + ".md")
        md_path.write_text("\n".join(lines), "utf-8")
        return md_path
    except ImportError:
        print(f"  ⚠️  PaddleOCR not installed")
        return None
    except Exception as e:
        print(f"  ⚠️  PaddleOCR error: {e}")
        return None


def process_file(filepath: Path, cache: dict, use_mineru: bool) -> dict | None:
    """Process a single file, return metadata dict or None."""
    fhash = file_hash(filepath)
    rel = str(filepath.relative_to(INPUT_CLASSIFIED))
    cache_key = f"{rel}::{fhash}"

    # Check cache
    if cache_key in cache:
        cached = cache[cache_key]
        if Path(cached["output_path"]).exists():
            print(f"  ⏭️  Cached: {rel}")
            return cached

    ext = filepath.suffix.lower()
    output_subdir = OUTPUT_OCR / filepath.parent.relative_to(INPUT_CLASSIFIED)
    output_subdir.mkdir(parents=True, exist_ok=True)

    result_path = None

    if ext in [".pptx", ".ppt"]:
        result_path = convert_pptx_to_pdf(filepath, output_subdir)
        # If got PDF, process it further with MinerU
        if result_path and result_path.suffix == ".pdf" and use_mineru:
            mineru_result = process_with_mineru(result_path, output_subdir)
            if mineru_result:
                result_path = mineru_result

    elif ext in [".docx", ".doc"]:
        result_path = convert_docx_to_text(filepath, output_subdir)

    elif ext == ".pdf":
        if use_mineru:
            result_path = process_with_mineru(filepath, output_subdir)
        if not result_path:
            # Fallback: basic text extraction
            try:
                import fitz  # PyMuPDF
                doc = fitz.open(str(filepath))
                texts = [page.get_text("text") for page in doc]
                md_path = output_subdir / (filepath.stem + ".md")
                md_path.write_text("\n\n---\n\n".join(texts), "utf-8")
                result_path = md_path
            except ImportError:
                print(f"  ⚠️  PyMuPDF not installed, cannot extract PDF text")

    elif ext in [".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff"]:
        if use_mineru:
            result_path = process_with_mineru(filepath, output_subdir)
        if not result_path:
            result_path = process_with_paddleocr(filepath, output_subdir)

    if result_path:
        entry = {
            "source": str(filepath),
            "source_rel": rel,
            "output_path": str(result_path),
            "content_hash": fhash,
            "processed_at": datetime.now().isoformat(),
            "method": "mineru" if use_mineru else "paddleocr",
        }
        cache[cache_key] = entry
        return entry
    return None


def main():
    parser = argparse.ArgumentParser(description="MinerU/PaddleOCR batch processor")
    parser.add_argument("--bucket", help="Only process one bucket (images/pdfs/etc)")
    parser.add_argument("--file", help="Process single file")
    parser.add_argument("--force", action="store_true", help="Ignore cache, reprocess all")
    args = parser.parse_args()

    use_mineru = check_mineru_installed()
    use_paddle = check_paddleocr_installed()

    print(f"🔧 MinerU installed: {'✅' if use_mineru else '❌'}")
    print(f"🔧 PaddleOCR installed: {'✅' if use_paddle else '❌'}")

    if not use_mineru and not use_paddle:
        print("\n❌ Neither MinerU nor PaddleOCR is installed!")
        print("   Install MinerU:    pip install magic-pdf[full]")
        print("   Install PaddleOCR: pip install paddleocr paddlepaddle")
        sys.exit(1)

    cache = {} if args.force else load_cache()
    results = []

    if args.file:
        # Single file mode
        fp = Path(args.file).resolve()
        print(f"\n📄 Processing: {fp.name}")
        entry = process_file(fp, cache, use_mineru)
        if entry:
            results.append(entry)
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
                    entry = process_file(fp, cache, use_mineru)
                    if entry:
                        results.append(entry)

    save_cache(cache)

    # Write manifest for downstream pipeline
    manifest_path = OUTPUT_OCR / "manifest.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest = {
        "processed_at": datetime.now().isoformat(),
        "total_files": len(results),
        "files": results,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), "utf-8")

    print(f"\n✅ OCR complete: {len(results)} files processed")
    print(f"   Manifest: {manifest_path}")


if __name__ == "__main__":
    main()
