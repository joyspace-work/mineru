from __future__ import annotations

from datetime import datetime
from pathlib import Path
import csv
import hashlib
import json
import os
import re
import sqlite3
import time
from typing import Any

import requests
from dotenv import load_dotenv

from .classify_inputs import classify_inputs
from .excel_parser import parse_excel_file
from .gemini_extract import (
    process_ocr_output,
    process_text_file,
    process_vision_fallback_file,
)
from .ocr_process import main as ocr_process_main


PROJECT_ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", PROJECT_ROOT / "output"))


def input_dir() -> Path:
    return Path(os.getenv("PIPELINE_INPUT_DIR", PROJECT_ROOT / "input"))


def classified_dir() -> Path:
    return Path(os.getenv("CLASSIFIED_DIR", input_dir() / "classified"))


INPUT_DIR = input_dir()
CLASSIFIED_DIR = classified_dir()
RECOGNIZED_DIR = OUTPUT_DIR / "recognized" / "mineru"


BRAND_MODEL_MAP = {
    ("比亚迪", "海豚"): ("BYD", "Dolphin"),
    ("比亚迪", "海鸥"): ("BYD", "Seagull"),
    ("比亚迪", "汉 EV"): ("BYD", "Han EV"),
    ("比亚迪", "秦 PLUS"): ("BYD", "Qin PLUS EV"),
    ("比亚迪", "海豹"): ("BYD", "Seal"),
    ("吉利", "银河 E5"): ("Geely", "Galaxy E5"),
    ("吉利", "银河 M9"): ("Geely", "Galaxy M9"),
    ("远程", "星享V"): ("Farizon", "Xingxiang V"),
    ("远程", "V6E"): ("Farizon", "V6E"),
    ("远程", "V7E"): ("Farizon", "V7E"),
    ("远程", "V8E"): ("Farizon", "V8E"),
}

ALLOWED_EDIT_KEYS = [
    "model_id", "brand", "model", "trim_config", "exterior_color", "interior_color",
    "manufacture_date", "stock_quantity", "min_quantity", "max_quantity", "lead_time",
    "order_waiting_period", "order_wait_days", "steering_setup", "version_type",
    "status_vehicle", "official_suggested_price_cny", "official_suggested_price_usd",
    "cost_exw_cny", "cost_exw_usd", "cost_fob_cny", "cost_fob_usd", "cost_fca_cny",
    "cost_fca_usd", "cost_cif_cny", "cost_cif_usd", "location", "supplier", "notes",
    "status",
]


def init_environment() -> None:
    load_dotenv(PROJECT_ROOT / ".env", override=False)


def compute_file_hash(file_path: Path) -> str:
    h = hashlib.sha256()
    with file_path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def normalize_date_value(value: Any) -> str | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, (int, float)):
        return None
    raw = str(value).strip()
    if not raw:
        return None
    ymd = re.search(r"(20\d{2})[年./-](\d{1,2})[月./-](\d{1,2})(?:日|$)", raw)
    if ymd:
        year, month, day = ymd.groups()
        return f"{year}-{month.zfill(2)}-{day.zfill(2)}"
    ym = re.search(r"(20\d{2})\D{0,3}(\d{1,2})", raw)
    if ym:
        year, month = ym.groups()
        return f"{year}-{month.zfill(2)}-01"
    return None


def feishu_datetime_value(value: Any) -> int | None:
    normalized = normalize_date_value(value)
    if not normalized:
        return None
    try:
        dt = datetime.strptime(normalized, "%Y-%m-%d")
    except ValueError:
        return None
    return int(dt.timestamp() * 1000)


def get_manufacture_date(row: dict[str, Any]) -> str | None:
    for key in ("manufactureDate", "manufacture_date", "productionDate", "production_date", "time"):
        value = normalize_date_value(row.get(key))
        if value:
            return value
    return None


def to_number(value: Any) -> float | None:
    if value in (None, ""):
        return None
    cleaned = re.sub(r"[^0-9.]", "", str(value))
    if not cleaned:
        return None
    try:
        number = float(cleaned)
    except ValueError:
        return None
    return int(number) if number.is_integer() else number


def parse_wait_days(value: Any) -> int | None:
    text = str(value or "")
    range_week = re.search(r"(\d+)\s*[-~至]\s*(\d+)\s*周", text)
    if range_week:
        return int(range_week.group(2)) * 7
    single_week = re.search(r"(\d+)\s*周", text)
    if single_week:
        return int(single_week.group(1)) * 7
    days = re.search(r"(\d+)\s*天", text)
    if days:
        return int(days.group(1))
    months = re.search(r"(\d+)\s*个?月", text)
    if months:
        return int(months.group(1)) * 30
    return None


def get_db(db_path: Path | None = None) -> sqlite3.Connection:
    configured_path = os.getenv("LOCAL_SOURCE_DB_PATH")
    target_path = db_path or (Path(configured_path) if configured_path else PROJECT_ROOT / "local_source.db")
    db = sqlite3.connect(target_path)
    db.row_factory = sqlite3.Row
    db.execute("""
        CREATE TABLE IF NOT EXISTS source_candidates (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          model_id TEXT,
          brand TEXT,
          model TEXT,
          trim_config TEXT,
          manufacture_date TEXT,
          exterior_color TEXT,
          interior_color TEXT,
          stock_quantity INTEGER,
          min_quantity INTEGER,
          max_quantity INTEGER,
          lead_time TEXT,
          order_waiting_period TEXT,
          order_wait_days INTEGER,
          steering_setup TEXT,
          version_type TEXT,
          status_vehicle TEXT,
          official_suggested_price_cny REAL,
          official_suggested_price_usd REAL,
          cost_exw_cny REAL,
          cost_exw_usd REAL,
          cost_fob_cny REAL,
          cost_fob_usd REAL,
          cost_fca_cny REAL,
          cost_fca_usd REAL,
          cost_cif_cny REAL,
          cost_cif_usd REAL,
          location TEXT,
          supplier TEXT,
          notes TEXT,
          status TEXT DEFAULT 'pending',
          source_file TEXT,
          content_hash TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    db.execute("""
        CREATE TABLE IF NOT EXISTS processed_files (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          filename TEXT,
          content_hash TEXT UNIQUE,
          processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    db.commit()
    return db


def load_model_index() -> dict[tuple[str, str], str]:
    path = PROJECT_ROOT / "feishu_tables" / "vehicle_models.json"
    try:
        data = json.loads(path.read_text("utf-8"))
    except Exception:
        return {}
    index: dict[tuple[str, str], str] = {}
    for record in data.get("records", []):
        brand = str(record.get("brand") or "").lower()
        model = str(record.get("model") or "").lower()
        model_id = record.get("model_id")
        if brand and model and model_id:
            index[(brand, model)] = str(model_id)
    return index


def normalize_brand_model(brand: Any, model: Any) -> tuple[str | None, str | None]:
    brand_text = str(brand or "").strip()
    model_text = str(model or "").strip()
    if not brand_text or not model_text:
        return brand_text or None, model_text or None
    for (raw_brand, raw_model), mapped in BRAND_MODEL_MAP.items():
        if raw_brand in brand_text and raw_model.lower() in model_text.lower():
            return mapped
    if brand_text == "比亚迪":
        brand_text = "BYD"
    elif brand_text == "吉利":
        brand_text = "Geely"
    elif brand_text == "远程":
        brand_text = "Farizon"
    if model_text == "海鸥":
        model_text = "Seagull"
    elif model_text == "海豚":
        model_text = "Dolphin"
    return brand_text, model_text


def _cost_usd(value: Any, currency: Any = None) -> float | None:
    number = to_number(value)
    if number is None:
        return None
    cur = str(currency or "").upper()
    if cur == "CNY" or (not cur and number >= 30000):
        return None
    return number


def _cost_cny(value: Any, currency: Any = None) -> float | None:
    number = to_number(value)
    if number is None:
        return None
    cur = str(currency or "").upper()
    if cur == "CNY" or (not cur and number >= 30000):
        return number
    return None


def _explicit_number(*values: Any) -> float | None:
    for value in values:
        number = to_number(value)
        if number is not None:
            return number
    return None


def format_candidates_for_feishu(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    model_index = load_model_index()
    formatted: list[dict[str, Any]] = []
    for row in rows:
        brand, model = normalize_brand_model(row.get("brand"), row.get("modelName") or row.get("model"))
        if not brand or not model:
            continue
        wait_days = to_number(row.get("orderWaitDays") or row.get("order_wait_days")) or parse_wait_days(row.get("leadTimeText") or row.get("orderWaitingPeriod"))
        steering_raw = f"{row.get('steeringSetup') or ''} {row.get('steering_setup') or ''} {row.get('notes') or ''} {row.get('trimName') or ''} {row.get('trim_config') or ''}".upper()
        steering = "左舵" if ("左舵" in steering_raw or "LHD" in steering_raw) else ("右舵" if ("右舵" in steering_raw or "RHD" in steering_raw) else None)
        version_raw = f"{row.get('marketRegion') or ''} {row.get('market_region') or ''} {row.get('version_type') or ''} {row.get('notes') or ''} {row.get('trimName') or ''} {row.get('trim_config') or ''}"
        version_type = row.get("market_region") or row.get("version_type")
        if "国内" in version_raw or "中规" in version_raw:
            version_type = "国内版"
        elif any(token in version_raw for token in ("国际", "出口", "海外", "欧标", "美规")):
            version_type = "国际版"
        model_id = row.get("model_id") or row.get("modelId") or model_index.get((brand.lower(), model.lower()))
        formatted.append({
            "model_id": model_id,
            "brand": brand,
            "model": model,
            "trim_config": row.get("trimName") or row.get("trimConfig") or row.get("trim_config"),
            "manufacture_date": get_manufacture_date(row),
            "exterior_color": row.get("exteriorColor") or row.get("exterior_color") or row.get("color"),
            "interior_color": row.get("interiorColor") or row.get("interior_color"),
            "stock_quantity": to_number(row.get("stockQuantity") or row.get("stock_quantity") or row.get("quantity")),
            "min_quantity": to_number(row.get("minQuantity") or row.get("min_quantity")),
            "max_quantity": to_number(row.get("maxQuantity") or row.get("max_quantity")),
            "lead_time": row.get("leadTime") or row.get("lead_time"),
            "order_waiting_period": row.get("orderWaitingPeriod") or row.get("order_waiting_period") or row.get("leadTimeText"),
            "order_wait_days": wait_days,
            "steering_setup": steering,
            "version_type": version_type,
            "status_vehicle": row.get("statusVehicle") or row.get("status_vehicle"),
            "official_suggested_price_cny": to_number(row.get("officialPrice") or row.get("officialPriceCny") or row.get("official_suggested_price_cny")),
            "official_suggested_price_usd": to_number(row.get("officialPriceUsd") or row.get("official_suggested_price_usd")),
            "cost_exw_cny": to_number(row.get("costExwCny") or row.get("cost_exw_cny")) or _cost_cny(row.get("priceExw"), row.get("priceExwCurrency")),
            "cost_exw_usd": _explicit_number(row.get("costExwUsd"), row.get("cost_exw_usd")) or _cost_usd(row.get("priceExw"), row.get("priceExwCurrency")),
            "cost_fob_cny": to_number(row.get("costFobCny") or row.get("cost_fob_cny")) or _cost_cny(row.get("priceFob"), row.get("priceFobCurrency")),
            "cost_fob_usd": _explicit_number(row.get("costFobUsd"), row.get("cost_fob_usd")) or _cost_usd(row.get("priceFob"), row.get("priceFobCurrency")),
            "cost_fca_cny": to_number(row.get("costFcaCny") or row.get("cost_fca_cny")) or _cost_cny(row.get("priceFca"), row.get("priceFcaCurrency")),
            "cost_fca_usd": _explicit_number(row.get("costFcaUsd"), row.get("cost_fca_usd")) or _cost_usd(row.get("priceFca"), row.get("priceFcaCurrency")),
            "cost_cif_cny": to_number(row.get("costCifCny") or row.get("cost_cif_cny")) or _cost_cny(row.get("priceCif"), row.get("priceCifCurrency")),
            "cost_cif_usd": _explicit_number(row.get("costCifUsd"), row.get("cost_cif_usd")) or _cost_usd(row.get("priceCif"), row.get("priceCifCurrency")),
            "location": row.get("location"),
            "supplier": row.get("supplierName") or row.get("supplier"),
            "notes": row.get("notes"),
            "source_file": row.get("_source_file") or row.get("source_file"),
            "content_hash": row.get("_content_hash") or row.get("content_hash"),
        })
    return formatted


def record_to_feishu_fields(record: dict[str, Any]) -> dict[str, Any]:
    allowed = [
        "model_id", "brand", "model", "trim_config", "manufacture_date", "exterior_color",
        "interior_color", "stock_quantity", "supplier", "location", "notes", "min_quantity",
        "max_quantity", "official_suggested_price_cny", "cost_fca_usd", "cost_fob_usd",
        "cost_exw_usd", "cost_cif_usd", "steering_setup", "order_wait_days",
    ]
    fields = {key: record[key] for key in allowed if record.get(key) not in (None, "")}
    if fields.get("manufacture_date"):
        converted_date = feishu_datetime_value(fields["manufacture_date"])
        if converted_date is not None:
            fields["manufacture_date"] = converted_date
        else:
            fields.pop("manufacture_date", None)
    if record.get("version_type"):
        fields["market_region"] = [record["version_type"]]
    return fields


def adapt_fields_to_feishu_table(fields: dict[str, Any], table_field_names: set[str]) -> dict[str, Any]:
    adapted = dict(fields)
    if "production_date" in table_field_names and "manufacture_date" not in table_field_names and "manufacture_date" in adapted:
        adapted["production_date"] = adapted.pop("manufacture_date")
    return {key: value for key, value in adapted.items() if key in table_field_names}


def save_candidates_to_db(db: sqlite3.Connection, candidates: list[dict[str, Any]]) -> list[int]:
    columns = [
        "model_id", "brand", "model", "trim_config", "manufacture_date", "exterior_color",
        "interior_color", "stock_quantity", "min_quantity", "max_quantity", "lead_time",
        "order_waiting_period", "order_wait_days", "steering_setup", "version_type",
        "status_vehicle", "official_suggested_price_cny", "official_suggested_price_usd",
        "cost_exw_cny", "cost_exw_usd", "cost_fob_cny", "cost_fob_usd", "cost_fca_cny",
        "cost_fca_usd", "cost_cif_cny", "cost_cif_usd", "location", "supplier", "notes",
        "status", "source_file", "content_hash",
    ]
    placeholders = ",".join("?" for _ in columns)
    ids: list[int] = []
    for row in candidates:
        values = [row.get(col) if col != "status" else "pending" for col in columns]
        cursor = db.execute(f"INSERT INTO source_candidates ({','.join(columns)}) VALUES ({placeholders})", values)
        ids.append(int(cursor.lastrowid))
    db.commit()
    return ids


def mark_candidates_synced(db: sqlite3.Connection, ids: list[int]) -> None:
    db.executemany("UPDATE source_candidates SET status = 'synced' WHERE id = ?", [(i,) for i in ids])
    db.commit()


def run_ocr(force: bool = False, backend: str | None = None, effort: str | None = None, method: str | None = None) -> bool:
    argv = ["--engine", "mineru"]
    if force:
        argv.append("--force")
    overrides = {
        "MINERU_BACKEND": backend,
        "MINERU_EFFORT": effort,
        "MINERU_METHOD": method,
    }
    previous = {key: os.environ.get(key) for key in overrides}
    try:
        for key, value in overrides.items():
            if value:
                os.environ[key] = value
        return ocr_process_main(argv) == 0
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def read_recognition_manifest() -> dict[str, Any] | None:
    try:
        return json.loads((RECOGNIZED_DIR / "manifest.json").read_text("utf-8"))
    except Exception:
        return None


def has_recognized_files() -> bool:
    manifest = read_recognition_manifest()
    return bool(isinstance(manifest, dict) and manifest.get("files"))


def has_recognition_errors() -> bool:
    try:
        data = json.loads((RECOGNIZED_DIR / "errors.json").read_text("utf-8"))
    except Exception:
        return False
    return bool(data.get("errors"))


def warn_low_confidence_recognition(manifest: dict[str, Any] | None = None) -> None:
    manifest = manifest if manifest is not None else read_recognition_manifest()
    if not isinstance(manifest, dict):
        return
    for item in manifest.get("files", []):
        quality = item.get("recognition_quality") or {}
        if not quality.get("requires_manual_review"):
            continue
        source = item.get("source_rel") or item.get("source") or item.get("output_path") or "unknown"
        threshold = quality.get("threshold")
        min_confidence = quality.get("min_confidence")
        low_count = quality.get("low_confidence_count")
        print(
            "⚠️  MinerU 识别置信度低于阈值，建议人工判别："
            f"{source}，min={min_confidence}，低置信片段={low_count}，阈值={threshold}"
        )


def validate_ai_config() -> tuple[bool, str]:
    provider = os.getenv("AI_PROVIDER", "deepseek").strip().lower()
    if provider == "deepseek":
        return (bool(os.getenv("DEEPSEEK_API_KEY")), "未配置 DEEPSEEK_API_KEY")
    if provider == "openrouter":
        return (bool(os.getenv("OPENROUTER_API_KEY")), "未配置 OPENROUTER_API_KEY")
    return (bool(os.getenv("GEMINI_API_KEY")), "未配置 GEMINI_API_KEY")


def _already_processed(db: sqlite3.Connection, content_hash: str) -> bool:
    return db.execute("SELECT 1 FROM processed_files WHERE content_hash = ?", (content_hash,)).fetchone() is not None


def _mark_processed(db: sqlite3.Connection, filename: str, content_hash: str, dry_run: bool) -> None:
    if dry_run:
        return
    db.execute("INSERT OR IGNORE INTO processed_files (filename, content_hash) VALUES (?, ?)", (filename, content_hash))
    db.commit()


def run_excel_parsing(db: sqlite3.Connection, dry_run: bool = False) -> list[dict[str, Any]]:
    excel_dir = classified_dir() / "excels"
    output_dir = OUTPUT_DIR / "parsed" / "excels"
    output_dir.mkdir(parents=True, exist_ok=True)
    results: list[dict[str, Any]] = []
    for file_path in sorted(excel_dir.glob("*")) if excel_dir.exists() else []:
        if file_path.suffix.lower() not in {".xlsx", ".xls", ".csv"}:
            continue
        content_hash = compute_file_hash(file_path)
        if _already_processed(db, content_hash):
            print(f"Skipping already processed file: {file_path.name}")
            continue
        rows = parse_excel_file(file_path)
        for row in rows:
            row["_content_hash"] = content_hash
            row["_source_file"] = file_path.name
        out_path = output_dir / f"{file_path.stem}.json"
        out_path.write_text(json.dumps(rows, ensure_ascii=False, indent=2), "utf-8")
        results.append({"source": str(file_path), "outputPath": str(out_path), "rowCount": len(rows), "rows": rows})
        _mark_processed(db, file_path.name, content_hash, dry_run)
    (output_dir / "manifest.json").write_text(json.dumps({
        "processedAt": datetime.now().isoformat(),
        "totalFiles": len(results),
        "totalRows": sum(r["rowCount"] for r in results),
        "files": [{k: r[k] for k in ("source", "outputPath", "rowCount")} for r in results],
    }, ensure_ascii=False, indent=2), "utf-8")
    return results


def run_extraction(
    ocr_success: bool,
    db: sqlite3.Connection,
    dry_run: bool,
    allow_vision_fallback: bool = False,
    ocr_output: str | None = None,
) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    if ocr_output:
        output_path = Path(ocr_output)
        if not output_path.exists():
            print(f"OCR output not found: {output_path}")
            return []
        rows = process_ocr_output(output_path, output_path.name)
        content_hash = compute_file_hash(output_path)
        for row in rows:
            row["_content_hash"] = content_hash
            row["_source_file"] = output_path.name
        candidates.extend(rows)
        return candidates
    elif ocr_success and has_recognized_files():
        manifest = read_recognition_manifest() or {}
        for item in manifest.get("files", []):
            source = Path(item.get("source") or item.get("output_path"))
            output_path = Path(item["output_path"])
            if not output_path.exists():
                continue
            hash_path = source if source.exists() else output_path
            content_hash = compute_file_hash(hash_path)
            if _already_processed(db, content_hash):
                continue
            rows = process_ocr_output(output_path, item.get("source_rel") or output_path.name)
            for row in rows:
                row["_content_hash"] = content_hash
                row["_source_file"] = Path(item.get("source_rel") or output_path.name).name
            candidates.extend(rows)
            _mark_processed(db, row["_source_file"] if rows else output_path.name, content_hash, dry_run)
    elif allow_vision_fallback:
        for bucket, suffixes in {"images": {".png", ".jpg", ".jpeg", ".webp", ".gif"}, "pdfs": {".pdf"}}.items():
            bucket_dir = classified_dir() / bucket
            for file_path in sorted(bucket_dir.glob("*")) if bucket_dir.exists() else []:
                if file_path.suffix.lower() not in suffixes:
                    continue
                content_hash = compute_file_hash(file_path)
                if _already_processed(db, content_hash):
                    continue
                rows = process_vision_fallback_file(file_path)
                for row in rows:
                    row["_content_hash"] = content_hash
                    row["_source_file"] = file_path.name
                candidates.extend(rows)
                _mark_processed(db, file_path.name, content_hash, dry_run)

    text_dir = classified_dir() / "texts"
    for file_path in sorted(text_dir.glob("*")) if text_dir.exists() else []:
        if file_path.suffix.lower() not in {".txt", ".md"}:
            continue
        content_hash = compute_file_hash(file_path)
        if _already_processed(db, content_hash):
            continue
        rows = process_text_file(file_path)
        for row in rows:
            row["_content_hash"] = content_hash
            row["_source_file"] = file_path.name
        candidates.extend(rows)
        _mark_processed(db, file_path.name, content_hash, dry_run)
    return candidates


def save_final_output(candidates: list[dict[str, Any]]) -> tuple[Path, Path]:
    final_dir = OUTPUT_DIR / "final"
    final_dir.mkdir(parents=True, exist_ok=True)
    date = datetime.now().date().isoformat()
    json_path = final_dir / f"candidates_{date}.json"
    csv_path = final_dir / f"candidates_{date}.csv"
    json_path.write_text(json.dumps(candidates, ensure_ascii=False, indent=2), "utf-8")
    fields = [
        "brand", "model", "trim_config", "manufacture_date", "exterior_color", "interior_color",
        "stock_quantity", "supplier", "location", "notes", "official_suggested_price_cny",
        "cost_exw_cny", "cost_exw_usd", "cost_fob_cny", "cost_fob_usd", "cost_fca_cny",
        "cost_fca_usd", "cost_cif_cny", "cost_cif_usd", "min_quantity", "max_quantity",
        "steering_setup", "version_type", "order_wait_days",
    ]
    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(candidates)
    return json_path, csv_path


def save_raw_candidates(candidates: list[dict[str, Any]]) -> Path:
    final_dir = OUTPUT_DIR / "final"
    final_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = final_dir / f"raw_candidates_{timestamp}.json"
    path.write_text(json.dumps(candidates, ensure_ascii=False, indent=2), "utf-8")
    return path


def latest_raw_candidates_path() -> Path | None:
    final_dir = OUTPUT_DIR / "final"
    candidates = sorted(final_dir.glob("raw_candidates_*.json")) if final_dir.exists() else []
    return max(candidates, key=lambda path: path.stat().st_mtime) if candidates else None


def load_latest_raw_candidates() -> list[dict[str, Any]]:
    return load_raw_candidates()


def load_raw_candidates(path: str | Path | None = None) -> list[dict[str, Any]]:
    path = Path(path) if path else latest_raw_candidates_path()
    if not path:
        return []
    data = json.loads(path.read_text("utf-8"))
    return data if isinstance(data, list) else []


def fetch_with_retry(method: str, url: str, *, max_retries: int = 3, initial_delay: float = 1.0, **kwargs: Any) -> dict[str, Any]:
    delay = initial_delay
    last_error: Exception | None = None
    for attempt in range(1, max_retries + 1):
        try:
            response = requests.request(method, url, timeout=60, **kwargs)
            data = response.json() if response.text else {}
            msg = str(data.get("msg") or data.get("message") or "").lower()
            if response.status_code in (429,) or response.status_code >= 500:
                raise RuntimeError(f"HTTP status {response.status_code}")
            if data.get("code") not in (None, 0):
                code = int(data.get("code", -1))
                if code == 99991400 or any(token in msg for token in ("rate limit", "frequency", "too many", "throttled")) or code >= 500000:
                    raise RuntimeError(f"Feishu API Error {code}: {data.get('msg')}")
            return data
        except Exception as exc:
            last_error = exc
            if attempt == max_retries:
                break
            print(f"Fetch retry {attempt}/{max_retries} failed: {exc}. Retrying in {delay}s...")
            time.sleep(delay)
            delay *= 2
    raise RuntimeError(str(last_error))


def fetch_feishu_table_field_names(access_token: str, app_token: str, table_id: str) -> set[str]:
    url = f"https://open.feishu.cn/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/fields?page_size=100"
    data = fetch_with_retry("GET", url, headers={"Authorization": f"Bearer {access_token}"})
    if data.get("code") != 0:
        print(f"Feishu field list failed: {data.get('msg')}")
        return set()
    items = data.get("data", {}).get("items", [])
    return {str(item.get("field_name") or item.get("name")) for item in items if item.get("field_name") or item.get("name")}


def sync_to_feishu(candidates: list[dict[str, Any]], dry_run: bool = False) -> bool:
    if dry_run:
        print("Dry run - skipping Feishu upload")
        return True
    app_id = os.getenv("FEISHU_APP_ID") or os.getenv("LARK_APP_ID")
    app_secret = os.getenv("FEISHU_APP_SECRET") or os.getenv("LARK_APP_SECRET")
    app_token = os.getenv("FEISHU_BITABLE_APP_TOKEN")
    table_id = os.getenv("FEISHU_BITABLE_TABLE_ID")
    if not all([app_id, app_secret, app_token, table_id]):
        print("Feishu is not configured; records remain pending.")
        return False
    token_data = fetch_with_retry(
        "POST",
        "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
        json={"app_id": app_id, "app_secret": app_secret},
        headers={"Content-Type": "application/json"},
    )
    if token_data.get("code") != 0:
        print(f"Feishu auth failed: {token_data.get('msg')}")
        return False
    access_token = token_data["tenant_access_token"]
    table_field_names = fetch_feishu_table_field_names(access_token, app_token, table_id)
    if not table_field_names:
        print("Feishu table fields could not be loaded; upload aborted.")
        return False
    uploaded = 0
    url = f"https://open.feishu.cn/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/records/batch_create"
    for index in range(0, len(candidates), 100):
        batch = candidates[index:index + 100]
        records = [
            {"fields": adapt_fields_to_feishu_table(record_to_feishu_fields(record), table_field_names)}
            for record in batch
        ]
        data = fetch_with_retry(
            "POST",
            url,
            headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
            json={"records": records},
        )
        if data.get("code") == 0:
            uploaded += len(batch)
        else:
            print(f"Feishu batch failed: {data.get('msg')}")
    print(f"Feishu upload complete: {uploaded}/{len(candidates)}")
    return uploaded > 0


def run_pipeline(args: Any) -> int:
    init_environment()
    db = get_db()
    try:
        if not args.skip_classify:
            stats = classify_inputs(input_dir())
            print(f"Classified {stats.classified} files; deleted {stats.deleted} junk files.")
        ocr_success = True if args.skip_ocr else run_ocr(
            force=args.force_ocr,
            backend=getattr(args, "backend", None),
            effort=getattr(args, "effort", None),
            method=getattr(args, "method", None),
        )
        if ocr_success:
            warn_low_confidence_recognition()
        excel_results = run_excel_parsing(db, args.dry_run)
        ok, message = validate_ai_config()
        ai_candidates = [] if not ok else run_extraction(
            ocr_success,
            db,
            args.dry_run,
            args.vision_fallback,
            getattr(args, "ocr_output", None),
        )
        if not ok:
            print(f"AI extraction skipped: {message}")
        merged = [row for result in excel_results for row in result["rows"]] + ai_candidates
        formatted = format_candidates_for_feishu(merged)
        if not formatted:
            print("No candidates extracted.")
            return 1
        json_path, csv_path = save_final_output(formatted)
        if args.dry_run:
            print("Dry run - skipping SQLite write and Feishu upload")
        else:
            ids = save_candidates_to_db(db, formatted)
            if sync_to_feishu(formatted, False):
                mark_candidates_synced(db, ids)
        print(f"Pipeline complete: {len(formatted)} candidates")
        print(f"JSON: {json_path}")
        print(f"CSV: {csv_path}")
        return 0
    finally:
        db.close()


def action_recognize(args: Any) -> int:
    init_environment()
    if not getattr(args, "skip_classify", False):
        stats = classify_inputs(input_dir())
        print(f"Classified {stats.classified} files; deleted {stats.deleted} junk files.")
    ok = run_ocr(
        force=getattr(args, "force_ocr", False),
        backend=getattr(args, "backend", None),
        effort=getattr(args, "effort", None),
        method=getattr(args, "method", None),
    )
    if ok:
        warn_low_confidence_recognition()
        print("Recognition layer complete.")
        return 0
    print("Recognition layer failed.")
    return 1


def action_extract(args: Any) -> int:
    init_environment()
    ok, message = validate_ai_config()
    if not ok:
        print(f"AI extraction skipped: {message}")
        return 1
    db = get_db()
    try:
        rows = run_extraction(
            True,
            db,
            True,
            getattr(args, "vision_fallback", False),
            getattr(args, "ocr_output", None),
        )
    finally:
        db.close()
    if not rows:
        print("No raw candidates extracted.")
        return 1
    path = save_raw_candidates(rows)
    print(f"Transformation layer complete: {len(rows)} raw candidates")
    print(f"Raw JSON: {path}")
    return 0


def action_aggregate(args: Any) -> int:
    init_environment()
    raw = load_raw_candidates(getattr(args, "raw_candidates", None))
    if not raw:
        print("No raw candidates found. Run extraction first.")
        return 1
    formatted = format_candidates_for_feishu(raw)
    if not formatted:
        print("No formatted candidates generated.")
        return 1
    json_path, csv_path = save_final_output(formatted)
    if getattr(args, "dry_run", False):
        print("Dry run - skipping SQLite write and Feishu upload")
    else:
        db = get_db()
        try:
            save_candidates_to_db(db, formatted)
        finally:
            db.close()
        print(f"Saved {len(formatted)} candidates to local_source.db")
    print(f"Aggregation layer complete: {len(formatted)} candidates")
    print(f"JSON: {json_path}")
    print(f"CSV: {csv_path}")
    return 0


def list_pending(db: sqlite3.Connection) -> list[sqlite3.Row]:
    return db.execute("SELECT id, brand, model, trim_config, manufacture_date, stock_quantity, cost_exw_usd, status FROM source_candidates WHERE status = 'pending'").fetchall()


def action_list() -> int:
    init_environment()
    db = get_db()
    try:
        rows = list_pending(db)
        if not rows:
            print("No pending candidate records found in local_source.db.")
            return 0
        for row in rows:
            print(dict(row))
        return 0
    finally:
        db.close()


def action_edit(record_id: str, key: str, value: str) -> int:
    if key not in ALLOWED_EDIT_KEYS:
        print(f"Invalid column key: {key}")
        return 1
    init_environment()
    db = get_db()
    try:
        db.execute(f"UPDATE source_candidates SET {key} = ? WHERE id = ?", (value, record_id))
        db.commit()
        print(f"Updated record #{record_id}: {key} = {value}")
        return 0
    finally:
        db.close()


def action_delete(record_id: str) -> int:
    init_environment()
    db = get_db()
    try:
        db.execute("DELETE FROM source_candidates WHERE id = ?", (record_id,))
        db.commit()
        print(f"Deleted record #{record_id}")
        return 0
    finally:
        db.close()


def action_clean() -> int:
    init_environment()
    db = get_db()
    try:
        count = db.execute("DELETE FROM source_candidates").rowcount
        db.commit()
        print(f"Cleaned {count} records from local_source.db.")
        return 0
    finally:
        db.close()


def action_sync(dry_run: bool = False) -> int:
    init_environment()
    db = get_db()
    try:
        rows = [dict(row) for row in db.execute("SELECT * FROM source_candidates WHERE status = 'pending'").fetchall()]
        if not rows:
            print("No pending records to sync in local_source.db.")
            return 0
        if sync_to_feishu(rows, dry_run) and not dry_run:
            mark_candidates_synced(db, [int(row["id"]) for row in rows])
        return 0
    finally:
        db.close()
