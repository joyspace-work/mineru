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

from .parser import parse_excel_file
from .schema import (
    VEHICLE_FIELDS,
    get_allowed_edit_keys,
    get_brand_model_mapping,
    get_create_table_sql,
    get_feishu_field_map,
    get_rule_engine,
)


PROJECT_ROOT = Path(__file__).resolve().parents[2]
INPUT_DIR = PROJECT_ROOT / "input"
OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", PROJECT_ROOT / "output"))


def load_brand_model_map() -> dict[tuple[str, str], tuple[str, str]]:
    return get_brand_model_mapping()


BRAND_MODEL_MAP = load_brand_model_map()


ALLOWED_EDIT_KEYS = sorted(list(get_allowed_edit_keys()) + ["status"])


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
    if "variant" not in existing_cols:
        db.execute("ALTER TABLE source_candidates ADD COLUMN variant TEXT")
        db.commit()
    if "variant_id" not in existing_cols:
        db.execute("ALTER TABLE source_candidates ADD COLUMN variant_id TEXT")
        db.commit()
    return db


def fetch_feishu_table_records_readonly(table_id: str) -> list[dict[str, Any]]:
    app_id = os.getenv("FEISHU_APP_ID", "cli_aab1f0eeb0fa9cc0")
    app_secret = os.getenv("FEISHU_APP_SECRET")
    base_token = os.getenv("FEISHU_BASE_TOKEN", "Is6Xb3btbazhFhsDXgFcqFG1nRc")
    if not app_secret:
        return []
    try:
        token_resp = requests.post(
            "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
            json={"app_id": app_id, "app_secret": app_secret},
            timeout=5,
        ).json()
        token = token_resp.get("tenant_access_token")
        if not token:
            return []
        records = []
        page_token = None
        while True:
            url = f"https://open.feishu.cn/open-apis/bitable/v1/apps/{base_token}/tables/{table_id}/records?page_size=500"
            if page_token:
                url += f"&page_token={page_token}"
            res = requests.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=15).json()
            data = res.get("data", {})
            items = data.get("items", [])
            records.extend([it.get("fields", {}) for it in items])
            page_token = data.get("page_token")
            if not data.get("has_more"):
                break
        return records
    except Exception as err:
        print(f"Warning: Failed to fetch Feishu table {table_id} read-only: {err}")
        return []


def load_model_index() -> dict[tuple[str, str], str]:
    live_records = fetch_feishu_table_records_readonly("tblxVNjP9dnJ7b3o")
    if not live_records:
        path = PROJECT_ROOT / "feishu_tables" / "vehicle_models.json"
        try:
            data = json.loads(path.read_text("utf-8"))
            live_records = data.get("records", [])
        except Exception:
            live_records = []
    index: dict[tuple[str, str], str] = {}
    for record in live_records:
        brand = str(record.get("brand") or "").lower().strip()
        model = str(record.get("model") or "").lower().strip()
        model_id = str(record.get("model_id") or "").strip()
        if model and model_id:
            if brand:
                index[(brand, model)] = model_id
            index[("", model)] = model_id
    return index


def load_variant_index() -> dict[tuple[str, str], str]:
    live_records = fetch_feishu_table_records_readonly("tbl8YzkZkMxvHRoT")
    if not live_records:
        path = PROJECT_ROOT / "feishu_tables" / "vehicle_variants.json"
        try:
            data = json.loads(path.read_text("utf-8"))
            live_records = data.get("records", [])
        except Exception:
            live_records = []
    index: dict[tuple[str, str], str] = {}
    for record in live_records:
        model_id = str(record.get("model_id") or "").strip()
        variant = str(record.get("variant") or record.get("trim_config") or "").lower().strip()
        variant_id = str(record.get("trim_config_id") or record.get("variant_id") or record.get("record_id") or "").strip()
        if model_id and variant and variant_id:
            index[(model_id, variant)] = variant_id
    return index


_max_model_id_num = 64
_dynamic_model_map: dict[tuple[str, str], str] = {}
_dynamic_variant_map: dict[tuple[str, str], str] = {}


def get_or_create_model_id(brand: str | None, model: str | None, model_index: dict[tuple[str, str], str]) -> str | None:
    global _max_model_id_num
    if not model or not str(model).strip():
        return None
    b_clean = str(brand or "").strip().lower()
    m_clean = str(model).strip().lower()

    if (b_clean, m_clean) in model_index:
        return model_index[(b_clean, m_clean)]
    if ("", m_clean) in model_index:
        return model_index[("", m_clean)]

    if (b_clean, m_clean) not in _dynamic_model_map:
        _max_model_id_num += 1
        _dynamic_model_map[(b_clean, m_clean)] = f"MDL-{_max_model_id_num:03d}"
    return _dynamic_model_map[(b_clean, m_clean)]


def resolve_variant_id(model_id: str | None, variant_text: str | None, variant_index: dict[tuple[str, str], str]) -> str | None:
    if not model_id:
        return None
    v_clean = str(variant_text or "").lower().strip()
    if (model_id, v_clean) in variant_index:
        return variant_index[(model_id, v_clean)]
    for (m_id, var_key), v_id in variant_index.items():
        if m_id == model_id and var_key and (var_key in v_clean or v_clean in var_key):
            return v_id

    if (model_id, v_clean) not in _dynamic_variant_map:
        seq = len([k for k in _dynamic_variant_map.keys() if k[0] == model_id]) + 1
        _dynamic_variant_map[(model_id, v_clean)] = f"{model_id}-V{seq:02d}"
    return _dynamic_variant_map[(model_id, v_clean)]


NOISE_WORDS_RE = re.compile(
    r"(FOB价格表|EXW价格表|FCA价格表|库存价格表|价格表|报价表|价格|报价|FOB|EXW|FCA|\.png|\.jpg|\.pdf|\.txt|\.xlsx|\.csv|"
    r"国[IVVIVIⅥⅤ456]|China\s*[IVVIVIⅥⅤ456]|国六b?\s*RDE|国六B（RDE）|国六B\(RDE\)|国Ⅴ|国Ⅵ|"
    r"2026款|2025款|2024款|第三代|第四代|全新第二代)",
    re.IGNORECASE,
)


def clean_noise_words(text: str) -> str:
    cleaned = NOISE_WORDS_RE.sub("", text).strip(" _-.\n\r")
    return cleaned


FOOTER_NOISE_PATTERNS = [
    r"^\d+[\.、\s]",  # Starts with digit dot e.g. "1. ", "2. ", "3. "
    r"汇率", r"境外人民币", r"基于.*港", r"滚装船", r"运费", r"单独计算", r"套色", r"额外增加",
    r"含税", r"不含税", r"含国内运费", r"二类底盘", r"售价", r"定金", r"订金",
    r"交付", r"款项", r"尾款", r"有效", r"截止", r"说明", r"提示",
    r"微卡mini", r"微面mini", r"微卡", r"微面", r"车系", r"车型", r"五菱电动车", r"五菱批发端", r"现车可指定发运", r"加价", r"来源",
    r"广州现车", r"南沙现车", r"无改装", r"无变速器", r"新车直出"
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


def get_chinese_to_english_brands() -> dict[str, str]:
    """Fetch Chinese to English brand translation map from RuleEngine SSOT."""
    return get_rule_engine().kb_data.get("chinese_to_english_brands", {})


def resolve_wuling_model_code(model_code: str) -> str | None:
    if not model_code:
        return None
    mc = model_code.upper().strip()
    
    # 1. Check RuleEngine SSOT wuling_model_code_mappings
    kb_mappings = get_rule_engine().kb_data.get("wuling_model_code_mappings", {})
    for code, model_name in kb_mappings.items():
        if mc.startswith(code) or mc == code:
            return model_name

    if mc.startswith(("LZW6470", "LZW6478")):
        return "Starlight S"
    if mc.startswith(("LZW6502", "LZW6500", "LZW6521")):
        return "Starlight L"
    if mc.startswith(("LZW6490", "LZW6461", "LZW7154", "LZW7157")):
        return "Starlight"
    if mc.startswith(("LZW6451", "LZW6452")):
        return "Bingo Plus"
    if mc.startswith(("LZW7009", "LZW7004", "E261")):
        return "Bingo"
    if mc.startswith(("LZW6389", "LZW6402", "LZW6448", "LZW6449", "LZW6450")):
        return "Hongguang"
    if mc.startswith(("LZW1020", "LZW1028", "LZW1029", "LZW1030", "LZW5021", "LZW5022", "LZW5024", "LZW5028", "LZW5030", "LZW5032", "LZW5033")):
        return "Rongguang"
    if mc.startswith("LZW7001") or mc == "001":
        return "Hongguang MINI EV"
    if mc.startswith("LZW7007") or mc in ("07", "7"):
        return "Baojun 07"
    return None


def normalize_brand_model(brand: Any, model: Any) -> tuple[str | None, str | None]:
    brand_text = clean_noise_words(str(brand or "").strip())
    model_text = clean_noise_words(str(model or "").strip())

    if is_invalid_model_name(model_text):
        model_text = ""

    brand_map = get_chinese_to_english_brands()

    # Check if brand_text is actually a model name (e.g. "2025款 A7", "A7", "吉利牛仔", "星耀6")
    has_known_brand = False
    for zh_brand, en_brand in brand_map.items():
        if brand_text and (brand_text == zh_brand or zh_brand in brand_text or en_brand.lower() == brand_text.lower()):
            has_known_brand = True
            break

    if not has_known_brand and brand_text:
        for (rb, rm), (mapped_b, mapped_m) in BRAND_MODEL_MAP.items():
            if rm and len(rm) >= 2 and re.search(r"\b" + re.escape(rm.lower()) + r"\b", brand_text.lower()):
                model_text = mapped_m
                brand_text = mapped_b
                has_known_brand = True
                break

    bt_clean = brand_text.lower().replace(" ", "") if brand_text else ""
    mt_clean = model_text.lower().replace(" ", "") if model_text else ""

    # 0. Translate Chinese brand name if present
    for zh_brand, en_brand in brand_map.items():
        if brand_text and (brand_text == zh_brand or zh_brand in brand_text):
            brand_text = en_brand
            bt_clean = brand_text.lower().replace(" ", "")
            break

    # 1. Wuling model code resolution
    if brand_text == "Wuling" or bt_clean == "wuling":
        wuling_resolved = resolve_wuling_model_code(model_text)
        if wuling_resolved:
            return "Wuling", wuling_resolved

    # 2. Match against BRAND_MODEL_MAP (loaded from config/brand_model_mapping.json)
    for (raw_brand, raw_model), mapped in BRAND_MODEL_MAP.items():
        if raw_brand:
            rb_clean = raw_brand.lower().replace(" ", "")
            mb_clean = mapped[0].lower().replace(" ", "")
            rm_clean = raw_model.lower().replace(" ", "") if raw_model else ""
            brand_matched = (
                rb_clean == bt_clean or
                rb_clean in bt_clean or
                mb_clean == bt_clean or
                mb_clean in bt_clean or
                (rb_clean in ("比亚迪", "byd") and ("byd" in bt_clean or "比亚迪" in bt_clean))
            )
            if len(rm_clean) <= 2:
                model_matched = (
                    (rm_clean and rm_clean == mt_clean) or
                    (rm_clean and rm_clean == bt_clean) or
                    (rm_clean and bool(re.search(r"\b" + re.escape(rm_clean) + r"\b", mt_clean, re.IGNORECASE))) or
                    (rm_clean and bool(re.search(r"\b" + re.escape(rm_clean) + r"\b", bt_clean, re.IGNORECASE)))
                )
            else:
                model_matched = (
                    rm_clean and (
                        rm_clean in mt_clean or
                        rm_clean in bt_clean or
                        (rm_clean.replace("ev", "") in mt_clean if "ev" in rm_clean else False)
                    )
                )
            if brand_matched and model_matched:
                final_brand = mapped[0]
                final_model = mapped[1] if rm_clean else (model_text or None)
                return final_brand, final_model

    # 2. Translate Chinese brand name if present for fallback matching
    for zh_brand, en_brand in brand_map.items():
        if brand_text and (brand_text == zh_brand or zh_brand in brand_text):
            brand_text = en_brand
            bt_clean = brand_text.lower().replace(" ", "")
            break

    # 3. Wuling industrial model code resolution
    if brand_text == "Wuling" or bt_clean == "wuling":
        wuling_resolved = resolve_wuling_model_code(model_text)
        if wuling_resolved:
            return "Wuling", wuling_resolved

    # 4. Fallback brand resolution from official brands in BRAND_MODEL_MAP
    official_brands = {b for _, (b, _) in BRAND_MODEL_MAP.items()}
    official_models = {m for _, (_, m) in BRAND_MODEL_MAP.items()}

    for official_brand in official_brands:
        if official_brand.lower().replace(" ", "") == bt_clean or official_brand.lower() in bt_clean:
            brand_text = official_brand
            break

    # 5. Fallback model resolution from official models in BRAND_MODEL_MAP
    for official_model in official_models:
        om_clean = official_model.lower().replace(" ", "")
        if len(om_clean) <= 2:
            model_matched = (om_clean == mt_clean)
        else:
            model_matched = (om_clean == mt_clean or om_clean in mt_clean)
        if model_matched:
            model_text = official_model
            break

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
    """Normalize location using RuleEngine SSOT."""
    return get_rule_engine().normalize_location(val)

    # Remove generic location suffixes like 基地, 港, 仓, 站, 口岸, 保税区, 是
    cleaned = re.sub(r"(?:基地|港口|港|仓库|仓|口岸|综合保税区|保税区|黄埔|梅山|盐田|蛇口|是)+$", "", cleaned).strip()
    return cleaned if cleaned else None


def extract_trade_term_prices_and_location(row: dict[str, Any]) -> dict[str, Any]:
    exw = to_number(row.get("costExwUsd") or row.get("cost_exw_usd") or row.get("priceExw"))
    fob = to_number(row.get("costFobUsd") or row.get("cost_fob_usd") or row.get("priceFob"))
    fca = to_number(row.get("costFcaUsd") or row.get("cost_fca_usd") or row.get("priceFca"))
    cny = to_number(row.get("supplierPriceCny") or row.get("supplier_price_cny") or row.get("officialPrice") or row.get("officialPriceCny") or row.get("official_suggested_price_cny") or row.get("officialSuggestedPrice"))

    raw_loc_sources = [
        str(row.get("FOB地点") or row.get("FOB港口") or row.get("fob_location") or ""),
        str(row.get("FCA地点") or row.get("FCA港口") or row.get("fca_location") or ""),
        str(row.get("EXW地点") or row.get("EXW港口") or row.get("exw_location") or ""),
        str(row.get("交付地点") or row.get("交货地点") or row.get("location") or "")
    ]
    raw_loc_combo = " ".join([s for s in raw_loc_sources if s])

    # If generic priceExw was assigned, but raw location/delivery text specifies FCA, FOB, or CIF (e.g. 'FCA南沙'):
    m_term = re.search(r"(FCA|FOB|EXW|CIF)", raw_loc_combo, re.IGNORECASE)
    if m_term and exw is not None and fca is None and fob is None:
        term = m_term.group(1).upper()
        if term == "FCA":
            fca, exw = exw, None
        elif term == "FOB":
            fob, exw = exw, None

    # Determine location prioritizing term-specific location columns
    loc = None
    if fob is not None and (row.get("FOB地点") or row.get("FOB港口")):
        loc = normalize_location_cn(row.get("FOB地点") or row.get("FOB港口"))
    elif fca is not None and (row.get("FCA地点") or row.get("FCA港口")):
        loc = normalize_location_cn(row.get("FCA地点") or row.get("FCA港口"))
    elif exw is not None and (row.get("EXW地点") or row.get("EXW港口")):
        loc = normalize_location_cn(row.get("EXW地点") or row.get("EXW港口"))

    if not loc:
        for loc_src in [row.get("location"), row.get("交付地点"), row.get("交货地点"), row.get("提货地"), row.get("提货地点")]:
            clean_l = normalize_location_cn(loc_src)
            if clean_l:
                loc = clean_l
                break

    text_parts = [
        str(row.get("variant") or row.get("trimName") or row.get("trim_config") or ""),
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

    has_usd_symbol = bool(re.search(r"[\$]|USD", combo_text, re.IGNORECASE))
    if not has_usd_symbol:
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


def clean_variant_and_extract_notes(
    trim_val: Any,
    brand: str,
    model: str,
    raw_brand: Any = None,
    raw_model: Any = None,
    existing_notes: str | None = None
) -> tuple[str | None, str | None]:
    if trim_val is None:
        return None, existing_notes

    trim_raw_str = str(trim_val).strip()
    if not trim_raw_str:
        return None, existing_notes

    lines = [line.strip() for line in trim_raw_str.split("\n") if line.strip()]
    unique_lines = []
    for line in lines:
        if line not in unique_lines:
            unique_lines.append(line)

    equipment_details: list[str] = []
    clean_parts: list[str] = []

    for line in unique_lines:
        match_paren = re.search(r"([（\(][^）\)]+[）\)])", line)
        if match_paren:
            detail = line.strip()
            if detail not in equipment_details:
                equipment_details.append(detail)
            c_line = re.sub(r"[（\(][^）\)]+[）\)]", "", line).strip()
            if c_line and c_line not in clean_parts:
                clean_parts.append(c_line)
        elif any(kw in line for kw in ["空调", "EPS", "ABS", "显示屏", "扬声器", "悬挂", "悬架", "铝合金", "雷达", "天窗", "快充", "座椅", "退税", "关税", "内饰", "座", "门"]):
            if line not in equipment_details:
                equipment_details.append(line)
            m_short = re.match(r"^(LV\d+(?:\s*[\u4e00-\u9fa5]+)?|[^\s,，、；;]+)", line, re.IGNORECASE)
            if m_short:
                c_part = m_short.group(1).strip()
                if c_part and c_part not in clean_parts:
                    clean_parts.append(c_part)
        else:
            if line not in clean_parts:
                clean_parts.append(line)

    clean_trim = " ".join(clean_parts) if clean_parts else (unique_lines[0] if unique_lines else "")
    if clean_trim:
        clean_trim = clean_variant(clean_trim, brand, model, raw_brand, raw_model)

    if clean_trim:
        tokens = clean_trim.split()
        if len(tokens) >= 2 and len(set(tokens)) == 1:
            clean_trim = tokens[0]

    notes_list: list[str] = []
    if existing_notes and str(existing_notes).strip():
        notes_list.append(str(existing_notes).strip())

    if equipment_details:
        zh_details = [d for d in equipment_details if re.search(r"[\u4e00-\u9fa5]", d)]
        note_text = "; ".join(zh_details if zh_details else equipment_details)
        if note_text not in notes_list:
            notes_list.append(f"配置详情: {note_text}")

    final_notes = "; ".join(notes_list) if notes_list else None
    return clean_trim or None, final_notes


def clean_variant(trim_val: Any, brand: str, model: str, raw_brand: Any = None, raw_model: Any = None) -> str | None:
    if trim_val is None:
        return None
    trim_str = str(trim_val).strip()
    if not trim_str:
        return None

    # 0. Strip parenthetical equipment detail lists
    trim_str = re.sub(r"[（\(][^）\)]*[）\)]", "", trim_str).strip()

    # 1. Filter out technical parameter / dimension / chassis noise and trade term price suffixes
    trim_str = re.sub(r"\b(LV\d+)\s+\1\b", r"\1", trim_str, flags=re.IGNORECASE)
    trim_str = re.sub(r"(?:的)?(?:EXW|FOB|FCA|CIF)[^\d]*\d+.*$", "", trim_str, flags=re.IGNORECASE).strip()
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

    wuling_series_keywords = ["荣光", "宏光", "之光", "缤果", "星光", "rongguang", "hongguang", "sunshine", "bingo", "starlight"]

    for target in to_strip:
        if target and len(target) >= 2:
            if brand == "Wuling" and target.lower() in wuling_series_keywords:
                continue
            if trim_str.lower() == target.lower() or trim_str.lower() == f"{target.lower()}新款" or trim_str == f"{target}+":
                return None
            pattern = re.compile(rf"^{re.escape(target)}\s*[\+\-款]?\s*", re.IGNORECASE)
            trim_str = pattern.sub("", trim_str).strip()

    if not trim_str or trim_str in ("新款", "老款", "标准版", "默认", "+", "型", "款"):
        return None

    return trim_str


VALID_AUTOMOBILE_BRANDS: set[str] = {
    "BYD", "Geely", "Changan", "Wuling", "Dongfeng", "Toyota", "Jetour", "Fangchengbao",
    "Deepal", "Avatr", "Hongqi", "Leapmotor", "Li Auto", "XPENG", "Xiaomi", "IM Motors",
    "Zeekr", "Foton", "Farizon", "Chery", "GWM", "Tank", "Voyah", "AITO", "Stelato",
    "Maextro", "Shangjie", "Shandong EV", "Bestune", "GAC", "Audi", "BMW", "Mercedes-Benz",
    "Volkswagen", "Nissan", "Honda", "Volvo", "Hyundai", "Kia", "Radar", "MG", "Denza",
    "Yangwang", "Baojun", "FAW", "Forthing", "Maxus", "JMC", "Arcfox", "Smart", "NIO"
}


def format_candidates_for_feishu(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    model_index = load_model_index()
    variant_index = load_variant_index()
    formatted: list[dict[str, Any]] = []
    for row in rows:
        brand_raw = row.get("brand")
        model_raw = row.get("modelName") or row.get("model")
        brand, model = normalize_brand_model(brand_raw, model_raw)
        
        # Check if row represents an unstructured OCR image/text document
        is_unstructured_doc = bool(row.get("ocr_raw") or row.get("raw") or row.get("_source_file") or row.get("_rawText"))
        if not brand or not model or brand in ("未知", "unknown") or model in ("待确认车型", "未知", "unknown"):
            fallback_text = f"{row.get('variant') or row.get('trimName') or row.get('trim_config') or ''} {row.get('ocr_raw') or ''} {row.get('raw') or ''} {row.get('_source_file') or ''}"
            if not brand or brand in ("未知", "unknown"):
                for b_cand in ["BYD", "Foton", "Geely", "Wuling", "Changan", "Farizon", "Dongfeng", "XPENG", "Zeekr", "Xiaomi", "AITO", "Deepal", "GAC Aion", "MG", "Radar", "Stelato", "Tank", "Voyah", "Hongqi", "Leapmotor", "GWM"]:
                    if b_cand.lower() in fallback_text.lower() or (b_cand == "BYD" and "比亚迪" in fallback_text):
                        brand = b_cand
                        break
            if not model or model in ("待确认车型", "未知", "unknown"):
                for (rb, rm), mapped in BRAND_MODEL_MAP.items():
                    if rm:
                        rm_clean = rm.lower().strip()
                        if len(rm_clean) <= 2:
                            rm_matched = bool(re.search(r"\b" + re.escape(rm_clean) + r"\b", fallback_text.lower()))
                        else:
                            rm_matched = (rm_clean in fallback_text.lower())
                        if rm_matched:
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

        if any(noise in str(model).lower() for noise in ("注：", "来源", "合计", "小计", "总计", "小结", "加价", "车型代码", "subtotal", "total")) or any(noise in str(brand).lower() for noise in ("注：", "来源", "合计", "小计")):
            continue

        if brand not in VALID_AUTOMOBILE_BRANDS:
            continue

        final_brand = brand
        final_model = model
        trim_val = row.get("variant") or row.get("trimName") or row.get("trimConfig") or row.get("trim_config")

        # Wuling brand & series rule: brand MUST ALWAYS be Wuling; series keywords (荣光, 宏光, 之光, 缤果, 星光) belong in variant
        wuling_series_map = {
            "荣光": "荣光", "rongguang": "Rongguang",
            "宏光": "宏光", "hongguang": "Hongguang",
            "之光": "之光", "sunshine": "Sunshine",
            "缤果": "缤果", "bingo": "Bingo",
            "星光": "星光", "starlight": "Starlight"
        }
        wuling_tokens = ["wuling", "五菱", "sgmw", "五菱汽车"] + list(wuling_series_map.keys())
        search_scope = f"{brand} {model} {row.get('supplierName') or ''} {row.get('variant') or row.get('trimName') or ''} {row.get('trim_config') or ''} {row.get('ocr_raw') or ''} {row.get('_source_file') or ''}".lower()
        if any(tok in search_scope for tok in wuling_tokens):
            final_brand = "Wuling"
            found_series = None
            for s_kw, s_val in wuling_series_map.items():
                if s_kw in search_scope:
                    found_series = s_val
                    break
            if found_series:
                curr_trim = str(trim_val or "").strip()
                if found_series.lower() not in curr_trim.lower():
                    trim_val = f"{found_series} {curr_trim}".strip()

        wait_days = to_number(row.get("orderWaitDays") or row.get("order_wait_days")) or parse_wait_days(row.get("leadTimeText") or row.get("orderWaitingPeriod"))
        version_raw = f"{row.get('marketRegion') or ''} {row.get('version_type') or ''} {row.get('ocr_raw') or row.get('raw') or ''} {row.get('notes') or ''} {row.get('variant') or row.get('trimName') or ''} {row.get('_source_file') or ''}"
        version_type = None
        if "国内" in version_raw or "中规" in version_raw or "DOMESTIC" in version_raw.upper():
            version_type = "国内版"
        elif any(token in version_raw for token in ("国际", "出口", "海外", "欧标", "美规")) or "INTERNATIONAL" in version_raw.upper():
            version_type = "国际版"

        steering_raw = f"{row.get('steeringSetup') or ''} {row.get('steering_setup') or ''} {row.get('ocr_raw') or row.get('raw') or ''} {row.get('notes') or ''} {row.get('variant') or row.get('trimName') or ''}".upper()
        if "右舵" in steering_raw or "RHD" in steering_raw:
            steering = "右舵"
        elif "左舵" in steering_raw or "LHD" in steering_raw:
            steering = "左舵"
        elif version_type == "国内版":
            steering = "左舵"
        else:
            steering = None
        status_raw = str(row.get("statusVehicle") or row.get("status_vehicle") or "").lower()
        if "现车" in status_raw or "stock" in status_raw:
            status_v = "现车"
        elif "在途" in status_raw or "transit" in status_raw:
            status_v = "在途"
        else:
            status_v = "无具体信息" if status_raw else None

        model_id = row.get("model_id") or row.get("modelId") or get_or_create_model_id(final_brand, final_model, model_index)

        trim_val = row.get("variant") or row.get("trimName") or row.get("trimConfig") or row.get("trim_config")
        if model_raw and str(model_raw).strip():
            m_raw_str = str(model_raw).strip()
            if m_raw_str.lower() != str(final_model).lower() and m_raw_str.lower() != str(final_brand).lower():
                if trim_val:
                    t_str = str(trim_val).strip()
                    if m_raw_str not in t_str and t_str not in m_raw_str:
                        trim_val = f"{m_raw_str} {t_str}"
                else:
                    trim_val = m_raw_str
        
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

        existing_note = row.get("notes") or row.get("remark") or row.get("备注")
        variant_val, final_notes = clean_variant_and_extract_notes(
            trim_val, final_brand, final_model, brand_raw, model_raw, existing_notes=existing_note
        )

        variant_id = row.get("variant_id") or row.get("variantId") or row.get("trim_config_id") or resolve_variant_id(model_id, variant_val, variant_index)

        conf_raw = row.get("confidence") or row.get("ocr_confidence") or row.get("_confidence")
        if conf_raw is not None:
            conf_val = round(float(conf_raw), 2)
        else:
            # Field extraction completeness & quality score
            score = 1.00
            if official_price is None and exw_usd is None and fob_usd is None and fca_usd is None:
                score -= 0.15
            if not row.get("exteriorColor") and not row.get("exterior_color"):
                score -= 0.05
            if not variant_val:
                score -= 0.05
            conf_val = round(max(0.50, score), 2)

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
            "variant_id": variant_id,
            "brand": final_brand,
            "model": final_model,
            "variant": variant_val,
            "trim_config": variant_val,
            "trim_config_id": variant_id,
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
            "notes": final_notes,
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

    # Post-process: Deduplicate exact identical records and collapse priceless redundant duplicate rows
    deduped: list[dict[str, Any]] = []
    seen_keys: set[tuple[Any, ...]] = set()
    priceless_keys: set[tuple[Any, ...]] = set()

    for item in formatted:
        sup = item.get("supplier") or ""
        b = item.get("brand") or ""
        m = item.get("model") or ""
        t = item.get("variant") or item.get("trim_config") or ""
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

        # Filter out priceless section header rows from structured excel parsing (where all prices, colors, and trim are None)
        is_priceless = (cny is None and exw is None and fob is None and fca is None)
        if item.get("_type") == "structured" and is_priceless and not ext and not t:
            continue

        if is_priceless and not ext:
            p_key = (sup, b, m, t, src)
            if p_key in priceless_keys:
                continue
            priceless_keys.add(p_key)

        deduped.append(item)

    return deduped


FEISHU_FIELD_MAP = get_feishu_field_map()

FEISHU_TABLE_ALLOWED_FIELDS = {
    "record_id", "supplier", "brand", "model", "model_id", "variant", "variant_id", "trim_config", "trim_config_id",
    "manufacture_year", "manufacture_month", "exterior_color", "interior_color",
    "stock_quantity", "min_quantity", "max_quantity", "supplier_price_cny",
    "cost_exw_usd", "cost_fob_usd", "cost_fca_usd", "location", "steering_setup",
    "market_region", "confidence", "notes", "order_wait_days", "display_price_low",
    "display_price_high", "review_progress", "reviewer", "ai_importer", "developer"
}


def record_to_feishu_fields(record: dict[str, Any]) -> dict[str, Any]:
    fields: dict[str, Any] = {}
    for db_col, feishu_col in FEISHU_FIELD_MAP.items():
        if feishu_col not in FEISHU_TABLE_ALLOWED_FIELDS:
            continue
        val = record.get(db_col)
        if val not in (None, ""):
            fields[feishu_col] = val

    if not fields.get("record_id") and record.get("id"):
        fields["record_id"] = str(record["id"])

    if record.get("version_type"):
        fields["market_region"] = [record["version_type"]]

    if "brand" in fields and isinstance(fields["brand"], list):
        fields["brand"] = fields["brand"][0] if fields["brand"] else None
        if not fields["brand"]:
            fields.pop("brand", None)

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

    search_dirs = [PROJECT_ROOT / "input"]
    processed_paths: set[Path] = set()

    for target_dir in search_dirs:
        if not target_dir.exists():
            continue
        for file_path in sorted(target_dir.rglob("*")):
            if not file_path.is_file() or file_path.suffix.lower() not in {".xlsx", ".xls", ".csv"}:
                continue
            resolved = file_path.resolve()
            if resolved in processed_paths:
                continue
            processed_paths.add(resolved)

            content_hash = compute_file_hash(file_path)
            if _already_processed(db, content_hash):
                print(f"Skipping already processed file: {file_path.name}")
                continue

            try:
                rows = parse_excel_file(file_path)
            except Exception as e:
                print(f"Warning: Skipping unparseable Excel file {file_path.name}: {e}")
                continue
            for row in rows:
                row["_content_hash"] = content_hash
                row["_source_file"] = file_path.name

            try:
                rel_path = file_path.relative_to(target_dir)
            except Exception:
                rel_path = Path(file_path.name)

            json_out_path = parsed_dir / rel_path.with_suffix(".json")
            json_out_path.parent.mkdir(parents=True, exist_ok=True)
            json_out_path.write_text(json.dumps(rows, default=str, ensure_ascii=False, indent=2), encoding="utf-8")

            results.append({"source": str(file_path), "outputPath": str(json_out_path), "rowCount": len(rows), "rows": rows})
            _mark_processed(db, file_path.name, content_hash, dry_run)

    (parsed_dir / "manifest.json").write_text(json.dumps({
        "processedAt": datetime.now().isoformat(),
        "totalFiles": len(results),
        "totalRows": sum(r["rowCount"] for r in results),
        "files": [{k: r[k] for k in ("source", "outputPath", "rowCount")} for r in results],
    }, ensure_ascii=False, indent=2), "utf-8")
    return results




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


def clear_feishu_table(access_token: str, app_token: str, table_id: str) -> int:
    headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}
    deleted_count = 0
    while True:
        list_url = f"https://open.feishu.cn/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/records?page_size=500"
        res = fetch_with_retry("GET", list_url, headers=headers)
        data = res.get("data", {})
        items = data.get("items", [])
        if not items:
            break
        record_ids = [item["record_id"] for item in items]

        for i in range(0, len(record_ids), 500):
            chunk = record_ids[i:i + 500]
            del_url = f"https://open.feishu.cn/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/records/batch_delete"
            fetch_with_retry("POST", del_url, headers=headers, json={"records": chunk})
            deleted_count += len(chunk)

        if not data.get("has_more"):
            break
    print(f"Cleared {deleted_count} existing records from Feishu table ({table_id}).")
    return deleted_count


def sync_to_feishu(candidates: list[dict[str, Any]], dry_run: bool = False, clear_table: bool = True) -> bool:
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

    if clear_table:
        clear_feishu_table(access_token, app_token, table_id)

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
        excel_results = run_excel_parsing(db, args.dry_run)
        merged = [row for result in excel_results for row in result["rows"]]
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
        from .rule_engine import get_rule_engine
        engine = get_rule_engine()
        engine.record_run_telemetry(deterministic_count=len(formatted), ai_count=0)

        print(f"Pipeline stage 1-2 complete: {len(formatted)} candidates staged.")
        print(f"JSON: {json_path}")
        print(f"CSV: {csv_path}")
        print(engine.get_telemetry_summary())
        return 0
    finally:
        db.close()


def list_pending(db: sqlite3.Connection) -> list[sqlite3.Row]:
    existing_cols = {row["name"] for row in db.execute("PRAGMA table_info(source_candidates)").fetchall()}
    v_col = "variant" if "variant" in existing_cols else "trim_config"
    v_id_col = "variant_id" if "variant_id" in existing_cols else "trim_config_id"
    return db.execute(f"SELECT id, supplier, brand, model, model_id, {v_col} AS variant, {v_id_col} AS variant_id, manufacture_year, manufacture_month, stock_quantity, cost_exw_usd, notes, status FROM source_candidates WHERE status = 'pending'").fetchall()


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
            priority = ["id", "supplier", "brand", "model", "model_id", "variant", "variant_id", "stock_quantity", "cost_exw_usd", "notes", "status"]
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
        old_row = db.execute("SELECT * FROM source_candidates WHERE id = ?", (record_id,)).fetchone()
        old_val = dict(old_row).get(key) if old_row else None

        db.execute(f"UPDATE source_candidates SET {key} = ? WHERE id = ?", (value, record_id))
        db.commit()
        print(f"Updated record #{record_id}: {key} = {value}")

        from .rule_engine import get_rule_engine
        engine = get_rule_engine()
        rule = engine.distill_rule_from_edit(key, old_val, value, context=f"record_{record_id}")
        if rule:
            print(f"💡 已自动提炼并持久化保存规则: [{key}] '{old_val}' -> '{value}'")
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


import argparse
import sys


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="MinerU vehicle source recognition pipeline")
    parser.add_argument("positional_action", nargs="?", help="Optional action: run/list/edit/delete/sync/clean")
    parser.add_argument("--action", choices=["run", "list", "edit", "delete", "sync", "clean"], help="Pipeline action")
    parser.add_argument("--dry-run", action="store_true", help="Generate outputs without SQLite staging or Feishu upload")
    parser.add_argument("--id", dest="record_id", help="Record id for edit/delete")
    parser.add_argument("--key", help="Column key for edit")
    parser.add_argument("--val", help="New value for edit")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    action = args.action or args.positional_action or "run"
    if action == "run":
        return run_pipeline(args)
    if action == "list":
        return action_list()
    if action == "edit":
        if not args.record_id or not args.key or args.val is None:
            parser.error("edit requires --id <id> --key <field> --val <value>")
        return action_edit(args.record_id, args.key, args.val)
    if action == "delete":
        if not args.record_id:
            parser.error("delete requires --id <id>")
        return action_delete(args.record_id)
    if action == "sync":
        return action_sync(args.dry_run)
    if action == "clean":
        return action_clean()
    parser.error(f"Unknown action: {action}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
