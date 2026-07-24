from __future__ import annotations

import logging
from pathlib import Path
import shutil
import sys

# Ensure src is in PYTHONPATH
PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("classify_input")

INPUT_DIR = PROJECT_ROOT / "input"
CLASSIFIED_DIR = INPUT_DIR / "classified"

EXTENSION_MAP = {
    ".xlsx": "xlsxs",
    ".xls": "xlsxs",
    ".csv": "xlsxs",
    ".pdf": "pdfs",
    ".png": "images",
    ".jpg": "images",
    ".jpeg": "images",
    ".webp": "images",
    ".gif": "images",
    ".docx": "docxs",
    ".pptx": "pptxs",
    ".txt": "docxs",
    ".md": "docxs",
}

KNOWN_BRANDS = {
    "BYD", "比亚迪", "长安", "Deepal", "深蓝", "启源", "吉利", "Geely", "远程",
    "五菱", "Wuling", "东风", "Dongfeng", "广汽", "GAC", "福田", "Foton", "丰田",
    "Toyota", "小米", "Xiaomi", "零跑", "Leapmotor", "上汽", "智己", "捷途", "Jetour",
    "Smart", "山东小车", "阿维塔",
}


def resolve_brand_supplier_model(file_path: Path) -> tuple[str, str, str]:
    rel_parts = file_path.relative_to(INPUT_DIR).parts
    supplier = rel_parts[0] if rel_parts else "通用"
    brand = ""
    model = ""

    # Search middle parts for brand & model
    for part in rel_parts[1:-1]:
        if part in KNOWN_BRANDS or any(b in part for b in KNOWN_BRANDS):
            brand = part
        else:
            if not model:
                model = part
            elif not brand:
                brand = part

    # Smart fallbacks for specific supplier naming conventions
    if not brand:
        if "APT" in supplier:
            brand = "零跑"
            if len(rel_parts) >= 3 and not model:
                model = rel_parts[1]
        elif "山东小车" in supplier:
            brand = "山东小车"
            if "卡王" in file_path.name:
                model = "卡王"
            elif "小钢炮" in file_path.name:
                model = "小钢炮"
        elif "福田" in supplier:
            brand = "福田"
            model = "奥铃"
        elif "新商筹" in supplier:
            brand = "吉利"
            model = "远程"
        elif "车智汇通" in supplier:
            brand = "长安"
        elif "FineUp" in supplier:
            brand = "Smart"
            model = "Smart"
        elif "三只盒子" in supplier:
            brand = "小米"

    # Infer model from filename if still empty
    if not model:
        stem = file_path.stem
        if "ATTO" in stem: model = "ATTO3"
        elif "T03" in stem: model = "T03"
        elif "小马" in stem: model = "小马"
        elif "A7" in stem: model = "A7"
        elif "星耀" in stem: model = "星耀6"
        elif "牛仔" in stem: model = "牛仔"
        elif "V8E" in stem: model = "V8E"
        elif "铂智" in stem: model = "铂智3X"
        elif "智己L6" in stem: model = "L6"
        elif "智己LS6" in stem: model = "LS6"
        elif "i60" in stem: model = "i60"
        elif "卡王" in stem: model = "卡王"
        elif "小钢炮" in stem: model = "小钢炮"

    return brand or "通用", supplier, model


def classify_and_organize_input():
    logger.info("📁 Starting Input Directory Structuring for AI Recognition...")

    if not INPUT_DIR.exists():
        logger.error(f"Input directory does not exist: {INPUT_DIR}")
        return

    # Clean existing classified dir
    if CLASSIFIED_DIR.exists():
        shutil.rmtree(CLASSIFIED_DIR)

    for target_folder in ("docxs", "images", "pdfs", "pptxs", "xlsxs"):
        (CLASSIFIED_DIR / target_folder).mkdir(parents=True, exist_ok=True)

    # Scan unclassified files in input/
    input_files = [
        f for f in INPUT_DIR.rglob("*")
        if f.is_file()
        and not f.name.startswith(".")
        and f.name not in ("Thumbs.db", "desktop.ini")
        and CLASSIFIED_DIR not in f.parents
    ]

    logger.info(f"Discovered {len(input_files)} fresh asset files in input/")

    organized_count = 0
    for file_path in sorted(input_files):
        brand, supplier, model = resolve_brand_supplier_model(file_path)
        filename_stem = file_path.stem.replace("__", "_")

        ext = file_path.suffix.lower()
        target_bucket = EXTENSION_MAP.get(ext, "docxs")

        # Format standardized filename: <Brand>__<Supplier>__<Model>__<Filename>.<ext>
        if model:
            structured_name = f"{brand}__{supplier}__{model}__{filename_stem}{ext}"
        else:
            structured_name = f"{brand}__{supplier}__{filename_stem}{ext}"

        dest_path = CLASSIFIED_DIR / target_bucket / structured_name
        shutil.copy2(file_path, dest_path)
        organized_count += 1
        logger.info(f"Organized: {file_path.relative_to(INPUT_DIR)} -> classified/{target_bucket}/{structured_name}")

    logger.info(f"✅ Input classification complete! Total organized: {organized_count} files in {CLASSIFIED_DIR}")


if __name__ == "__main__":
    classify_and_organize_input()
