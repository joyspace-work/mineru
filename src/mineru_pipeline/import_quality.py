from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
import json
import re
from pathlib import Path
from typing import Any, Iterable

from .field_semantics import clean_variant_text, lint_candidate_semantics


PLACE_FIELDS = ("location", "vehicle_supply_base")
QUALITY_SKIP_FIELDS = {"display_price_low", "display_price_high"}
BUSINESS_KEY_FIELDS = (
    "brand",
    "supplier",
    "model",
    "variant",
    "supplier_price_cny",
    "cost_exw_usd",
    "cost_fca_usd",
    "cost_fob_usd",
    "exterior_color",
    "interior_color",
    "stock_quantity",
    "location",
    "vehicle_supply_base",
)


@dataclass(frozen=True)
class VariantAudit:
    record_id: str | None
    brand: str | None
    model: str | None
    raw_variant: str | None
    cleaned_variant: str | None
    source_file: str | None
    reason: str


def load_records(path: str | Path) -> list[dict[str, Any]]:
    data = json.loads(Path(path).read_text("utf-8"))
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and isinstance(data.get("records"), list):
        return data["records"]
    raise ValueError("candidate file must be a JSON list or an object with records[]")


def load_summary(path: str | Path | None) -> dict[str, Any]:
    if not path:
        return {}
    summary_path = Path(path)
    if not summary_path.exists():
        return {}
    data = json.loads(summary_path.read_text("utf-8"))
    return data if isinstance(data, dict) else {}


def value_present(value: Any) -> bool:
    return value not in (None, "", [])


def field_coverage(records: Iterable[dict[str, Any]]) -> dict[str, int]:
    rows = list(records)
    fields = sorted({key for row in rows for key in row if not key.startswith("_") and key not in QUALITY_SKIP_FIELDS})
    return {field: sum(1 for row in rows if value_present(row.get(field))) for field in fields}


def zero_row_sources(summary: dict[str, Any]) -> list[dict[str, Any]]:
    per_file = summary.get("per_file") or []
    return [item for item in per_file if isinstance(item, dict) and item.get("rows") == 0]


def supplier_of_source(path: str) -> str:
    return path.split("\\", 1)[0].split("/", 1)[0]


def place_coverage_by_supplier(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        grouped[str(record.get("supplier") or "")].append(record)
    result = []
    for supplier, rows in sorted(grouped.items(), key=lambda item: (-len(item[1]), item[0])):
        result.append(
            {
                "supplier": supplier,
                "records": len(rows),
                "missing_location_and_base": sum(1 for row in rows if not any(value_present(row.get(field)) for field in PLACE_FIELDS)),
                "location_values": dict(Counter(str(row.get("location")) for row in rows if value_present(row.get("location")))),
                "vehicle_supply_base_values": dict(Counter(str(row.get("vehicle_supply_base")) for row in rows if value_present(row.get("vehicle_supply_base")))),
            }
        )
    return result


def duplicate_groups(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups: dict[tuple[str, ...], list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        key = tuple(str(record.get(field) or "") for field in BUSINESS_KEY_FIELDS)
        groups[key].append(record)
    duplicates = []
    for key, rows in groups.items():
        if len(rows) <= 1:
            continue
        duplicates.append(
            {
                "count": len(rows),
                "key": {field: value or None for field, value in zip(BUSINESS_KEY_FIELDS, key)},
                "record_ids": [row.get("record_id") for row in rows],
                "source_files": sorted({str(row.get("_source_file") or "") for row in rows if row.get("_source_file")}),
            }
        )
    return sorted(duplicates, key=lambda item: (-item["count"], json.dumps(item["key"], ensure_ascii=False)))


def variant_audit_records(records: list[dict[str, Any]], raw_records: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    raw_by_id = {row.get("content_hash"): row for row in raw_records or []}
    audits: list[VariantAudit] = []
    for record in records:
        raw = raw_by_id.get(record.get("record_id"))
        raw_variant = None
        if raw:
            raw_variant = raw.get("variant") or raw.get("trim_config")
        raw_variant = str(raw_variant) if raw_variant not in (None, "") else None
        cleaned = record.get("variant")
        recomputed = clean_variant_text(raw_variant, brand=record.get("brand"), model=record.get("model")) if raw_variant else cleaned
        issues = lint_candidate_semantics(record)
        reason = ""
        if raw_variant and not cleaned:
            reason = "cleaned_to_empty"
        elif raw_variant and cleaned and str(raw_variant) != str(cleaned):
            reason = "changed"
        elif any(issue.code == "weak_variant" for issue in issues):
            reason = "weak_variant"
        if reason:
            audits.append(
                VariantAudit(
                    record_id=record.get("record_id"),
                    brand=record.get("brand"),
                    model=record.get("model"),
                    raw_variant=raw_variant,
                    cleaned_variant=str(recomputed) if recomputed not in (None, "") else None,
                    source_file=record.get("_source_file"),
                    reason=reason,
                )
            )
    return [asdict(item) for item in audits]


def color_stock_issues(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    issues = []
    for record in records:
        has_color = any(value_present(record.get(field)) for field in ("exterior_color", "interior_color"))
        has_stock = value_present(record.get("stock_quantity"))
        evidence_text = " ".join(str((record.get("_evidence") or {}).get(field) or "") for field in ("exterior_color", "interior_color", "stock_quantity"))
        inventory_combo = bool(re.search(r"\d+\s*[^/+\s]+/[^/+\s]+", evidence_text))
        if has_stock and not has_color:
            code = "stock_without_color"
        elif has_color and not has_stock and inventory_combo:
            code = "inventory_color_without_stock"
        else:
            continue
        issues.append(
            {
                "code": code,
                "record_id": record.get("record_id"),
                "supplier": record.get("supplier"),
                "brand": record.get("brand"),
                "model": record.get("model"),
                "variant": record.get("variant"),
                "exterior_color": record.get("exterior_color"),
                "interior_color": record.get("interior_color"),
                "stock_quantity": record.get("stock_quantity"),
                "source_file": record.get("_source_file"),
            }
        )
    return issues


def notes_overload(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result = []
    for record in records:
        notes = str(record.get("notes") or "")
        if len(notes) < 160 and not re.search(r"\b(?:source|cost_[a-z_]+|official_suggested_price_cny)=", notes):
            continue
        result.append(
            {
                "record_id": record.get("record_id"),
                "supplier": record.get("supplier"),
                "brand": record.get("brand"),
                "model": record.get("model"),
                "variant": record.get("variant"),
                "length": len(notes),
                "has_internal_evidence": bool(re.search(r"\b(?:source|cost_[a-z_]+|official_suggested_price_cny)=", notes)),
                "preview": notes[:240],
            }
        )
    return sorted(result, key=lambda item: (-item["length"], str(item["record_id"] or "")))


def build_quality_report(
    records: list[dict[str, Any]],
    *,
    summary: dict[str, Any] | None = None,
    raw_records: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    summary = summary or {}
    zero_sources = zero_row_sources(summary)
    duplicates = duplicate_groups(records)
    variant_audits = variant_audit_records(records, raw_records)
    color_issues = color_stock_issues(records)
    note_issues = notes_overload(records)
    return {
        "record_count": len(records),
        "source_file_count": summary.get("source_file_count"),
        "candidate_count": summary.get("candidate_count"),
        "field_coverage": field_coverage(records),
        "zero_row_sources": {
            "count": len(zero_sources),
            "by_supplier": dict(Counter(supplier_of_source(str(item.get("file") or "")) for item in zero_sources)),
            "items": zero_sources,
        },
        "place_coverage_by_supplier": place_coverage_by_supplier(records),
        "missing_counts": {
            "location_and_base": sum(1 for row in records if not any(value_present(row.get(field)) for field in PLACE_FIELDS)),
            "variant": sum(1 for row in records if not value_present(row.get("variant"))),
            "exterior_and_interior_color": sum(1 for row in records if not value_present(row.get("exterior_color")) and not value_present(row.get("interior_color"))),
            "stock_quantity": sum(1 for row in records if not value_present(row.get("stock_quantity"))),
        },
        "duplicate_business_keys": {
            "group_count": len(duplicates),
            "record_count": sum(item["count"] for item in duplicates),
            "groups": duplicates,
        },
        "variant_audit": {
            "count": len(variant_audits),
            "by_reason": dict(Counter(item["reason"] for item in variant_audits)),
            "items": variant_audits,
        },
        "color_stock_issues": {
            "count": len(color_issues),
            "by_code": dict(Counter(item["code"] for item in color_issues)),
            "items": color_issues,
        },
        "notes_overload": {
            "count": len(note_issues),
            "items": note_issues,
        },
    }


def write_report_files(report: dict[str, Any], output_prefix: str | Path) -> dict[str, str]:
    prefix = Path(output_prefix)
    prefix.parent.mkdir(parents=True, exist_ok=True)
    paths = {
        "quality_report_json": str(prefix.with_name(prefix.name + "_quality_report.json")),
        "quality_report_md": str(prefix.with_name(prefix.name + "_quality_report.md")),
        "zero_row_sources": str(prefix.with_name(prefix.name + "_zero_row_sources.json")),
        "duplicate_candidates": str(prefix.with_name(prefix.name + "_duplicate_candidates.json")),
        "variant_audit": str(prefix.with_name(prefix.name + "_variant_audit.json")),
    }
    Path(paths["quality_report_json"]).write_text(json.dumps(report, ensure_ascii=False, indent=2), "utf-8")
    Path(paths["zero_row_sources"]).write_text(json.dumps(report["zero_row_sources"]["items"], ensure_ascii=False, indent=2), "utf-8")
    Path(paths["duplicate_candidates"]).write_text(json.dumps(report["duplicate_business_keys"]["groups"], ensure_ascii=False, indent=2), "utf-8")
    Path(paths["variant_audit"]).write_text(json.dumps(report["variant_audit"]["items"], ensure_ascii=False, indent=2), "utf-8")
    Path(paths["quality_report_md"]).write_text(render_markdown_report(report), "utf-8")
    return paths


def render_markdown_report(report: dict[str, Any]) -> str:
    lines = [
        "# Import Quality Report",
        "",
        f"- Records: {report['record_count']}",
        f"- Source files: {report.get('source_file_count')}",
        f"- Zero-row source files: {report['zero_row_sources']['count']}",
        f"- Duplicate business-key groups: {report['duplicate_business_keys']['group_count']} ({report['duplicate_business_keys']['record_count']} rows)",
        f"- Variant audit items: {report['variant_audit']['count']}",
        f"- Color/stock issues: {report['color_stock_issues']['count']}",
        f"- Notes overload: {report['notes_overload']['count']}",
        "",
        "## Missing Counts",
    ]
    for key, value in report["missing_counts"].items():
        lines.append(f"- {key}: {value}")
    lines.extend(["", "## Zero-Row Sources By Supplier"])
    for supplier, count in sorted(report["zero_row_sources"]["by_supplier"].items(), key=lambda item: (-item[1], item[0])):
        lines.append(f"- {supplier}: {count}")
    lines.extend(["", "## Place Coverage By Supplier"])
    for item in report["place_coverage_by_supplier"][:30]:
        lines.append(f"- {item['supplier']}: records={item['records']}, missing_location_and_base={item['missing_location_and_base']}")
    return "\n".join(lines) + "\n"
