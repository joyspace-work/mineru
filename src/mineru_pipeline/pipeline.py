from __future__ import annotations

from datetime import datetime
from pathlib import Path
import csv
import hashlib
import json
import os
import re
import sqlite3
import subprocess
import sys
import time
from typing import Any

import requests
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from dotenv import load_dotenv

from .async_pipeline import run_async_pipeline
from .input_classifier import classify_inputs
from .excel_parser import parse_excel_file, excel_to_markdown
from .llm_extractor import (
    process_ocr_output,
    process_text_file,
    process_vision_fallback_file,
)


PROJECT_ROOT = Path(__file__).resolve().parents[2]
INPUT_DIR = PROJECT_ROOT / "input"
CLASSIFIED_DIR = Path(os.getenv("CLASSIFIED_DIR", PROJECT_ROOT / "input" / "classified"))
OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", PROJECT_ROOT / "output"))
RECOGNIZED_DIR = OUTPUT_DIR / "recognized" / "mineru"


def load_brand_model_map() -> dict[tuple[str, str], tuple[str, str]]:
    config_file = PROJECT_ROOT / "config" / "brand_model_mapping.json"
    mapping: dict[tuple[str, str], tuple[str, str]] = {}
    if config_file.exists():
        try:
            data = json.loads(config_file.read_text("utf-8"))
            for item in data.get("mappings", []):
                raw_b = str(item.get("raw_brand", "")).strip()
                raw_m = str(item.get("raw_model", "")).strip()
                b = str(item.get("brand", "")).strip()
                m = str(item.get("model", "")).strip()
                if raw_b and raw_m and b and m:
                    mapping[(raw_b, raw_m)] = (b, m)
        except Exception:
            pass
    if not mapping:
        mapping = {
            ("问界", "M9"): ("AITO", "M9"),
            ("方程豹", "豹3"): ("Fangchengbao", "Ti 3"),
            ("方程豹", "铁3"): ("Fangchengbao", "Ti 3"),
            ("方程豹", "钛3"): ("Fangchengbao", "Ti 3"),
            ("方程豹", "豹5"): ("Fangchengbao", "Leopard 5"),
            ("方程豹", "豹7"): ("Fangchengbao", "Ti 7"),
            ("方程豹", "钛7"): ("Fangchengbao", "Ti 7"),
            ("方程豹", "TI7"): ("Fangchengbao", "Ti 7"),
            ("方程豹", "豹8"): ("Fangchengbao", "Leopard 8"),
            ("比亚迪", "TI7"): ("Fangchengbao", "Ti 7"),
            ("比亚迪", "海豚"): ("BYD", "Dolphin"),
            ("比亚迪", "汉 EV"): ("BYD", "Han EV"),
            ("比亚迪", "秦 PLUS"): ("BYD", "Qin PLUS EV"),
            ("比亚迪", "海鸥"): ("BYD", "Seagull"),
            ("比亚迪", "海豹"): ("BYD", "Seal"),
            ("比亚迪", "海狮05EV"): ("BYD", "Sealion 7"),
            ("比亚迪", "海狮07EV"): ("BYD", "Sealion 7"),
            ("比亚迪", "海狮 7"): ("BYD", "Sealion 7"),
            ("比亚迪", "鲨鱼"): ("BYD", "Shark"),
            ("比亚迪", "唐 L EV"): ("BYD", "Tang L EV"),
            ("比亚迪", "元 UP"): ("BYD", "Yuan UP"),
            ("长安", "Lumin"): ("Changan", "Lumin"),
            ("长安", "糯玉米"): ("Changan", "Lumin"),
            ("长安启源", "Q05"): ("Changan Nevo", "Q05"),
            ("深蓝", "S05"): ("Deepal", "S05"),
            ("深蓝", "S07"): ("Deepal", "S07"),
            ("东风", "纳米01"): ("Dongfeng", "Nammi 01"),
            ("东风", "锐骐6 EV"): ("Dongfeng", "Rich 6 EV"),
            ("吉利", "银河 E5"): ("Geely", "Galaxy E5"),
            ("吉利", "银河 M9"): ("Geely", "Galaxy M9"),
            ("吉利", "几何"): ("Geely", "Geome"),
            ("吉利", "几何C"): ("Geely", "Geometry C"),
            ("零跑", "T03"): ("Leapmotor", "T03"),
            ("零跑", "小马"): ("Leapmotor", "T03"),
            ("零跑", "小马奔腾"): ("Leapmotor", "T03"),
            ("Smart", "Smart"): ("Smart", "Smart #1"),
            ("山东小车", "卡王"): ("Shandong EV", "KW"),
            ("山东小车", "卡王KW"): ("Shandong EV", "KW"),
            ("山东小车", "KW"): ("Shandong EV", "KW"),
            ("山东小车", "小钢炮"): ("Shandong EV", "XGP"),
            ("山东小车", "小钢炮XGP"): ("Shandong EV", "XGP"),
            ("山东小车", "XGP"): ("Shandong EV", "XGP"),
            ("智己", "L6"): ("IM Motors", "L6"),
            ("智己", "LS6"): ("IM Motors", "LS6"),
            ("上汽", "智己"): ("IM Motors", "LS6"),
            ("捷途", "DASHING"): ("Jetour", "Dashing"),
            ("捷途", "G700"): ("Jetour", "T2"),
            ("捷途", "T1"): ("Jetour", "T2"),
            ("捷途", "T2"): ("Jetour", "T2"),
            ("捷途", "X50"): ("Jetour", "Dashing"),
            ("捷途", "X70FL"): ("Jetour", "Dashing"),
            ("捷途", "X70PLUS"): ("Jetour", "Dashing"),
            ("捷途", "价格表"): ("Jetour", "Dashing"),
            ("丰田", "铂智3X"): ("Toyota", "bZ3X"),
            ("丰田", "铂智3x"): ("Toyota", "bZ3X"),
            ("奔腾小马", "小马"): ("Bestune", "Xiaoma"),
            ("奔腾", "小马"): ("Bestune", "Xiaoma"),
            ("吉利", "A7"): ("Geely", "Galaxy A7"),
            ("吉利", "牛仔"): ("Geely", "Geome"),
            ("吉利牛仔", "观野版"): ("Geely", "Geome"),
            ("吉利牛仔", "趣野版"): ("Geely", "Geome"),
            ("星耀6", "125KM"): ("Geely", "Galaxy L6"),
            ("福瑞通", "V6E"): ("Dongfeng", "Rich 6 EV"),
            ("福瑞通", "V8E"): ("Dongfeng", "Rich 6 EV"),
            ("福田", "奥铃"): ("Farizon", "Xingxiang V"),
            ("广汽", "i60"): ("GAC Aion", "i60"),
            ("阿维塔", "阿维塔"): ("Avatr", "12"),
            ("阿维塔", "06"): ("Avatr", "07"),
            ("阿维塔", "12"): ("Avatr", "12"),
            ("长安", "阿维塔"): ("Avatr", "12"),
            ("小米", "小米价格表"): ("Xiaomi", "SU7 Ultra"),
            ("小米", "小米su7"): ("Xiaomi", "SU7"),
            ("名爵", "MG4 EV"): ("MG", "MG4 EV"),
            ("雷达", "RD6"): ("Radar", "RD6"),
            ("享界", "S9"): ("Stelato", "S9"),
            ("坦克", "500"): ("Tank", "500 Hi4-T"),
            ("岚图", "泰山 X8"): ("Voyah", "Taishan X8"),
            ("五菱", "缤果 Plus"): ("Wuling", "Bingo Plus"),
            ("小鹏", "G9"): ("XPENG", "G9"),
            ("小米", "SU7 Ultra"): ("Xiaomi", "SU7 Ultra"),
            ("小米", "YU7"): ("Xiaomi", "YU7"),
            ("极氪", "001"): ("Zeekr", "001"),
            ("极氪", "9X"): ("Zeekr", "9X"),
        }
    return mapping


BRAND_MODEL_MAP = load_brand_model_map()


ALLOWED_EDIT_KEYS = [
    "model_id", "brand", "model", "trim_config", "exterior_color", "interior_color",
    "manufacture_year", "manufacture_month", "stock_quantity", "min_quantity", "max_quantity", "lead_time",
    "order_wait_days", "steering_setup", "version_type",
    "status_vehicle", "supplier_price_cny", "cost_exw_usd", "cost_fob_usd",
    "cost_fca_usd", "location", "supplier", "notes", "status",
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


def parse_manufacture_year_month(row: dict[str, Any]) -> tuple[int | None, int | None]:
    y_raw = row.get("manufactureYear") or row.get("manufacture_year") or row.get("year")
    m_raw = row.get("manufactureMonth") or row.get("manufacture_month") or row.get("month")

    year = to_number(y_raw)
    month = to_number(m_raw)

    if year is not None and (year < 1900 or year > 2100):
        year = None
    if month is not None and (month < 1 or month > 12):
        month = None

    if year is not None and month is not None:
        return year, month

    for date_key in ("manufactureDate", "manufacture_date", "productionDate", "production_date", "time"):
        val = str(row.get(date_key) or "").strip()
        if not val:
            continue
        ymd = re.search(r"(20\d{2})[年./-](\d{1,2})", val)
        if ymd:
            if year is None:
                year = int(ymd.group(1))
            if month is None:
                month = int(ymd.group(2))
            break
        y_match = re.search(r"(20\d{2})", val)
        if y_match and year is None:
            year = int(y_match.group(1))

    return year, month


def to_number(value: Any) -> int | None:
    if value in (None, ""):
        return None
    cleaned = re.sub(r"[^0-9.]", "", str(value))
    if not cleaned:
        return None
    try:
        number = float(cleaned)
    except ValueError:
        return None
    return int(round(number))


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


from mineru_pipeline.schema import (
    VEHICLE_FIELDS,
    get_allowed_edit_keys,
    get_create_table_sql,
    get_feishu_field_map,
)


def get_db(db_path: Path | None = None) -> sqlite3.Connection:
    target = db_path or (OUTPUT_DIR / "local_source.db")
    target.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(target)
    db.row_factory = sqlite3.Row
    db.execute(get_create_table_sql())
    db.execute("""
        CREATE TABLE IF NOT EXISTS processed_files (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          filename TEXT,
          content_hash TEXT UNIQUE,
          processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    db.commit()

    existing_cols = {row["name"] for row in db.execute("PRAGMA table_info(source_candidates)").fetchall()}
    if "manufacture_year" not in existing_cols:
        db.execute("ALTER TABLE source_candidates ADD COLUMN manufacture_year INTEGER")
        db.commit()
    if "manufacture_month" not in existing_cols:
        db.execute("ALTER TABLE source_candidates ADD COLUMN manufacture_month INTEGER")
        db.commit()
    if "parse_raw" not in existing_cols:
        db.execute("ALTER TABLE source_candidates ADD COLUMN parse_raw TEXT")
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


NOISE_WORDS_RE = re.compile(
    r"(FOB价格表|EXW价格表|FCA价格表|库存价格表|价格表|报价表|价格|报价|FOB|EXW|FCA|\.png|\.jpg|\.pdf|\.txt|\.xlsx|\.csv)",
    re.IGNORECASE,
)


def clean_noise_words(text: str) -> str:
    cleaned = NOISE_WORDS_RE.sub("", text).strip(" _-.")
    return cleaned


FOOTER_NOISE_PATTERNS = [
    r"^\d+[\.、\s]",  # Starts with digit dot e.g. "1. ", "2. ", "3. "
    r"汇率", r"境外人民币", r"基于.*港", r"滚装船", r"运费", r"单独计算", r"套色", r"额外增加",
    r"含税", r"不含税", r"含国内运费", r"二类底盘", r"售价", r"定金", r"订金",
    r"交付", r"款项", r"尾款", r"有效", r"截止", r"说明", r"提示"
]


def is_invalid_model_name(model_text: str) -> bool:
    if not model_text:
        return True
    m = str(model_text).strip()
    if len(m) > 40:
        return True
    for pat in FOOTER_NOISE_PATTERNS:
        if re.search(pat, m, re.IGNORECASE):
            return True
    return False


def normalize_brand_model(brand: Any, model: Any) -> tuple[str | None, str | None]:
    brand_text = clean_noise_words(str(brand or "").strip())
    model_text = clean_noise_words(str(model or "").strip())

    if is_invalid_model_name(model_text):
        model_text = ""

    if not brand_text and not model_text:
        return None, None

    # Handle A7 and Cowboy/Geome special strings
    if "a7" in brand_text.lower() or "a7" in model_text.lower():
        return "Geely", "Galaxy A7"
    if "牛仔" in brand_text or "牛仔" in model_text:
        return "Geely", "Geome"
    if "sv" in brand_text.lower() or "sv" in model_text.lower() or "新v" in brand_text.lower() or "新v" in model_text.lower():
        return "Farizon", "Xingxiang V"
    if "卡王" in brand_text or "卡王" in model_text:
        return "Shandong EV", "KW"
    if "小钢炮" in brand_text or "小钢炮" in model_text:
        return "Shandong EV", "XGP"

    for (raw_brand, raw_model), mapped in BRAND_MODEL_MAP.items():
        if raw_brand and raw_model:
            if raw_brand.lower() in brand_text.lower() and (raw_model.lower() in model_text.lower() or raw_model.lower() in brand_text.lower()):
                return mapped

    if "启源" in brand_text or "启源" in model_text or "nevo" in brand_text.lower():
        brand_text = "Changan Nevo"
        m_upper = model_text.upper()
        if "A07" in m_upper or "SC7000" in m_upper:
            model_text = "A07"
        elif "A05" in m_upper or "SC7150" in m_upper:
            model_text = "A05"
        elif "E07" in m_upper or "SC6485" in m_upper:
            model_text = "E07"
        else:
            model_text = "Q05"
        return brand_text, model_text

    if "深蓝" in brand_text or "深蓝" in model_text or "deepal" in brand_text.lower():
        brand_text = "Deepal"
        m_upper = model_text.upper()
        if "S05" in m_upper:
            model_text = "S05"
        else:
            model_text = "S07"
        return brand_text, model_text

    if any(noise in model_text for noise in ("五菱批发端", "五菱电动车", "微卡mini", "微面mini", "广州现车", "现车可指定发运", "车型", "加价", "来源")):
        model_text = ""

    if "阿维塔" in brand_text or "阿维塔" in model_text or "avatr" in brand_text.lower():
        brand_text = "Changan"
        if "06" in model_text or "6" in model_text:
            model_text = "Avatr 06"
        elif "12" in model_text:
            model_text = "Avatr 12"
        elif "11" in model_text:
            model_text = "Avatr 11"
        elif "07" in model_text or "7" in model_text:
            model_text = "Avatr 07"
        else:
            model_text = "Avatr 12"
        return brand_text, model_text

    if "惠迪" in brand_text or "惠迪" in str(brand):
        brand_text = "BYD"
    elif any(k in brand_text.lower() for k in ("福田", "foton")):
        brand_text = "Foton"
    elif any(k in brand_text.lower() for k in ("比亚迪", "byd")):
        brand_text = "BYD"
    elif any(k in brand_text.lower() for k in ("吉利", "geely")):
        brand_text = "Geely"
        if "牛仔" in brand_text or "牛仔" in model_text:
            model_text = "Geome"
        elif "a7" in brand_text.lower() or "a7" in model_text.lower():
            model_text = "Galaxy A7"
    elif any(k in brand_text.lower() for k in ("远程", "farizon")):
        brand_text = "Farizon"
    elif any(k in brand_text.lower() for k in ("五菱", "wuling", "sgmw")):
        brand_text = "Wuling"
        m_lower = model_text.lower()
        if "缤果" in m_lower or "bingo" in m_lower:
            model_text = "Bingo Plus" if "plus" in m_lower else "Bingo"
        elif "星光" in m_lower or "starlight" in m_lower:
            model_text = "Starlight"
        elif "宏光" in m_lower or "hongguang" in m_lower:
            model_text = "Hongguang MINIEV" if "mini" in m_lower else "Hongguang"
        elif "之光" in m_lower or "sunshine" in m_lower:
            model_text = "Sunshine"
        elif "扬光" in m_lower or "yangguang" in m_lower:
            model_text = "Yangguang"
        else:
            model_text = "Rongguang"
    elif any(k in brand_text.lower() for k in ("长安", "changan")):
        brand_text = "Changan"
    elif any(k in brand_text.lower() for k in ("东风", "dongfeng")):
        brand_text = "Dongfeng"
    elif any(k in brand_text.lower() for k in ("捷途", "jetour")):
        brand_text = "Jetour"
        if "dashing" in model_text.lower() or "x50" in model_text.lower() or "x70" in model_text.lower():
            model_text = "Dashing"
        elif "t1" in model_text.lower() or "t2" in model_text.lower() or "g700" in model_text.lower():
            model_text = "T2"
    elif any(k in brand_text.lower() for k in ("丰田", "toyota")):
        brand_text = "Toyota"
        if "铂智" in model_text:
            model_text = "bZ3X"
    elif any(k in brand_text.lower() for k in ("智己", "im motors")) or (brand_text == "上汽" and "智己" in model_text):
        brand_text = "IM Motors"
        if "l6" in model_text.lower():
            model_text = "L6"
        elif "ls6" in model_text.lower():
            model_text = "LS6"
    elif any(k in brand_text.lower() for k in ("小米", "xiaomi")):
        brand_text = "Xiaomi"
        if "su7" in model_text.lower():
            model_text = "SU7"
    elif "奔腾" in brand_text or "奔腾" in model_text:
        brand_text = "Bestune"
        model_text = "Xiaoma"
    elif any(k in brand_text.lower() for k in ("广汽", "gac", "i60")):
        brand_text = "GAC Aion"
        if "i60" in model_text.lower() or brand_text == "i60":
            model_text = "i60"
    elif "星耀6" in brand_text or "星耀6" in model_text:
        brand_text = "Geely"
        model_text = "Galaxy L6"
    elif "福瑞通" in brand_text:
        brand_text = "Dongfeng"
        model_text = "Rich 6 EV"
    elif brand_text in ("2026款", "2025款", "2024款"):
        brand_text = "Geely"

    if model_text == "海鸥":
        model_text = "Seagull"
    elif model_text == "海豚":
        model_text = "Dolphin"

    return brand_text or None, model_text or None


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


def normalize_location_cn(val: Any) -> str | None:
    if not val:
        return None
    raw = str(val).strip()
    cleaned = re.sub(r"^(FCA|FOB|EXW|CIF)\s*", "", raw, flags=re.IGNORECASE).strip()
    return cleaned if cleaned else None


def extract_trade_term_prices_and_location(row: dict[str, Any]) -> dict[str, Any]:
    exw = to_number(row.get("costExwUsd") or row.get("cost_exw_usd") or row.get("priceExw"))
    fob = to_number(row.get("costFobUsd") or row.get("cost_fob_usd") or row.get("priceFob"))
    fca = to_number(row.get("costFcaUsd") or row.get("cost_fca_usd") or row.get("priceFca"))
    cny = to_number(row.get("supplierPriceCny") or row.get("supplier_price_cny") or row.get("officialPrice") or row.get("officialPriceCny") or row.get("official_suggested_price_cny") or row.get("officialSuggestedPrice"))
    loc = normalize_location_cn(row.get("location"))

    text_parts = [
        str(row.get("trimName") or row.get("trim_config") or ""),
        str(row.get("ocr_raw") or row.get("raw") or ""),
        str(row.get("_rawText") or row.get("parse_raw") or ""),
        str(row.get("_source_file") or ""),
        str(row.get("notes") or "")
    ]
    combo_text = " ".join(text_parts)

    # Special User Instruction: For 浙江创睿, the last column is '不含税FOB RMB', convert to USD at 6.7 rate!
    is_zhejiang_chuangrui = "浙江创睿" in str(row.get("supplierName") or row.get("supplier") or row.get("_source_file") or "")
    if is_zhejiang_chuangrui and fob is not None and fob >= 20000:
        fob = round(fob / 6.7)

    # Convert RMB EXW/FOB/FCA costs to USD (ratio ~ 7-8x: 1 USD ≈ 6.7 CNY)
    if cny is not None and cny <= 15000 and cny in (exw, fob, fca):
        cny = None

    if exw is not None:
        if (cny is not None and exw / cny > 0.35) or (cny is None and exw >= 25000) or exw >= 50000:
            exw = round(exw / 6.7)
    if fob is not None:
        if (cny is not None and fob / cny > 0.35) or (cny is None and fob >= 25000) or fob >= 50000:
            fob = round(fob / 6.7)
    if fca is not None:
        if (cny is not None and fca / cny > 0.35) or (cny is None and fca >= 25000) or fca >= 50000:
            fca = round(fca / 6.7)

    if not exw:
        m = re.search(r"EXW[^0-9]{0,12}([0-9]{4,7})", combo_text, re.IGNORECASE)
        if m:
            val = int(m.group(1))
            if 500 <= val < 2000000:
                if (cny is not None and val / cny > 0.35) or val >= 25000:
                    exw = round(val / 6.7)
                else:
                    exw = val

    if not fob:
        m = re.search(r"FOB[^0-9]{0,12}([0-9]{4,7})", combo_text, re.IGNORECASE)
        if m:
            val = int(m.group(1))
            if 500 <= val < 2000000:
                if (cny is not None and val / cny > 0.35) or val >= 25000:
                    fob = round(val / 6.7)
                else:
                    fob = val

    if not fca:
        m = re.search(r"FCA[^0-9]{0,12}([0-9]{4,7})", combo_text, re.IGNORECASE)
        if m:
            val = int(m.group(1))
            if 500 <= val < 2000000:
                if (cny is not None and val / cny > 0.35) or val >= 25000:
                    fca = round(val / 6.7)
                else:
                    fca = val

    # Hard Bounds: Foreign trade USD prices must be between $1,000 USD and $200,000 USD
    # Any USD price < 1,000 USD (e.g. 3, 205, 301) or >= 200,000 USD is invalid noise and set to None
    if exw is not None and (exw < 1000 or exw >= 200000):
        exw = None
    if fob is not None and (fob < 1000 or fob >= 200000):
        fob = None
    if fca is not None and (fca < 1000 or fca >= 200000):
        fca = None

    if not cny:
        m = re.search(r"(?:指导价|建议价|MSRP|对标价|国内售价|指导)[^0-9]{0,12}([0-9]{5,7})", combo_text, re.IGNORECASE)
        if m:
            val = int(m.group(1))
            if 20000 <= val <= 2000000:
                cny = val

    if not loc:
        for loc_kw in ("南沙", "武汉", "深圳", "天津", "上海", "霍尔果斯基地", "霍尔果斯", "广州", "宁波", "青岛", "湘潭", "盐城", "喀什", "二连浩特", "成都", "乌鲁木齐"):
            if loc_kw in combo_text:
                loc = loc_kw
                break

    return {
        "cost_exw_usd": exw,
        "cost_fob_usd": fob,
        "cost_fca_usd": fca,
        "supplier_price_cny": cny,
        "location": loc,
    }


def clean_color(color_val: Any) -> tuple[str | None, str | None, int | None]:
    if not color_val:
        return None, None, None
    c_str = str(color_val).strip()
    if not c_str or c_str in ("/", "-", "外观", "颜色", "无", "外观颜色"):
        return None, None, None

    stock_qty = None
    m_qty = re.match(r"^(\d+)\s*([\u4e00-\u9fa5A-Za-z/]+)$", c_str)
    if m_qty:
        stock_qty = int(m_qty.group(1))
        c_str = m_qty.group(2).strip()

    ext_col = c_str
    int_col = None

    if "/" in c_str and not any(kw in c_str for kw in ["+", "；", ";", "、"]):
        parts = c_str.split("/")
        if len(parts) == 2:
            ext_col, int_col = parts[0].strip(), parts[1].strip()

    ext_col = re.sub(r"[（\(][^）\)]*[）\)]", "", ext_col).strip()
    ext_col = re.sub(r"套色", "", ext_col).strip()

    return ext_col or None, int_col or None, stock_qty


def clean_trim_config(trim_val: Any, brand: str, model: str, raw_brand: Any = None, raw_model: Any = None) -> str | None:
    if trim_val is None:
        return None
    trim_str = str(trim_val).strip()
    if not trim_str:
        return None

    # 0. Strip parenthetical equipment detail lists and trailing English descriptions
    m_lv = re.match(r"^(LV\d(?:\s*[\u4e00-\u9fa5]+)?).*$", trim_str, re.IGNORECASE)
    if m_lv:
        trim_str = m_lv.group(1).strip()
    else:
        trim_str = re.sub(r"[（\(][^）\)]*[）\)]", "", trim_str).strip()
        trim_str = re.sub(r"\s+[A-Za-z\s/,\-–\(\)]+$", "", trim_str).strip()

    # 1. Filter out technical parameter / dimension / chassis noise
    trim_str = re.sub(r"\d{3,5}\s*[*xX×]\s*\d{3,5}\s*[*xX×]\s*\d{3,5}", "", trim_str)
    trim_str = re.sub(r"(?:长宽高|尺寸|外形尺寸|车身尺寸|整车尺寸|轮距|轴距|长\*宽\*高)[：:\s]*[0-9*xX×]*", "", trim_str)

    spec_noise_patterns = [
        r"四轮碟刹", r"前盘后鼓", r"双碟刹", r"碟刹", r"鼓刹", r"液压刹车", r"真空胎", r"钢圈", r"铝轮",
        r"三元锂", r"磷酸铁锂", r"铅酸", r"控制器", r"永磁同步", r"交流电机", r"电机功率", r"电机",
        r"自重", r"载重", r"整备质量", r"总质量", r"极速", r"最高车速", r"续航里程"
    ]
    for noise in spec_noise_patterns:
        trim_str = re.sub(noise, "", trim_str)

    trim_str = trim_str.strip(" -_/+,;:*")

    # 2. Check for summary / header / invalid words
    invalid_keywords = ["合计", "小计", "指导价", "不含税", "售价", "价格", "汇总", "参数", "单位", "数量", "小结", "总计", "配置表", "参数表", "型号", "规格"]
    if any(trim_str == kw or trim_str.startswith(kw) for kw in invalid_keywords):
        return None

    # 3. Strip redundant brand / model / raw names
    to_strip = [brand, model, str(raw_brand or ""), str(raw_model or "")]
    for b_cand, m_cand in [("极氪", "001"), ("比亚迪", "BYD"), ("东风", "eπ007"), ("东风", "eπ008"), ("东风", "纳米01"), ("阿维塔", "12"), ("吉利", "银河"), ("山东小车", "卡王"), ("山东小车", "小钢炮")]:
        to_strip.extend([b_cand, m_cand])

    for target in to_strip:
        if target and len(target) >= 2:
            if trim_str.lower() == target.lower() or trim_str.lower() == f"{target.lower()}新款" or trim_str == f"{target}+":
                return None
            pattern = re.compile(rf"^{re.escape(target)}\s*[\+\-款]?\s*", re.IGNORECASE)
            trim_str = pattern.sub("", trim_str).strip()

    if not trim_str or trim_str in ("新款", "老款", "标准版", "默认", "+", "型", "款"):
        return None

    return trim_str


def format_candidates_for_feishu(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    model_index = load_model_index()
    formatted: list[dict[str, Any]] = []
    for row in rows:
        brand_raw = row.get("brand")
        model_raw = row.get("modelName") or row.get("model")
        brand, model = normalize_brand_model(brand_raw, model_raw)
        
        # Check if row represents an unstructured OCR image/text document
        is_unstructured_doc = bool(row.get("ocr_raw") or row.get("raw") or row.get("_source_file") or row.get("_rawText"))
        if not brand or not model or brand in ("未知", "unknown") or model in ("待确认车型", "未知", "unknown"):
            fallback_text = f"{row.get('trimName') or ''} {row.get('trim_config') or ''} {row.get('ocr_raw') or ''} {row.get('raw') or ''} {row.get('_source_file') or ''}"
            if not brand or brand in ("未知", "unknown"):
                for b_cand in ["BYD", "Foton", "Geely", "Wuling", "Changan", "Farizon", "Dongfeng", "XPENG", "Zeekr", "Xiaomi", "AITO", "Deepal", "GAC Aion", "MG", "Radar", "Stelato", "Tank", "Voyah", "Hongqi", "Leapmotor", "GWM"]:
                    if b_cand.lower() in fallback_text.lower() or (b_cand == "BYD" and "比亚迪" in fallback_text):
                        brand = b_cand
                        break
            if not model or model in ("待确认车型", "未知", "unknown"):
                for (rb, rm), mapped in BRAND_MODEL_MAP.items():
                    if rm and rm.lower() in fallback_text.lower():
                        brand = mapped[0]
                        model = mapped[1]
                        break
            if not brand or not model:
                if "sv" in fallback_text.lower() or "新v" in fallback_text.lower():
                    brand, model = "Farizon", "Xingxiang V"
                elif "卡王" in fallback_text:
                    brand, model = "Shandong EV", "KW"
                elif "小钢炮" in fallback_text:
                    brand, model = "Shandong EV", "XGP"

        if not brand or not model or brand in ("未知", "unknown") or model in ("待确认车型", "未知", "unknown"):
            continue

        if any(noise in str(model) for noise in ("注：", "来源", "合计", "加价", "车型代码")) or any(noise in str(brand) for noise in ("注：", "来源")):
            continue

        final_brand = brand
        final_model = model

        wait_days = to_number(row.get("orderWaitDays") or row.get("order_wait_days")) or parse_wait_days(row.get("leadTimeText") or row.get("orderWaitingPeriod"))
        steering_raw = f"{row.get('steeringSetup') or ''} {row.get('ocr_raw') or row.get('raw') or ''} {row.get('notes') or ''} {row.get('trimName') or ''}".upper()
        steering = "右舵" if ("右舵" in steering_raw or "RHD" in steering_raw) else "左舵"
        version_raw = f"{row.get('marketRegion') or ''} {row.get('ocr_raw') or row.get('raw') or ''} {row.get('notes') or ''} {row.get('trimName') or ''}"
        version_type = None
        if "国内" in version_raw or "中规" in version_raw or "DOMESTIC" in version_raw.upper():
            version_type = "国内版"
        elif any(token in version_raw for token in ("国际", "出口", "海外", "欧标", "美规")) or "INTERNATIONAL" in version_raw.upper():
            version_type = "国际版"
        status_raw = str(row.get("statusVehicle") or row.get("status_vehicle") or "").lower()
        if "现车" in status_raw or "stock" in status_raw:
            status_v = "现车"
        elif "在途" in status_raw or "transit" in status_raw:
            status_v = "在途"
        else:
            status_v = "无具体信息" if status_raw else None

        model_id = row.get("model_id") or row.get("modelId") or model_index.get((final_brand.lower(), final_model.lower()))

        trim_val = row.get("trimName") or row.get("trimConfig") or row.get("trim_config")
        
        # Enhanced price & location extraction
        price_info = extract_trade_term_prices_and_location(row)
        official_price = price_info["supplier_price_cny"]
        exw_usd = price_info["cost_exw_usd"]
        fob_usd = price_info["cost_fob_usd"]
        fca_usd = price_info["cost_fca_usd"]
        final_loc = price_info["location"]

        # AGENTS.md Rule #9: If trim_val is purely numeric (e.g. 57800, 117800), redirect to price and clear trim
        if trim_val is not None:
            trim_str = str(trim_val).strip()
            cleaned_num = trim_str.replace(".", "").replace(",", "")
            if cleaned_num.isdigit() and len(cleaned_num) >= 3:
                if official_price is None:
                    try:
                        official_price = int(cleaned_num)
                    except ValueError:
                        pass
                trim_val = None

        trim_val = clean_trim_config(trim_val, final_brand, final_model, brand_raw, model_raw)

        conf_raw = row.get("confidence") or row.get("ocr_confidence") or row.get("_confidence")
        conf_val = round(float(conf_raw), 2) if conf_raw is not None else 1.0

        m_year, m_month = parse_manufacture_year_month(row)

        raw_ext_col = row.get("exteriorColor") or row.get("exterior_color") or row.get("color")
        raw_int_col = row.get("interiorColor") or row.get("interior_color")
        ext_col, parsed_int_col, extracted_qty = clean_color(raw_ext_col)
        int_col = raw_int_col or parsed_int_col

        stock_qty = to_number(row.get("stockQuantity") or row.get("stock_quantity") or row.get("quantity"))
        if stock_qty is None and extracted_qty is not None:
            stock_qty = extracted_qty

        item = {
            "model_id": model_id,
            "brand": final_brand,
            "model": final_model,
            "trim_config": trim_val,
            "manufacture_year": m_year,
            "manufacture_month": m_month,
            "exterior_color": ext_col,
            "interior_color": int_col,
            "stock_quantity": stock_qty,
            "min_quantity": to_number(row.get("minQuantity") or row.get("min_quantity")),
            "max_quantity": to_number(row.get("maxQuantity") or row.get("max_quantity")),
            "lead_time": row.get("leadTime") or row.get("lead_time"),
            "order_wait_days": wait_days,
            "steering_setup": steering,
            "version_type": version_type,
            "status_vehicle": status_v,
            "supplier_price_cny": official_price,
            "cost_exw_usd": exw_usd,
            "cost_fob_usd": fob_usd,
            "cost_fca_usd": fca_usd,
            "location": final_loc,
            "confidence": conf_val,
            "supplier": row.get("supplierName") or row.get("supplier"),
            "notes": None,
            "source_file": row.get("_source_file") or row.get("source_file"),
            "content_hash": row.get("_content_hash") or row.get("content_hash"),
        }

        # Multi-color combination splitting (AGENTS.md Rule 2.2)
        raw_ext = str(item["exterior_color"] or "")
        if "+" in raw_ext or ";" in raw_ext or "；" in raw_ext or "、" in raw_ext or re.search(r"\d+[\u4e00-\u9fa5]+", raw_ext) or (raw_ext.count("/") >= 2):
            parts = re.split(r"[\+；;、]", raw_ext) if not (raw_ext.count("/") >= 2 and "+" not in raw_ext) else raw_ext.split("/")
            for part in parts:
                part = part.strip()
                if not part:
                    continue
                new_item = dict(item)
                m_part = re.match(r"^(\d+)\s*([\u4e00-\u9fa5A-Za-z]+)(?:/([\u4e00-\u9fa5A-Za-z]+))?$", part)
                if m_part:
                    new_item["stock_quantity"] = int(m_part.group(1))
                    new_item["exterior_color"] = m_part.group(2)
                    if m_part.group(3):
                        new_item["interior_color"] = m_part.group(3)
                elif "/" in part:
                    c_parts = part.split("/")
                    new_item["exterior_color"] = c_parts[0].strip()
                    if len(c_parts) > 1:
                        new_item["interior_color"] = c_parts[1].strip()
                else:
                    new_item["exterior_color"] = part
                formatted.append(new_item)
        else:
            formatted.append(item)

    # Post-process: Collapse single-vehicle spec sheet duplicates (e.g. Shandong EV / 山东小车工厂: 2 models total)
    collapsed: list[dict[str, Any]] = []
    seen_sd_models: set[str] = set()

    for item in formatted:
        if item.get("brand") == "Shandong EV" or "山东小车" in str(item.get("supplier") or ""):
            model_key = item.get("model")
            if model_key in seen_sd_models:
                continue
            seen_sd_models.add(model_key)
            if not item.get("trim_config"):
                if model_key == "KW":
                    item["trim_config"] = "五门四座"
                elif model_key == "XGP":
                    item["trim_config"] = "两门两座"
        collapsed.append(item)

    # Post-process 2: Deduplicate exact identical records and collapse priceless redundant duplicate rows
    deduped: list[dict[str, Any]] = []
    seen_keys: set[tuple[Any, ...]] = set()
    priceless_keys: set[tuple[Any, ...]] = set()

    for item in collapsed:
        sup = item.get("supplier") or ""
        b = item.get("brand") or ""
        m = item.get("model") or ""
        t = item.get("trim_config") or ""
        ext = item.get("exterior_color") or ""
        inte = item.get("interior_color") or ""
        qty = item.get("stock_quantity")
        cny = item.get("supplier_price_cny")
        exw = item.get("cost_exw_usd")
        fob = item.get("cost_fob_usd")
        fca = item.get("cost_fca_usd")
        loc = item.get("location") or ""
        ver = item.get("version_type") or ""
        steer = item.get("steering_setup") or ""
        src = item.get("source_file") or ""

        # Exact key deduplication
        key = (sup, b, m, t, ext, inte, qty, cny, exw, fob, fca, loc, ver, steer, src)
        if key in seen_keys:
            continue
        seen_keys.add(key)

        # Collapse empty price-less duplicates (where all prices & colors are None)
        is_priceless = (cny is None and exw is None and fob is None and fca is None)
        if is_priceless and not ext:
            p_key = (sup, b, m, t, src)
            if p_key in priceless_keys:
                continue
            priceless_keys.add(p_key)

        deduped.append(item)

    return deduped


FEISHU_FIELD_MAP = get_feishu_field_map()


def record_to_feishu_fields(record: dict[str, Any]) -> dict[str, Any]:
    fields: dict[str, Any] = {}
    for db_col, feishu_col in FEISHU_FIELD_MAP.items():
        val = record.get(db_col)
        if val not in (None, ""):
            fields[feishu_col] = val

    if record.get("version_type"):
        fields["market_region"] = [record["version_type"]]
    return fields


def save_candidates_to_db(db: sqlite3.Connection, candidates: list[dict[str, Any]]) -> list[int]:
    base_columns = [f.db_column for f in VEHICLE_FIELDS]
    columns = base_columns + ["status", "source_file", "content_hash"]
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
    cmd = [sys.executable, str(PROJECT_ROOT / "scripts" / "ocr_process.py"), "--engine", "mineru"]
    if force:
        cmd.append("--force")
    env = os.environ.copy()
    if backend:
        env["MINERU_BACKEND"] = backend
    if effort:
        env["MINERU_EFFORT"] = effort
    if method:
        env["MINERU_METHOD"] = method
    result = subprocess.run(cmd, cwd=PROJECT_ROOT, env=env)
    return result.returncode == 0


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


def validate_ai_config() -> tuple[bool, str]:
    base_url = os.getenv("BASE_URL") or os.getenv("OPENROUTER_BASE_URL") or "https://ollama.com/v1"
    api_key = (
        os.getenv("API_KEY")
        or os.getenv("OPENROUTER_API_KEY")
        or os.getenv("GEMINI_API_KEY")
        or os.getenv("OLLAMA_API_KEY")
    )
    if "localhost" in base_url or "127.0.0.1" in base_url or api_key or base_url:
        return (True, "")
    return (False, "未配置 API_KEY 或 BASE_URL")


def _already_processed(db: sqlite3.Connection, content_hash: str) -> bool:
    return db.execute("SELECT 1 FROM processed_files WHERE content_hash = ?", (content_hash,)).fetchone() is not None


def _mark_processed(db: sqlite3.Connection, filename: str, content_hash: str, dry_run: bool) -> None:
    if dry_run:
        return
    db.execute("INSERT OR IGNORE INTO processed_files (filename, content_hash) VALUES (?, ?)", (filename, content_hash))
    db.commit()


def run_excel_parsing(db: sqlite3.Connection, dry_run: bool = False) -> list[dict[str, Any]]:
    parsed_dir = OUTPUT_DIR / "parsed"
    parsed_dir.mkdir(parents=True, exist_ok=True)
    results: list[dict[str, Any]] = []
    if not CLASSIFIED_DIR.exists():
        return results
    for file_path in sorted(CLASSIFIED_DIR.rglob("*")):
        if not file_path.is_file() or file_path.suffix.lower() not in {".xlsx", ".xls", ".csv"}:
            continue
        content_hash = compute_file_hash(file_path)
        if _already_processed(db, content_hash):
            print(f"Skipping already processed file: {file_path.name}")
            continue

        md_content = excel_to_markdown(file_path)
        try:
            rel_path = file_path.relative_to(CLASSIFIED_DIR)
        except Exception:
            rel_path = Path(file_path.name)

        md_out_path = parsed_dir / rel_path.with_suffix(".md")
        md_out_path.parent.mkdir(parents=True, exist_ok=True)
        md_out_path.write_text(md_content, encoding="utf-8")

        # Flat stem output directly in output/parsed/
        flat_stem = str(rel_path).replace("/", "__").replace("\\", "__")
        (parsed_dir / f"{flat_stem}.md").write_text(md_content, encoding="utf-8")

        rows = parse_excel_file(file_path)
        for row in rows:
            row["_content_hash"] = content_hash
            row["_source_file"] = file_path.name

        json_out_path = parsed_dir / rel_path.with_suffix(".json")
        json_out_path.parent.mkdir(parents=True, exist_ok=True)
        json_out_path.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")

        results.append({"source": str(file_path), "outputPath": str(md_out_path), "rowCount": len(rows), "rows": rows})
        _mark_processed(db, file_path.name, content_hash, dry_run)
    (parsed_dir / "manifest.json").write_text(json.dumps({
        "processedAt": datetime.now().isoformat(),
        "totalFiles": len(results),
        "totalRows": sum(r["rowCount"] for r in results),
        "files": [{k: r[k] for k in ("source", "outputPath", "rowCount")} for r in results],
    }, ensure_ascii=False, indent=2), "utf-8")
    return results


def run_extraction(ocr_success: bool, db: sqlite3.Connection, dry_run: bool, allow_vision_fallback: bool = False) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    ocr_files_to_process: list[tuple[Path, str]] = []

    if has_recognized_files():
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
            ocr_files_to_process.append((output_path, item.get("source_rel") or output_path.name))

    supported_doc_extensions = {".pdf", ".png", ".jpg", ".jpeg", ".webp", ".docx", ".pptx", ".txt", ".md"}
    if CLASSIFIED_DIR.exists():
        for file_path in sorted(CLASSIFIED_DIR.rglob("*")):
            if file_path.is_file() and file_path.suffix.lower() in supported_doc_extensions:
                content_hash = compute_file_hash(file_path)
                if not _already_processed(db, content_hash) and not any(fp == file_path for fp, _ in ocr_files_to_process):
                    ocr_files_to_process.append((file_path, file_path.name))

    if ocr_files_to_process:
        print(f"🚀 Running Async Producer-Consumer Pipeline on {len(ocr_files_to_process)} OCR/input files...")
        async_extracted = run_async_pipeline(ocr_files_to_process, concurrency=4)
        for cand in async_extracted:
            source_file = cand.get("_source_file") or cand.get("source_file", "")
            if source_file and Path(source_file).exists():
                cand["_content_hash"] = compute_file_hash(Path(source_file))
        candidates.extend(async_extracted)
        for out_path, rel_name in ocr_files_to_process:
            c_hash = compute_file_hash(out_path)
            _mark_processed(db, rel_name, c_hash, dry_run)
    elif allow_vision_fallback:
        vision_extensions = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".pdf"}
        if CLASSIFIED_DIR.exists():
            for file_path in sorted(CLASSIFIED_DIR.rglob("*")):
                if not file_path.is_file() or file_path.suffix.lower() not in vision_extensions:
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

    return candidates


def generate_empty_templates() -> tuple[Path, Path, Path]:
    out_dir = OUTPUT_DIR
    out_dir.mkdir(parents=True, exist_ok=True)

    cols = [f.db_column for f in VEHICLE_FIELDS]
    descs = [f"{f.description} ({f.sql_type})" for f in VEHICLE_FIELDS]

    # Excel template
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "车源数据导入模板"

    header_fill = PatternFill(start_color="1F4E78", end_color="1F4E78", fill_type="solid")
    desc_fill = PatternFill(start_color="D9E1F2", end_color="D9E1F2", fill_type="solid")
    header_font = Font(name="微软雅黑", size=11, bold=True, color="FFFFFF")
    desc_font = Font(name="微软雅黑", size=9, italic=True, color="333333")
    thin_border = Border(
        left=Side(style='thin', color='D9D9D9'),
        right=Side(style='thin', color='D9D9D9'),
        top=Side(style='thin', color='D9D9D9'),
        bottom=Side(style='thin', color='D9D9D9')
    )

    ws.append(cols)
    ws.append(descs)

    for col_num in range(1, len(cols) + 1):
        cell1 = ws.cell(row=1, column=col_num)
        cell1.fill = header_fill
        cell1.font = header_font
        cell1.alignment = Alignment(horizontal="center", vertical="center")
        cell1.border = thin_border

        cell2 = ws.cell(row=2, column=col_num)
        cell2.fill = desc_fill
        cell2.font = desc_font
        cell2.alignment = Alignment(horizontal="center", vertical="center")
        cell2.border = thin_border

    for col in ws.columns:
        max_len = max(len(str(cell.value or '')) for cell in col)
        col_letter = openpyxl.utils.get_column_letter(col[0].column)
        ws.column_dimensions[col_letter].width = max(max_len * 1.5 + 4, 14)

    xlsx_path = out_dir / "vehicle_source_template_empty.xlsx"
    wb.save(xlsx_path)

    # CSV template
    csv_path = out_dir / "vehicle_source_template_empty.csv"
    with csv_path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(cols)
        writer.writerow(descs)

    # JSON template
    json_path = out_dir / "vehicle_source_template_empty.json"
    template_obj = {f.db_column: None for f in VEHICLE_FIELDS}
    json_path.write_text(json.dumps([template_obj], ensure_ascii=False, indent=2), encoding="utf-8")

    return xlsx_path, csv_path, json_path


def save_final_output(candidates: list[dict[str, Any]], backend: str | None = None) -> tuple[Path, Path]:
    final_dir = OUTPUT_DIR / "final"
    final_dir.mkdir(parents=True, exist_ok=True)
    date = datetime.now().date().isoformat()
    backend_tag = (backend or os.getenv("MINERU_BACKEND") or "hybrid").lower()
    json_path = final_dir / f"candidates_{date}_backend-{backend_tag}.json"
    csv_path = final_dir / f"candidates_{date}_backend-{backend_tag}.csv"
    json_path.write_text(json.dumps(candidates, ensure_ascii=False, indent=2), "utf-8")

    legacy_json_path = final_dir / f"candidates_{date}.json"
    legacy_json_path.write_text(json.dumps(candidates, ensure_ascii=False, indent=2), "utf-8")

    fields = [f.db_column for f in VEHICLE_FIELDS]
    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(candidates)

    legacy_csv_path = final_dir / f"candidates_{date}.csv"
    with legacy_csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(candidates)

    # Ensure empty template files are generated/updated in output/
    generate_empty_templates()

    return json_path, csv_path


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


def sync_to_feishu(candidates: list[dict[str, Any]], dry_run: bool = False) -> bool:
    if dry_run:
        print("Dry run - skipping Feishu upload")
        return True
    app_id = os.getenv("FEISHU_APP_ID") or os.getenv("LARK_APP_ID")
    app_secret = os.getenv("FEISHU_APP_SECRET") or os.getenv("LARK_APP_SECRET")
    app_token = os.getenv("FEISHU_BITABLE_APP_TOKEN")
    table_id = os.getenv("FEISHU_BITABLE_TABLE_ID") or os.getenv("FEISHU_TABLE_VEHICLES")
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
    uploaded = 0
    url = f"https://open.feishu.cn/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/records/batch_create"
    for index in range(0, len(candidates), 100):
        batch = candidates[index:index + 100]
        data = fetch_with_retry(
            "POST",
            url,
            headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
            json={"records": [{"fields": record_to_feishu_fields(record)} for record in batch]},
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
            stats = classify_inputs(INPUT_DIR)
            print(f"Classified {stats.classified} files; deleted {stats.deleted} junk files.")
        ocr_success = True if args.skip_ocr else run_ocr(
            force=args.force_ocr,
            backend=getattr(args, "backend", None),
            effort=getattr(args, "effort", None),
            method=getattr(args, "method", None),
        )
        excel_results = run_excel_parsing(db, args.dry_run)
        ok, message = validate_ai_config()
        ai_candidates = [] if not ok else run_extraction(ocr_success, db, args.dry_run, args.vision_fallback)
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
            print(f"Staged {len(ids)} candidates into local SQLite (status: pending).")
            print("💡 Run 'python -m mineru_pipeline list' to inspect or edit candidates.")
            print("💡 Run 'python -m mineru_pipeline sync' to manually sync to Feishu.")
        print(f"Pipeline stage 1-2 complete: {len(formatted)} candidates staged.")
        print(f"JSON: {json_path}")
        print(f"CSV: {csv_path}")
        return 0
    finally:
        db.close()


def list_pending(db: sqlite3.Connection) -> list[sqlite3.Row]:
    return db.execute("SELECT id, supplier, brand, model, trim_config, manufacture_year, manufacture_month, stock_quantity, cost_exw_usd, notes, status FROM source_candidates WHERE status = 'pending'").fetchall()


def action_list() -> int:
    init_environment()
    db = get_db()
    try:
        rows = list_pending(db)
        if not rows:
            print("No pending candidate records found in local_source.db.")
            return 0
        for row in rows:
            r_dict = dict(row)
            # Prioritize 'id' and 'supplier' at the very front for maximum visual clarity
            priority = ["id", "supplier", "brand", "model", "trim_config", "stock_quantity", "cost_exw_usd", "notes", "status"]
            ordered = {k: r_dict[k] for k in priority if k in r_dict}
            for k, v in r_dict.items():
                if k not in ordered:
                    ordered[k] = v
            print(ordered)
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
