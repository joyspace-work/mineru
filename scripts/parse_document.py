import sys
import os
import json
import subprocess
import shutil
from pathlib import Path

os.environ.setdefault("PADDLE_PDX_ENABLE_MKLDNN_BYDEFAULT", "0")
os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, '..'))

# Dynamic installer helper to ensure light libraries are installed automatically
def import_or_install(package, import_name=None):
    if import_name is None:
        import_name = package
    try:
        return __import__(import_name)
    except ImportError:
        print(f"⌛ Package '{package}' is missing. Attempting to install via pip...", file=sys.stderr)
        try:
            # Silence pip output to keep stdout clean for JSON parsing
            subprocess.check_call(
                [sys.executable, "-m", "pip", "install", package],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
            return __import__(import_name)
        except Exception as e:
            print(f"⚠️ Failed to auto-install '{package}': {e}", file=sys.stderr)
            return None

def parse_txt(file_path):
    encodings = ["utf-8", "gbk", "gb18030", "utf-16"]
    for enc in encodings:
        try:
            with open(file_path, "r", encoding=enc) as f:
                content = f.read().strip()
                if content:
                    return content
        except Exception:
            continue
    return ""

def parse_docx(file_path):
    docx_lib = import_or_install("python-docx", "docx")
    if not docx_lib:
        return None
    try:
        doc = docx_lib.Document(file_path)
        paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
        # Also extract table text
        for table in doc.tables:
            for row in table.rows:
                row_text = [cell.text.strip() for cell in row.cells if cell.text.strip()]
                if row_text:
                    paragraphs.append(" | ".join(row_text))
        return "\n".join(paragraphs)
    except Exception as e:
        print(f"❌ Error parsing docx {file_path}: {e}", file=sys.stderr)
        return None

def parse_text_pdf(file_path):
    pypdf_lib = import_or_install("pypdf")
    if not pypdf_lib:
        return None
    try:
        reader = pypdf_lib.PdfReader(file_path)
        text_content = []
        for i, page in enumerate(reader.pages):
            text = page.extract_text()
            if text and text.strip():
                text_content.append(text)
        full_text = "\n".join(text_content).strip()
        # If extracted text is extremely short, it is likely a scanned/image PDF
        if len(full_text) < 100:
            return None
        return full_text
    except Exception as e:
        print(f"⚠️ pypdf extraction failed or returned scanned PDF: {e}", file=sys.stderr)
        return None

def run_mineru_ocr(file_path):
    from mineru_pipeline.ocr_process import process_with_mineru

    output_dir = os.environ.get("OUTPUT_DIR") or os.path.join(PROJECT_ROOT, "output")
    temp_out_dir = os.path.join(output_dir, "temp_mineru_out")
    os.makedirs(temp_out_dir, exist_ok=True)

    try:
        print(f"⌛ Running MinerU SDK on scanned PDF: {file_path}...", file=sys.stderr)
        md_path = process_with_mineru(Path(file_path), Path(temp_out_dir), None)
        if md_path:
            return Path(md_path).read_text("utf-8").strip()
    except Exception as e:
        print(f"⚠️ MinerU extraction failed: {e}", file=sys.stderr)
    finally:
        shutil.rmtree(temp_out_dir, ignore_errors=True)
    return None

def run_paddle_ocr(file_path):
    # Check if paddleocr python library is available
    try:
        from paddleocr import PaddleOCR
    except ImportError:
        # We don't auto-install paddleocr as it requires deep learning framework packages
        print("⚠️ PaddleOCR library is not installed.", file=sys.stderr)
        return None
        
    try:
        print(f"⌛ Running PaddleOCR on: {file_path}...", file=sys.stderr)
        try:
            ocr = PaddleOCR(
                lang="ch",
                use_doc_orientation_classify=False,
                use_doc_unwarping=False,
                use_textline_orientation=False,
            )
        except Exception:
            ocr = PaddleOCR(lang="ch")
        if hasattr(ocr, "predict"):
            result = ocr.predict(file_path)
        else:
            result = ocr.ocr(file_path)

        lines = []
        for page in result or []:
            if isinstance(page, dict):
                texts = page.get("rec_texts") or page.get("texts") or []
                scores = page.get("rec_scores") or page.get("scores") or [None] * len(texts)
                for text, score in zip(texts, scores):
                    if text and (score is None or float(score) > 0.5):
                        lines.append(str(text).strip())
                continue
            if isinstance(page, list):
                for line in page:
                    try:
                        text = line[1][0]
                        confidence = line[1][1]
                        if confidence > 0.5:
                            lines.append(text)
                    except Exception:
                        continue
        return "\n".join(lines).strip()
    except Exception as e:
        print(f"⚠️ PaddleOCR execution error: {e}", file=sys.stderr)
    return None

def parse_document(file_path):
    ext = os.path.splitext(file_path)[1].lower()
    
    # 1. Direct Text File Parsing
    if ext == ".txt":
        return {"text": parse_txt(file_path), "need_vision": False}
        
    # 2. Docx Parsing
    if ext == ".docx":
        text = parse_docx(file_path)
        if text is not None:
            return {"text": text, "need_vision": False}
        return {"text": "", "need_vision": True}
        
    # 3. PDF Parsing (Text vs Image PDF)
    if ext == ".pdf":
        # First try text extraction
        text = parse_text_pdf(file_path)
        if text:
            print("✅ Text PDF detected. Extracted text successfully.", file=sys.stderr)
            return {"text": text, "need_vision": False}
            
        # Scanned PDF: Try MinerU
        ocr_text = run_mineru_ocr(file_path)
        if ocr_text:
            print("✅ MinerU successfully converted scanned PDF to layout markdown.", file=sys.stderr)
            return {"text": ocr_text, "need_vision": False}
            
        # Fallback to general vision since PDF is scanned and MinerU was not available
        print("⚠️ Scanned PDF detected, but MinerU is unavailable. Fallback to Gemini Vision.", file=sys.stderr)
        return {"text": "", "need_vision": True}
        
    # 4. Images Parsing (PNG, JPG, WebP)
    if ext in [".png", ".jpg", ".jpeg", ".webp"]:
        # Try PaddleOCR
        ocr_text = run_paddle_ocr(file_path)
        if ocr_text:
            print("✅ PaddleOCR successfully parsed image text.", file=sys.stderr)
            return {"text": ocr_text, "need_vision": False}
            
        # Fallback to Gemini Vision
        print("⚠️ Image detected, but PaddleOCR is unavailable. Fallback to Gemini Vision.", file=sys.stderr)
        return {"text": "", "need_vision": True}
        
    return {"text": "", "need_vision": True}

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Missing input file path"}))
        sys.exit(1)
        
    file_path = sys.argv[1]
    if not os.path.exists(file_path):
        print(json.dumps({"error": f"File not found: {file_path}"}))
        sys.exit(1)
        
    try:
        result = parse_document(file_path)
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    main()
