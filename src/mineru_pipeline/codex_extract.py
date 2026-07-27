from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
import json
import re
from typing import Any

from .excel_text import ExcelText, iter_excel_files, render_excel_file


TARGET_BASE_TOKEN = "Is6Xb3btbazhFhsDXgFcqFG1nRc"
TARGET_TABLE_ID = "tblyd52cT70XrFf1"
TARGET_VIEW_ID = "vewReBQXrZ"


@dataclass(frozen=True)
class FieldSpec:
    name: str
    field_type: str
    writable: bool = True
    options: tuple[str, ...] = ()
    description: str = ""


FIELD_SPECS: dict[str, FieldSpec] = {
    "model_id": FieldSpec("model_id", "text", description="车型库 ID。只有匹配到车型库时写入。"),
    "confidence": FieldSpec("confidence", "number", description="Codex 对该候选行的抽取置信度，0-1。"),
    "brand": FieldSpec("brand", "text", description="品牌。必须来自源表或车型库匹配。"),
    "developer": FieldSpec("developer", "user", writable=False, description="用户字段，普通批量写入跳过。"),
    "supplier": FieldSpec("supplier", "text", description="供应商名称，来自文件路径、表头或源表。"),
    "reviewer": FieldSpec("reviewer", "user", writable=False, description="多用户字段，普通批量写入跳过。"),
    "max_quantity": FieldSpec("max_quantity", "number", description="阶梯价格订购数量上限。"),
    "exterior_color": FieldSpec("exterior_color", "text", description="外观颜色。"),
    "model": FieldSpec("model", "text", description="车型主名称，不含配置、价格、备注。"),
    "trim_config": FieldSpec("trim_config", "text", description="配置/版本/款型。"),
    "supplier_price_cny": FieldSpec("supplier_price_cny", "number", description="供应商人民币报价，只写 CNY 原始报价。"),
    "cost_fca_usd": FieldSpec("cost_fca_usd", "number", description="FCA 美元成本价。"),
    "trim_config_id": FieldSpec("trim_config_id", "text", description="配置库 ID。只有匹配到配置库时写入。"),
    "cost_fob_usd": FieldSpec("cost_fob_usd", "number", description="FOB 美元成本价。"),
    "notes": FieldSpec("notes", "text", description="不适合写入其他字段的源表事实。"),
    "ai_importer": FieldSpec("ai_importer", "user", writable=False, description="用户字段，普通批量写入跳过。"),
    "order_wait_days": FieldSpec("order_wait_days", "number", description="订单等待周期天数，由周期文本换算。"),
    "review_progress": FieldSpec("review_progress", "not_support", writable=False, description="当前 CLI 不支持，写入跳过。"),
    "manufacture_year": FieldSpec("manufacture_year", "number", description="生产年份。"),
    "min_quantity": FieldSpec("min_quantity", "number", description="阶梯价格订购数量下限。"),
    "record_id": FieldSpec("record_id", "text", description="外部源记录 ID，不是飞书 record_id。"),
    "interior_color": FieldSpec("interior_color", "text", description="内饰颜色。"),
    "location": FieldSpec("location", "text", description="提车地、港口、仓库或基地。"),
    "steering_setup": FieldSpec("steering_setup", "select", options=("左舵", "右舵"), description="舵向。"),
    "market_region": FieldSpec("market_region", "select", options=("国内版", "国际版", "International Version"), description="市场/版本，可多选。"),
    "cost_exw_usd": FieldSpec("cost_exw_usd", "number", description="EXW 美元成本价。"),
    "manufacture_month": FieldSpec("manufacture_month", "number", description="生产月份，1-12。"),
    "display_price_low": FieldSpec("display_price_low", "number", description="展示价格低值，只有源表或人工规则明确时写入。"),
    "stock_quantity": FieldSpec("stock_quantity", "number", description="库存数量。"),
    "vehicle_supply_base": FieldSpec("vehicle_supply_base", "text", description="车源供应基地。"),
    "display_price_high": FieldSpec("display_price_high", "number", description="展示价格高值，只有源表或人工规则明确时写入。"),
}

WRITABLE_FIELDS = tuple(name for name, spec in FIELD_SPECS.items() if spec.writable)
NUMBER_FIELDS = tuple(name for name, spec in FIELD_SPECS.items() if spec.field_type == "number")
TEXT_FIELDS = tuple(name for name, spec in FIELD_SPECS.items() if spec.field_type == "text")
SELECT_FIELDS = tuple(name for name, spec in FIELD_SPECS.items() if spec.field_type == "select")
PRICE_FIELDS = ("supplier_price_cny", "cost_exw_usd", "cost_fca_usd", "cost_fob_usd", "display_price_low", "display_price_high")


def field_schema_for_codex() -> list[dict[str, Any]]:
    return [
        {
            "name": spec.name,
            "type": spec.field_type,
            "writable": spec.writable,
            "options": list(spec.options),
            "description": spec.description,
        }
        for spec in FIELD_SPECS.values()
    ]


def candidate_template() -> dict[str, Any]:
    return {
        "records": [
            {
                **{field: None for field in WRITABLE_FIELDS},
                "_evidence": {field: "source file / sheet / row / column evidence" for field in WRITABLE_FIELDS},
                "_source_file": "supplier.xlsx",
            }
        ],
        "rules": [
            "Only fill a field when the Excel evidence supports that exact field meaning.",
            "Do not put unrelated but format-compatible data into a field.",
            "Put leftover source facts in notes only when they do not belong to a more specific field.",
            "Do not write user fields or unsupported fields.",
        ],
    }


def parse_number(value: Any) -> int | float | None:
    if value in (None, ""):
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return int(value) if float(value).is_integer() else float(value)
    raw = str(value).strip()
    if not raw:
        return None
    if not re.fullmatch(r"[-+]?\d[\d,]*(?:\.\d+)?", raw):
        return None
    number = float(raw.replace(",", ""))
    return int(number) if number.is_integer() else number


def normalize_market_region(value: Any) -> list[str] | None:
    if value in (None, ""):
        return None
    values = value if isinstance(value, list) else [value]
    normalized: list[str] = []
    allowed = FIELD_SPECS["market_region"].options
    for item in values:
        text = str(item).strip()
        if not text:
            continue
        if text not in allowed:
            raise ValueError(f"market_region invalid option: {text}")
        if text not in normalized:
            normalized.append(text)
    return normalized or None


def evidence_for(candidate: dict[str, Any], field: str) -> str:
    evidence = candidate.get("_evidence") or candidate.get("evidence") or {}
    if isinstance(evidence, dict):
        return str(evidence.get(field) or "")
    return ""


def _has_currency(text: str, currency: str) -> bool:
    low = text.lower()
    if currency == "USD":
        return any(token in low for token in ("usd", "$", "美元", "美金"))
    return any(token in low for token in ("cny", "rmb", "¥", "人民币"))


def _has_trade_term(text: str, term: str) -> bool:
    return term.lower() in text.lower()


def validate_field_evidence(field: str, value: Any, evidence: str) -> list[str]:
    if value in (None, "", []):
        return []
    errors: list[str] = []
    if not evidence.strip():
        errors.append(f"{field}: missing evidence")
        return errors
    if field == "cost_exw_usd" and (not _has_trade_term(evidence, "EXW") or not _has_currency(evidence, "USD")):
        errors.append("cost_exw_usd requires EXW + USD evidence")
    if field == "cost_fca_usd" and (not _has_trade_term(evidence, "FCA") or not _has_currency(evidence, "USD")):
        errors.append("cost_fca_usd requires FCA + USD evidence")
    if field == "cost_fob_usd" and (not _has_trade_term(evidence, "FOB") or not _has_currency(evidence, "USD")):
        errors.append("cost_fob_usd requires FOB + USD evidence")
    if field == "supplier_price_cny" and not _has_currency(evidence, "CNY"):
        errors.append("supplier_price_cny requires CNY/RMB evidence")
    if field == "location" and re.search(r"\b(EXW|FCA|FOB|CIF)\b", str(value), re.I):
        errors.append("location must be a physical place without trade term prefix")
    return errors


def validate_candidate(candidate: dict[str, Any], *, require_evidence: bool = True) -> tuple[dict[str, Any] | None, list[str]]:
    errors: list[str] = []
    normalized: dict[str, Any] = {}
    unknown = sorted(key for key in candidate if not key.startswith("_") and key not in FIELD_SPECS)
    if unknown:
        errors.append(f"unknown fields: {', '.join(unknown)}")

    for field, spec in FIELD_SPECS.items():
        if not spec.writable:
            continue
        value = candidate.get(field)
        if value in (None, "", []):
            continue
        if spec.field_type == "number":
            number = parse_number(value)
            if number is None:
                errors.append(f"{field}: expected number")
                continue
            if field == "confidence" and not (0 <= float(number) <= 1):
                errors.append("confidence must be between 0 and 1")
            elif field == "manufacture_month" and int(number) not in range(1, 13):
                errors.append("manufacture_month must be 1-12")
            elif field == "manufacture_year" and not (2000 <= int(number) <= 2100):
                errors.append("manufacture_year must be a four digit year")
            else:
                normalized[field] = number
        elif spec.field_type == "select":
            try:
                if field == "market_region":
                    normalized_value = normalize_market_region(value)
                    if normalized_value:
                        normalized[field] = normalized_value
                else:
                    text = str(value).strip()
                    if text not in spec.options:
                        errors.append(f"{field}: invalid option {text}")
                    else:
                        normalized[field] = text
            except ValueError as exc:
                errors.append(str(exc))
        else:
            normalized[field] = str(value).strip()

    if "brand" not in normalized:
        errors.append("brand is required")
    if "model" not in normalized:
        errors.append("model is required")

    if require_evidence:
        for field, value in normalized.items():
            errors.extend(validate_field_evidence(field, value, evidence_for(candidate, field)))

    return (None, errors) if errors else (normalized, [])


def load_candidate_records(path: str | Path) -> list[dict[str, Any]]:
    data = json.loads(Path(path).read_text("utf-8"))
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and isinstance(data.get("records"), list):
        return data["records"]
    raise ValueError("candidate file must be a JSON list or an object with records[]")


def validate_candidate_records(records: list[dict[str, Any]], *, require_evidence: bool = True) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    valid: list[dict[str, Any]] = []
    invalid: list[dict[str, Any]] = []
    for index, record in enumerate(records, start=1):
        normalized, errors = validate_candidate(record, require_evidence=require_evidence)
        if normalized is None:
            invalid.append({"index": index, "errors": errors, "record": record})
        else:
            valid.append(normalized)
    return valid, invalid


def write_excel_evidence_bundle(source: str | Path, output_root: str | Path) -> Path:
    output_root = Path(output_root)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    bundle_dir = output_root / f"codex_evidence_{timestamp}"
    bundle_dir.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, Any] = {
        "created_at": datetime.now().isoformat(),
        "target": {
            "base_token": TARGET_BASE_TOKEN,
            "table_id": TARGET_TABLE_ID,
            "view_id": TARGET_VIEW_ID,
        },
        "fields": field_schema_for_codex(),
        "files": [],
    }
    for excel_file in iter_excel_files(source):
        rendered: ExcelText = render_excel_file(excel_file)
        safe_name = re.sub(r"[^A-Za-z0-9._-]+", "_", excel_file.stem).strip("_") or "workbook"
        evidence_path = bundle_dir / f"{safe_name}.txt"
        evidence_path.write_text(rendered.text, "utf-8")
        manifest["files"].append({
            "source": str(excel_file),
            "evidence_path": str(evidence_path),
            "sheet_count": rendered.sheet_count,
            "row_count": rendered.row_count,
        })
    (bundle_dir / "candidate_template.json").write_text(json.dumps(candidate_template(), ensure_ascii=False, indent=2), "utf-8")
    (bundle_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), "utf-8")
    return bundle_dir
