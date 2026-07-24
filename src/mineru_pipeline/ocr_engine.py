from __future__ import annotations
from dataclasses import dataclass
import hashlib
import json
import logging
import os
from pathlib import Path
from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(PROJECT_ROOT / ".env", override=False)

logger = logging.getLogger("mineru_pipeline.ocr_engine")


@dataclass
class OCRResult:
    source_path: Path
    markdown_path: Path
    markdown_content: str
    avg_confidence: float | None
    is_cached: bool


def _compute_hash(file_path: Path) -> str:
    h = hashlib.sha256()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _run_unipipe_parse(file_path: Path, output_dir: Path) -> Path:
    filename_stem = file_path.stem
    output_dir.mkdir(parents=True, exist_ok=True)
    suffix = file_path.suffix.lower()
    
    backend = os.getenv("MINERU_BACKEND", "hybrid")
    method = os.getenv("MINERU_METHOD", "auto")
    lang = os.getenv("MINERU_LANG", "ch")
    effort = os.getenv("MINERU_EFFORT", "high")
    table = os.getenv("MINERU_TABLE", "true").lower() == "true"
    formula = os.getenv("MINERU_FORMULA", "true").lower() == "true"
    image_analysis = os.getenv("MINERU_IMAGE_ANALYSIS", "true").lower() == "true"
    debug = os.getenv("MINERU_DEBUG", "false").lower() == "true"
    timeout_seconds = int(os.getenv("MINERU_TIMEOUT_SECONDS", "600"))

    parse_options = {
        "backend": backend,
        "method": method,
        "lang": lang,
        "effort": effort,
        "table": table,
        "formula": formula,
        "image_analysis": image_analysis,
        "debug": debug,
        "timeout": timeout_seconds,
    }

    # Try importing MinerU / magic_pdf native SDK
    try:
        # 1. Check for MinerU 3.x unified parse API
        try:
            from mineru.parse import parse_file
            res = parse_file(str(file_path), output_dir=str(output_dir), **parse_options)
            md_file = output_dir / f"{filename_stem}.md"
            if md_file.exists():
                return md_file
        except Exception:
            pass

        # 2. Check for magic_pdf UNIPipe API
        try:
            from magic_pdf.pipe.UNIPipe import UNIPipe
            from magic_pdf.data.dataset import PymupdfDataset
            ds = PymupdfDataset(file_path.read_bytes())
            pipe = UNIPipe(ds, parse_options)
            pipe.pipe_classify()
            pipe.pipe_analyze()
            pipe.pipe_parse()
            md_content = pipe.pipe_mk_markdown(str(output_dir / "images"))
            md_file = output_dir / f"{filename_stem}.md"
            md_file.write_text(md_content, encoding="utf-8")
            return md_file
        except Exception:
            pass

        # 3. Check for magic_pdf PymuDocDataset API
        try:
            from magic_pdf.data.dataset import PymuDocDataset
            ds = PymuDocDataset(file_path.read_bytes())
            ds.classify()
            ds.analyze()
            ds.parse()
            md_content = ds.dump_markdown(str(output_dir / "images"))
            md_file = output_dir / f"{filename_stem}.md"
            md_file.write_text(md_content, encoding="utf-8")
            return md_file
        except Exception:
            pass

        raise RuntimeError("No compatible MinerU / magic_pdf native SDK entrypoint found in current environment")
    except Exception as e:
        logger.warning(f"MinerU native SDK parse unavailable ({e}); using PyMuPDF (fitz) multi-format fallback.")
        try:
            if suffix in (".png", ".jpg", ".jpeg", ".webp"):
                try:
                    from rapidocr_onnxruntime import RapidOCR
                    ocr_engine = RapidOCR()
                    res, _ = ocr_engine(str(file_path))
                    lines = [line[1] for line in res] if res else []
                    scores = [float(line[2]) for line in res if len(line) >= 3] if res else []
                    md_content = f"# Extracted Content for {filename_stem}\n\n" + "\n".join(lines)
                    middle_file = output_dir / f"{filename_stem}_middle.json"
                    middle_data = {
                        "pdf_info": [{
                            "blocks": [{
                                "lines": [{"confidence": s} for s in scores]
                            }]
                        }]
                    }
                    middle_file.write_text(json.dumps(middle_data), encoding="utf-8")
                except Exception as ocr_err:
                    logger.warning(f"RapidOCR image extraction failed ({ocr_err}); trying PyMuPDF.")
                    import fitz
                    doc = fitz.open(stream=file_path.read_bytes(), filetype=suffix[1:])
                    text_parts = [f"# Extracted Content for {filename_stem}\n"]
                    for i, page in enumerate(doc):
                        t = page.get_text("text").strip()
                        if t:
                            text_parts.append(f"## Page {i + 1}\n" + t)
                    md_content = "\n\n".join(text_parts)
            elif suffix == ".pdf":
                try:
                    import fitz
                    doc = fitz.open(str(file_path))
                    text_parts = [f"# Extracted Content for {filename_stem}\n"]
                    for i, page in enumerate(doc):
                        t = page.get_text("text").strip()
                        if t:
                            text_parts.append(f"## Page {i + 1}\n" + t)
                    md_content = "\n\n".join(text_parts)
                    avg_chars_per_page = len(md_content.strip()) / max(1, len(doc))
                    if len(md_content.strip()) < 50 or avg_chars_per_page < 100:
                        # Image-heavy or scanned PDF: run RapidOCR (PP-OCRv5 ONNX) on rendered page images
                        logger.info(f"Page text density low ({avg_chars_per_page:.1f} chars/page). Running RapidOCR ONNX on {len(doc)} pages...")
                        from rapidocr_onnxruntime import RapidOCR
                        ocr_engine = RapidOCR()
                        ocr_lines = []
                        all_scores = []
                        for i, page in enumerate(doc):
                            pix = page.get_pixmap(dpi=150)
                            img_bytes = pix.tobytes("png")
                            res, _ = ocr_engine(img_bytes)
                            if res:
                                page_text = "\n".join([line[1] for line in res])
                                ocr_lines.append(f"## Page {i + 1}\n" + page_text)
                                all_scores.extend([float(line[2]) for line in res if len(line) >= 3])
                        if ocr_lines:
                            md_content = f"# Extracted Content for {filename_stem}\n\n" + "\n\n".join(ocr_lines)
                            middle_file = output_dir / f"{filename_stem}_middle.json"
                            middle_data = {
                                "pdf_info": [{
                                    "blocks": [{
                                        "lines": [{"confidence": s} for s in all_scores]
                                    }]
                                }]
                            }
                            middle_file.write_text(json.dumps(middle_data), encoding="utf-8")
                except Exception as pdf_err:
                    logger.warning(f"PDF extraction failed ({pdf_err}).")
                    md_content = f"# Extracted Content for {filename_stem}\n"
            elif suffix == ".docx":
                import docx
                doc = docx.Document(file_path)
                md_content = f"# Extracted Content for {filename_stem}\n\n" + "\n\n".join([p.text for p in doc.paragraphs if p.text.strip()])
            else:
                md_content = f"# Extracted Content for {filename_stem}\n\n" + file_path.read_text("utf-8", errors="ignore")
        except Exception as fitz_err:
            logger.warning(f"Fallback extraction failed ({fitz_err}); writing basic header.")
            md_content = f"# Extracted Content for {filename_stem}\n"

        md_file = output_dir / f"{filename_stem}.md"
        md_file.write_text(md_content, encoding="utf-8")
        return md_file


def calculate_confidence(middle_json_path: Path) -> float | None:
    if not middle_json_path.exists():
        return None
    try:
        data = json.loads(middle_json_path.read_text(encoding="utf-8"))
        confidences = []
        for page in data.get("pdf_info", []):
            for block in page.get("blocks", []):
                if "lines" in block:
                    for line in block["lines"]:
                        if "confidence" in line:
                            confidences.append(float(line["confidence"]))
        return sum(confidences) / len(confidences) if confidences else None
    except Exception:
        return None


def process_file_with_sdk(file_path: Path, output_dir: Path, force: bool = False) -> OCRResult:
    output_dir.mkdir(parents=True, exist_ok=True)
    stem = file_path.stem
    md_file = output_dir / f"{stem}.md"
    middle_file = output_dir / f"{stem}_middle.json"
    cache_file = output_dir / ".mineru_cache.json"

    cache_data = {}
    if cache_file.exists():
        try:
            cache_data = json.loads(cache_file.read_text(encoding="utf-8"))
        except Exception:
            pass

    current_hash = _compute_hash(file_path)
    if not force and md_file.exists() and cache_data.get(file_path.name) == current_hash:
        conf = calculate_confidence(middle_file)
        return OCRResult(file_path, md_file, md_file.read_text(encoding="utf-8"), conf, is_cached=True)

    res_md = _run_unipipe_parse(file_path, output_dir)
    conf = calculate_confidence(middle_file)

    cache_data[file_path.name] = current_hash
    cache_file.write_text(json.dumps(cache_data, indent=2), encoding="utf-8")

    return OCRResult(file_path, res_md, res_md.read_text(encoding="utf-8"), conf, is_cached=False)
