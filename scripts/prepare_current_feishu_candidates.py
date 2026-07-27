from __future__ import annotations

import argparse
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any

from openpyxl import load_workbook


ROOT = Path("C:/Users/HP/Downloads/车源汇总纯净 (2)/车源汇总纯净")

CURRENT_FIELDS = [
    "model_id",
    "confidence",
    "brand",
    "supplier",
    "max_quantity",
    "exterior_color",
    "model",
    "trim_config",
    "supplier_price_cny",
    "cost_fca_usd",
    "trim_config_id",
    "cost_fob_usd",
    "notes",
    "order_wait_days",
    "manufacture_year",
    "min_quantity",
    "record_id",
    "interior_color",
    "location",
    "steering_setup",
    "market_region",
    "cost_exw_usd",
    "manufacture_month",
    "display_price_low",
    "stock_quantity",
    "vehicle_supply_base",
    "display_price_high",
]


def clean(value: Any) -> str | None:
    if value in (None, ""):
        return None
    text = str(value).strip()
    return text if text not in {"", "/", "-", "—"} else None


def number(value: Any) -> int | float | None:
    if value in (None, ""):
        return None
    if isinstance(value, (int, float)):
        return int(value) if float(value).is_integer() else float(value)
    match = re.search(r"-?\d+(?:\.\d+)?", str(value).replace(",", ""))
    if not match:
        return None
    parsed = float(match.group(0))
    return int(parsed) if parsed.is_integer() else parsed


def split_color_quantity(exterior: Any, stock: Any) -> tuple[int | float | None, str | None]:
    text = clean(exterior)
    qty = number(stock)
    if not text:
        return qty, None
    match = re.match(r"^(\d+)(.+)$", text)
    if match:
        return number(match.group(1)), clean(match.group(2))
    return qty, text


def parse_year_month(value: Any) -> tuple[int | None, int | None]:
    if isinstance(value, datetime):
        return value.year, value.month
    text = clean(value)
    if not text:
        return None, None
    match = re.search(r"(20\d{2})[-年./](\d{1,2})", text)
    if match:
        return int(match.group(1)), int(match.group(2))
    match = re.search(r"(20\d{2})", text)
    if match:
        return int(match.group(1)), None
    return None, None


def normalize_market(value: Any) -> list[str] | None:
    text = clean(value)
    if not text:
        return None
    if "国际" in text or "出口" in text or "海外" in text:
        return ["国际版"]
    if "国内" in text or "中规" in text:
        return ["国内版"]
    return None


def split_model_trim(brand: str | None, raw_model: Any, raw_trim: Any = None) -> tuple[str | None, str | None]:
    model = clean(raw_model)
    trim = clean(raw_trim)
    if not model:
        return None, trim
    original = model
    if brand == "BYD" and trim and "海鸥" not in model and re.search(r"(Sealion|Seagull)", trim, re.I):
        return trim, model
    if brand == "Wuling":
        first_line = model.splitlines()[0].strip()
        first_line = re.sub(r"\s*载重\s*\d+\s*kg.*$", "", first_line, flags=re.I).strip()
        if re.fullmatch(r"\d{3,5}", first_line):
            first_line = "Wuling"
        trim_parts = [part for part in (model if first_line != model else None, trim) if part]
        return first_line, " | ".join(trim_parts) if trim_parts else None
    if brand == "Geely":
        text = re.sub(r"^20\d{2}\s*Model\s*", "", model, flags=re.I)
        text = re.sub(r"^20\d{2}款\s*", "", text)
        geely_match = re.search(r"(Galaxy\s+[A-Za-z]+\s*\d+|Galaxy\s+[A-Z]\d+|BoYue\s+REV|Geely\s+ICON|A7|全新牛仔|银河[^/\\n]+|博越REV|吉利ICON[^/\\n]*)", text, re.I)
        if geely_match:
            family = geely_match.group(1).strip(" /")
            trim_parts = [part for part in (model.replace(geely_match.group(0), "", 1).strip(" /"), trim) if part]
            return family, " | ".join(trim_parts) if trim_parts else None
        if model in {"2025款", "2026款"}:
            return "全新牛仔", trim
    if brand == "Changan":
        text = re.sub(r"^20\d{2}款?", "", model).strip()
        for token in ("UNI-Z PHEV", "UNI-Z", "CS75PLUS", "CS75 PRO", "长安X5PLUS", "X5PLUS", "第四代逸动"):
            if token.lower() in text.lower():
                trim_parts = [part for part in (text.replace(token, "", 1).strip(), trim) if part]
                return token, " | ".join(trim_parts) if trim_parts else None
    rules = [
        (r"\b(V6E|V7E|V8E|SV\d*|新V)\b", None),
        (r"(UNI-Z\s*PHEV|UNI-Z|CS75PLUS|第四代逸动|启源\s*Q05|Q05)", None),
        (r"(A7|全新牛仔|银河\s*E5|Galaxy\s*E5)", None),
        (r"(第二代秦PLUS|秦PLUS)", "秦PLUS"),
        (r"(驱逐舰05)", "驱逐舰05"),
        (r"(海狮05\s*EV|海狮05EV)", "海狮05EV"),
        (r"(海狮06\s*DMI|海狮06DMI)", "海狮06 DMI"),
        (r"(海狮07\s*EV|海狮07EV|Sealion\s*7EV|Sealion\s*7)", "海狮07EV"),
        (r"(BYD\s+SHARK\s*6|SHARK\s*6)", "Shark 6"),
        (r"(BYD\s+TI7|TI7|钛7)", "Ti 7"),
        (r"(钛3)", "钛3"),
        (r"(ATTO3)", "ATTO3"),
        (r"(T03)", "T03"),
        (r"(Smart\s*#\d)", None),
        (r"(i60)", "i60"),
        (r"\b(L6|LS6)\b", None),
        (r"\b(X50|X70FL|X70PLUS|DASHING|T1|T2|G700)\b", None),
    ]
    for pattern, replacement in rules:
        match = re.search(pattern, model, re.I)
        if match:
            family = replacement or match.group(1).strip()
            remainder = model.replace(match.group(0), "", 1).strip(" -/：:（）()")
            trim_parts = [part for part in (remainder, trim) if part]
            return family, " | ".join(trim_parts) if trim_parts else None
    if brand in {"Geely", "Wuling", "Changan", "Deepal", "Farizon", "AVATR", "Xiaomi", "IM Motors", "Toyota", "Foton", "Jetour", "Smart"}:
        return model, trim
    return original, trim


def evidence_text(row: dict[str, Any]) -> str:
    source_file = row.get("source_file")
    sheet = row.get("source_sheet")
    source_row = row.get("source_row")
    parts = [f"# Path: {source_file}", f"Sheet: {sheet}", f"row {source_row}"]
    if source_file and sheet and source_row:
        path = ROOT / str(source_file)
        try:
            wb = load_workbook(path, data_only=True)
            ws = wb[str(sheet)]
            header_values = [cell.value for cell in ws[1]]
            header = " | ".join(str(v) for v in header_values if v not in (None, ""))
            if header:
                parts.append(f"header: {header}")
            values = [cell.value for cell in ws[int(source_row)]]
            rendered = " | ".join(str(v) for v in values if v not in (None, ""))
            if rendered:
                parts.append(rendered)
            wb.close()
        except Exception:
            pass
    return "; ".join(str(part) for part in parts if part)


def source_values(row: dict[str, Any]) -> list[Any]:
    source_file = row.get("source_file")
    sheet = row.get("source_sheet")
    source_row = row.get("source_row")
    if not source_file or not sheet or not source_row:
        return []
    try:
        wb = load_workbook(ROOT / str(source_file), data_only=True)
        ws = wb[str(sheet)]
        values = [cell.value for cell in ws[int(source_row)]]
        wb.close()
        return values
    except Exception:
        return []


def wait_days(notes: str | None) -> int | None:
    if not notes:
        return None
    match = re.search(r"(\d+)\s*-\s*(\d+)\s*周", notes)
    if match:
        return int(match.group(2)) * 7
    match = re.search(r"(\d+)\s*周", notes)
    if match:
        return int(match.group(1)) * 7
    return None


def calculate_confidence(row: dict[str, Any], candidate: dict[str, Any], source_evidence: str) -> float:
    score = 0.50
    notes = str(candidate.get("notes") or "")
    model = str(candidate.get("model") or "")
    trim = str(candidate.get("trim_config") or "")
    source_file = str(row.get("source_file") or "")
    raw_model = str(row.get("model") or "")
    raw_trim = str(row.get("trim_config") or "")
    evidence = f"{source_evidence} {notes}"

    if candidate.get("brand"):
        score += 0.10
    if candidate.get("model") and not re.search(r"\b(EXW|FCA|FOB|CIF|USD|CNY|RMB)\b|[$¥￥]\s*\d|\d{5,}", model, re.I):
        score += 0.15
    if any(candidate.get(field) not in (None, "", []) for field in ("supplier_price_cny", "cost_exw_usd", "cost_fca_usd", "cost_fob_usd")):
        score += 0.10
    if (
        ("CNY/RMB supplier price evidence" in evidence and candidate.get("supplier_price_cny"))
        or ("EXW USD evidence" in evidence and candidate.get("cost_exw_usd"))
        or ("FCA USD evidence" in evidence and candidate.get("cost_fca_usd"))
        or ("FOB USD evidence" in evidence and candidate.get("cost_fob_usd"))
    ):
        score += 0.10
    if candidate.get("supplier"):
        score += 0.10
    if candidate.get("location") or candidate.get("vehicle_supply_base"):
        score += 0.05
    if candidate.get("stock_quantity") and candidate.get("exterior_color"):
        score += 0.05
    if any(candidate.get(field) not in (None, "", []) for field in ("manufacture_year", "manufacture_month", "steering_setup", "market_region")):
        score += 0.05

    if candidate.get("supplier") and candidate.get("supplier") not in source_evidence and "# Path:" in source_evidence:
        score -= 0.10
    if model != raw_model or (trim and trim != raw_trim):
        score -= 0.10
    if any(candidate.get(field) not in (None, "", []) for field in ("supplier_price_cny", "cost_exw_usd", "cost_fca_usd", "cost_fob_usd")) and not re.search(r"\b(EXW|FCA|FOB|USD|CNY|RMB|人民币|美金|美元)\b|[$¥￥]", evidence, re.I):
        score -= 0.15
    if (candidate.get("location") or candidate.get("vehicle_supply_base")) and not row.get("location"):
        score -= 0.15
    if candidate.get("stock_quantity") and candidate.get("exterior_color") and re.search(r"[+＋]|\d+[^/]+/", str(row.get("exterior_color") or "")):
        score -= 0.15
    if any(token in source_evidence for token in ("merged:", "合并", "row None")) or row.get("source_row") in (None, ""):
        score -= 0.20
    if "霍尔果斯" in evidence and "南沙" in evidence and (candidate.get("location") or candidate.get("vehicle_supply_base")):
        score -= 0.30
    if re.search(r"\b[A-Z]{2,}\d{3,}|\d{5,}", raw_model + " " + raw_trim):
        score -= 0.30

    if any(token in evidence for token in ("地点冲突", "币种不明", "车型无法切分")):
        score = min(score, 0.59)
    return round(max(0.0, min(1.0, score)), 2)


def convert(row: dict[str, Any]) -> dict[str, Any] | None:
    brand = clean(row.get("brand"))
    values = source_values(row)
    raw_model = row.get("model")
    raw_trim = row.get("trim_config")
    source_file = str(row.get("source_file") or "")
    if brand == "Wuling" and values:
        raw_model = values[0] or raw_model
        raw_trim = " | ".join(clean(value) or "" for value in values[1:5] if clean(value)) or raw_trim
    elif brand == "Changan" and values and clean(values[0]):
        raw_model = values[0]
        raw_trim = " | ".join(clean(value) or "" for value in values[1:3] if clean(value)) or raw_trim
    elif brand == "Farizon" and "新V系列" in source_file and len(values) >= 8:
        raw_model = values[1] or raw_model
        raw_trim = " | ".join(clean(value) or "" for value in (values[2], values[7], values[6]) if clean(value)) or raw_trim
    elif brand == "Geely" and values and clean(values[0]):
        raw_model = values[0]
        raw_trim = " | ".join(clean(value) or "" for value in values[1:3] if clean(value)) or raw_trim
    elif brand == "BYD" and values and any("海鸥" in str(value or "") for value in values[:3]):
        raw_model = next(value for value in values[:3] if "海鸥" in str(value or ""))
        raw_trim = " | ".join(clean(value) or "" for value in values[4:7] if clean(value)) or raw_trim
    model, trim = split_model_trim(brand, raw_model, raw_trim)
    if not brand or not model:
        return None
    if any(token in model for token in ("若选择", "报价", "备注", "说明")):
        return None

    qty, exterior = split_color_quantity(row.get("exterior_color"), row.get("stock_quantity"))
    year, month = parse_year_month(row.get("manufacture_date") or row.get("production_date"))
    source_evidence = evidence_text(row)
    notes_parts = [clean(row.get("notes"))]
    for key in ("cost_exw_cny", "cost_fca_cny", "cost_fob_cny", "official_suggested_price_cny"):
        if row.get(key) not in (None, ""):
            notes_parts.append(f"{key}={row.get(key)}")
    notes_parts.append(f"source={row.get('source_file')} sheet={row.get('source_sheet')} row={row.get('source_row')}")
    notes = " | ".join(part for part in notes_parts if part)
    supplier_cny = row.get("cost_fca_cny") or row.get("cost_fob_cny") or row.get("cost_exw_cny") or row.get("official_suggested_price_cny")
    candidate = {field: None for field in CURRENT_FIELDS}
    candidate.update(
        {
            "confidence": None,
            "brand": brand,
            "supplier": clean(row.get("supplier")),
            "model": model,
            "trim_config": trim,
            "supplier_price_cny": supplier_cny,
            "cost_fca_usd": row.get("cost_fca_usd"),
            "cost_fob_usd": row.get("cost_fob_usd"),
            "cost_exw_usd": row.get("cost_exw_usd"),
            "notes": notes,
            "order_wait_days": wait_days(notes),
            "manufacture_year": year,
            "manufacture_month": month,
            "min_quantity": row.get("min_quantity") or 1,
            "record_id": row.get("content_hash"),
            "interior_color": clean(row.get("interior_color")),
            "exterior_color": exterior,
            "location": clean(row.get("location")),
            "vehicle_supply_base": clean(row.get("location")),
            "steering_setup": clean(row.get("steering_setup")),
            "market_region": normalize_market(row.get("version_type")),
            "display_price_low": None,
            "stock_quantity": qty,
        }
    )
    if not any(candidate.get(field) not in (None, "", []) for field in ("cost_fca_usd", "cost_fob_usd", "cost_exw_usd", "supplier_price_cny", "stock_quantity")):
        return None
    candidate["confidence"] = calculate_confidence(row, candidate, source_evidence)
    evidence = {field: source_evidence for field, value in candidate.items() if value not in (None, "", [])}
    if candidate.get("supplier_price_cny"):
        evidence["supplier_price_cny"] = f"{source_evidence}; CNY/RMB supplier price evidence"
    for price_field, term in (("cost_exw_usd", "EXW"), ("cost_fca_usd", "FCA"), ("cost_fob_usd", "FOB")):
        if candidate.get(price_field):
            evidence[price_field] = f"{source_evidence}; {term} USD evidence"
    if candidate.get("stock_quantity") and candidate.get("exterior_color") and "/" not in str(candidate.get("exterior_color")):
        combo = f"{candidate['stock_quantity']}{candidate['exterior_color']}"
        if candidate.get("interior_color"):
            combo = f"{combo}/{candidate['interior_color']}"
        combo_evidence = f"# Path: {row.get('source_file')}; Sheet: {row.get('source_sheet')}; row {row.get('source_row')}; {combo}"
        evidence["stock_quantity"] = combo_evidence
        evidence["exterior_color"] = combo_evidence
        if candidate.get("interior_color"):
            evidence["interior_color"] = combo_evidence
    if candidate.get("supplier"):
        evidence["supplier"] = f"# Path: {row.get('source_file')}"
    if candidate.get("brand"):
        evidence["brand"] = f"# Path: {row.get('source_file')}; {source_evidence}"
    if candidate.get("model"):
        evidence["model"] = source_evidence
    candidate["_evidence"] = evidence
    candidate["_source_file"] = row.get("source_file")
    return candidate


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="output/final/manual_feishu_ready_20260724.json")
    parser.add_argument("--output", default="output/final/current_feishu_candidates_20260727.json")
    args = parser.parse_args()
    rows = json.loads(Path(args.input).read_text("utf-8"))
    converted = [candidate for row in rows if (candidate := convert(row))]
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"records": converted}, ensure_ascii=False, indent=2), "utf-8")
    print(f"input_rows={len(rows)} output_records={len(converted)}")
    print(out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
