from __future__ import annotations

import json
import logging
import os
from pathlib import Path
import re
import sys
from typing import Any

# Ensure src is in PYTHONPATH
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from mineru_pipeline.pipeline import (
    get_db,
    format_candidates_for_feishu,
    save_candidates_to_db,
    sync_to_feishu,
    save_final_output,
    CLASSIFIED_DIR,
)
from mineru_pipeline.excel_parser import parse_excel_file, excel_to_markdown

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("antigravity_sync")


def parse_vehicle_path_info(rel_path: Path) -> dict[str, Any]:
    parts = list(rel_path.parts)
    supplier = parts[0] if len(parts) >= 1 else ""
    stem = rel_path.stem

    trade_info: dict[str, Any] = {}
    term_match = re.search(r"\b(EXW|FOB|FCA)\b\s*¥?\s*([0-9]{3,7})?", stem, re.IGNORECASE)
    if term_match:
        term = term_match.group(1).upper()
        price_str = term_match.group(2)
        if price_str:
            price_val = int(price_str)
            if term == "EXW":
                trade_info["costExwUsd"] = price_val
            elif term == "FOB":
                trade_info["costFobUsd"] = price_val
            elif term == "FCA":
                trade_info["costFcaUsd"] = price_val
        trade_info["trade_term"] = term

    for loc_keyword in ("南沙", "武汉", "深圳", "天津", "上海", "霍尔果斯基地", "霍尔果斯", "广州", "宁波", "青岛"):
        if loc_keyword in stem:
            trade_info["location"] = loc_keyword
            break

    noise_patterns = [
        r"FOB价格表", r"EXW价格表", r"FCA价格表", r"库存价格表", r"价格表", r"报价表", r"价格", r"报价",
        r"订车", r"FOB", r"EXW", r"FCA", r"EXW\d+", r"FOB\d+", r"FCA\d+", r"产品参数.*", r"汇率.*"
    ]

    def clean_text(text: str) -> str:
        t = text
        for p in noise_patterns:
            t = re.sub(p, "", t, flags=re.IGNORECASE)
        return t.strip(" _-.")

    cleaned_stem = clean_text(stem)

    brand_cand = ""
    model_cand = ""

    if len(parts) == 2:
        model_cand = cleaned_stem
    elif len(parts) == 3:
        brand_cand = parts[1]
        model_cand = cleaned_stem if cleaned_stem else parts[1]
    elif len(parts) >= 4:
        brand_cand = parts[1]
        model_cand = parts[2] if clean_text(parts[2]) else cleaned_stem

    if brand_cand and clean_text(brand_cand):
        brand_cand = clean_text(brand_cand)
    if model_cand and clean_text(model_cand):
        model_cand = clean_text(model_cand)

    return {
        "supplierName": supplier,
        "brand": brand_cand,
        "modelName": model_cand,
        **trade_info
    }


def run_antigravity_pipeline(backend: str = "hybrid"):
    os.environ["MINERU_BACKEND"] = backend
    logger.info(f"🚀 Starting Antigravity AI Direct Processing Pipeline (Backend: {backend})...")
    db = get_db()

    all_extracted_candidates: list[dict] = []

    input_dir = Path("input")
    if input_dir.exists():
        for file_path in sorted(input_dir.rglob("*")):
            if not file_path.is_file() or file_path.name.startswith(".") or "classified" in file_path.parts:
                continue

            rel_path = file_path.relative_to(input_dir)
            rel_str = str(rel_path)
            path_info = parse_vehicle_path_info(rel_path)

            suffix = file_path.suffix.lower()
            if suffix in (".xlsx", ".xls", ".csv"):
                logger.info(f"Processing Excel: {rel_str}")
                try:
                    parsed_base = Path("output/parsed")
                    parsed_base.mkdir(parents=True, exist_ok=True)
                    
                    md_content = excel_to_markdown(file_path)
                    target_md = parsed_base / rel_path.with_suffix(".md")
                    target_md.parent.mkdir(parents=True, exist_ok=True)
                    target_md.write_text(md_content, encoding="utf-8")

                    # Flat stem output for easy lookup directly under output/parsed/
                    flat_stem = rel_str.replace("/", "__").replace("\\", "__")
                    (parsed_base / f"{flat_stem}.md").write_text(md_content, encoding="utf-8")

                    rows = parse_excel_file(file_path)
                    if rows:
                        target_json = parsed_base / rel_path.with_suffix(".json")
                        target_json.parent.mkdir(parents=True, exist_ok=True)
                        target_json.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")

                        for row in rows:
                            if path_info["supplierName"] and not row.get("supplierName"):
                                row["supplierName"] = path_info["supplierName"]
                            if path_info["brand"] and not row.get("brand"):
                                row["brand"] = path_info["brand"]
                            if path_info["modelName"] and not row.get("modelName") and not row.get("model"):
                                row["modelName"] = path_info["modelName"]
                            if "costExwUsd" in path_info and not row.get("costExwUsd"):
                                row["costExwUsd"] = path_info["costExwUsd"]
                            if "location" in path_info and not row.get("location"):
                                row["location"] = path_info["location"]
                            row["_source_file"] = rel_str
                        all_extracted_candidates.extend(rows)
                except Exception as e:
                    logger.error(f"Error parsing {rel_str}: {e}")
            elif suffix in (".txt", ".md"):
                logger.info(f"Processing Text Note: {rel_str}")
                content = file_path.read_text(encoding="utf-8", errors="ignore").strip()
                all_extracted_candidates.append({
                    "brand": path_info["brand"] or file_path.parent.name,
                    "supplierName": path_info["supplierName"],
                    "modelName": path_info["modelName"] or file_path.stem,
                    "raw": content or f"Text Note: {file_path.name}",
                    "costExwUsd": path_info.get("costExwUsd"),
                    "costFobUsd": path_info.get("costFobUsd"),
                    "costFcaUsd": path_info.get("costFcaUsd"),
                    "location": path_info.get("location"),
                    "notes": None,
                    "_source_file": rel_str,
                })
            elif suffix in (".png", ".jpg", ".jpeg", ".webp", ".pdf"):
                logger.info(f"Processing MinerU SDK OCR ({backend}): {rel_str}")
                try:
                    from mineru_pipeline.ocr_engine import process_file_with_sdk
                    out_dir = Path("output/recognized/mineru")
                    ocr_res = process_file_with_sdk(file_path, out_dir)
                    all_extracted_candidates.append({
                        "brand": path_info["brand"] or file_path.parent.name,
                        "supplierName": path_info["supplierName"],
                        "modelName": path_info["modelName"] or file_path.stem,
                        "raw": ocr_res.markdown_content or f"MinerU OCR: {file_path.name}",
                        "confidence": ocr_res.avg_confidence,
                        "costExwUsd": path_info.get("costExwUsd"),
                        "costFobUsd": path_info.get("costFobUsd"),
                        "costFcaUsd": path_info.get("costFcaUsd"),
                        "location": path_info.get("location"),
                        "notes": None,
                        "_source_file": rel_str,
                    })
                except Exception as e:
                    logger.error(f"Error running MinerU OCR on {rel_str}: {e}")

    logger.info(f"Extracted {len(all_extracted_candidates)} raw candidate records.")

    # 3. Format candidates for Feishu with RuleEngine normalization
    formatted = format_candidates_for_feishu(all_extracted_candidates)

    # 4. Save candidates to SQLite local_source.db with status 'pending'
    db.execute("DELETE FROM source_candidates WHERE status = 'pending'")
    db.commit()
    ids = save_candidates_to_db(db, formatted)
    logger.info(f"Saved {len(ids)} normalized candidates into SQLite local_source.db with status 'pending'.")

    # 5. Save JSON / CSV outputs with backend tag in filename
    json_path, csv_path = save_final_output(formatted, backend=backend)
    logger.info(f"Saved JSON output: {json_path}")
    logger.info(f"Saved CSV output: {csv_path}")

    # 6. Inform user to review pending candidates in local_source.db before manual sync
    logger.info(f"✅ Processing complete for backend {backend}! Staged to SQLite local_source.db.")


if __name__ == "__main__":
    # Run both hybrid and vlm modes
    run_antigravity_pipeline(backend="hybrid")
    run_antigravity_pipeline(backend="vlm")
