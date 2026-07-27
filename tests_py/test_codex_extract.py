from pathlib import Path
import json

from openpyxl import Workbook

from mineru_pipeline.codex_extract import (
    FIELD_SPECS,
    TARGET_TABLE_ID,
    validate_candidate,
    validate_candidate_records,
    write_excel_evidence_bundle,
)


def valid_candidate() -> dict:
    return {
        "brand": "BYD",
        "model": "Sealion 7",
        "trim_config": "520旗智航版",
        "cost_fca_usd": 9250,
        "supplier_price_cny": 137800,
        "location": "霍尔果斯基地",
        "steering_setup": "左舵",
        "market_region": ["国际版"],
        "manufacture_year": 2026,
        "manufacture_month": 7,
        "confidence": 0.9,
        "_evidence": {
            "brand": "row 2 B=BYD Sealion 7",
            "model": "row 2 B=BYD Sealion 7",
            "trim_config": "row 2 B=520旗智航版",
            "cost_fca_usd": "row 1 E=FCA提货价 usd; row 2 E=9250",
            "supplier_price_cny": "row 1 C=人民币报价; row 2 C=137800 CNY",
            "location": "merged A2:A10=霍尔果斯基地",
            "steering_setup": "row 2 B=左舵",
            "market_region": "row 2 B=国际版",
            "manufacture_year": "row 2 D=2026年7月",
            "manufacture_month": "row 2 D=2026年7月",
            "confidence": "Codex confidence",
        },
    }


def test_target_schema_uses_requested_table_and_skips_user_fields():
    assert TARGET_TABLE_ID == "tblyd52cT70XrFf1"
    assert FIELD_SPECS["review_progress"].writable is False
    assert FIELD_SPECS["developer"].field_type == "user"
    assert FIELD_SPECS["ai_importer"].writable is False


def test_validate_candidate_accepts_strict_evidence():
    normalized, errors = validate_candidate(valid_candidate())

    assert errors == []
    assert normalized["cost_fca_usd"] == 9250
    assert normalized["market_region"] == ["国际版"]


def test_validate_candidate_rejects_price_without_matching_trade_term_and_currency():
    candidate = valid_candidate()
    candidate["_evidence"]["cost_fca_usd"] = "row 2 E=9250"

    normalized, errors = validate_candidate(candidate)

    assert normalized is None
    assert "cost_fca_usd requires FCA + USD evidence" in errors


def test_validate_candidate_rejects_unknown_field_and_invalid_select():
    candidate = valid_candidate()
    candidate["random_price"] = 1
    candidate["steering_setup"] = "中舵"
    candidate["_evidence"]["steering_setup"] = "row 2 B=中舵"

    normalized, errors = validate_candidate(candidate)

    assert normalized is None
    assert any("unknown fields" in error for error in errors)
    assert "steering_setup: invalid option 中舵" in errors


def test_validate_candidate_records_returns_invalid_report_shape():
    valid, invalid = validate_candidate_records([valid_candidate(), {"brand": "BYD"}])

    assert len(valid) == 1
    assert invalid[0]["index"] == 2
    assert "model is required" in invalid[0]["errors"]


def test_write_excel_evidence_bundle_writes_manifest_and_template(tmp_path: Path):
    source = tmp_path / "supplier.xlsx"
    workbook = Workbook()
    sheet = workbook.active
    sheet["A1"] = "车型"
    sheet["B1"] = "FCA提货价 usd"
    sheet["A2"] = "Sealion 7"
    sheet["B2"] = 9250
    workbook.save(source)

    bundle = write_excel_evidence_bundle(source, tmp_path / "out")

    manifest = json.loads((bundle / "manifest.json").read_text("utf-8"))
    template = json.loads((bundle / "candidate_template.json").read_text("utf-8"))
    assert manifest["target"]["table_id"] == "tblyd52cT70XrFf1"
    assert manifest["files"][0]["row_count"] == 2
    assert template["records"][0]["_evidence"]["model"]
