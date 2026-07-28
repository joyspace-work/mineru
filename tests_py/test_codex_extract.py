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
        "variant": "520旗智航版",
        "cost_fca_usd": 9250,
        "supplier_price_cny": 137800,
        "vehicle_supply_base": "霍尔果斯基地",
        "location": "南沙",
        "steering_setup": "左舵",
        "market_region": ["国际版"],
        "manufacture_year": 2026,
        "manufacture_month": 7,
        "confidence": 0.9,
        "_evidence": {
            "brand": "row 2 B=BYD Sealion 7",
            "model": "row 2 B=BYD Sealion 7",
            "variant": "row 2 B=520旗智航版",
            "cost_fca_usd": "row 1 E=FCA提货价 usd; row 2 E=9250",
            "supplier_price_cny": "row 1 C=人民币报价; row 2 C=137800 CNY",
            "vehicle_supply_base": "merged A2:A10=霍尔果斯基地",
            "location": "row 1 E=FCA南沙; row 2 E=9250",
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
    assert normalized["variant"] == "520旗智航版"


def test_validate_candidate_accepts_legacy_trim_config_alias():
    candidate = valid_candidate()
    candidate["trim_config"] = candidate.pop("variant")
    candidate["_evidence"]["trim_config"] = candidate["_evidence"].pop("variant")

    normalized, errors = validate_candidate(candidate)

    assert errors == []
    assert normalized["variant"] == "520旗智航版"


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


def test_validate_candidate_rejects_model_with_location_and_color_stock():
    candidate = valid_candidate()
    candidate["model"] = "霍尔果斯-海狮05EV-3暖阳白/黑"
    candidate["_evidence"]["model"] = "row 2 B=霍尔果斯-海狮05EV-3暖阳白/黑"

    normalized, errors = validate_candidate(candidate)

    assert normalized is None
    assert "model must not contain location text" in errors
    assert "model must not contain color/stock text" in errors


def test_validate_candidate_rejects_horgos_row_written_as_nansha():
    candidate = valid_candidate()
    candidate["location"] = "南沙"
    candidate["_evidence"]["location"] = "merged A2:A10=霍尔果斯基地"

    normalized, errors = validate_candidate(candidate)

    assert normalized is None
    assert "location scope mismatch: Horgos evidence cannot be written as Nansha" in errors


def test_validate_candidate_rejects_color_stock_mismatch_for_maika_horgos_case():
    candidate = valid_candidate()
    candidate.update({
        "model": "海狮05EV",
        "stock_quantity": 13,
        "exterior_color": "海域白",
        "interior_color": "黑",
        "location": "霍尔果斯基地",
    })
    candidate["_evidence"].update({
        "model": "row 2 B=海狮05EV",
        "stock_quantity": "row 2 D=13海域白/灰",
        "exterior_color": "row 2 D=13海域白/灰",
        "interior_color": "row 2 D=13海域白/灰",
        "location": "merged A2:A10=霍尔果斯基地",
    })

    normalized, errors = validate_candidate(candidate)

    assert normalized is None
    assert "interior_color mismatch: evidence implies 灰" in errors


def test_validate_candidate_rejects_incomplete_model_when_evidence_contains_specific_model():
    candidate = valid_candidate()
    candidate["model"] = "海狮07"
    candidate["_evidence"]["model"] = "row 2 B=霍尔果斯-海狮05EV-3暖阳白/黑"

    normalized, errors = validate_candidate(candidate)

    assert normalized is None
    assert any("model appears incomplete" in error for error in errors)


def test_validate_candidate_rejects_model_with_variant_text():
    candidate = valid_candidate()
    candidate["brand"] = "Geely"
    candidate["model"] = "Galaxy M9 210km AWD Black Gold Smart Shine Edition"
    candidate["_evidence"]["brand"] = "row 2 B=Geely"
    candidate["_evidence"]["model"] = "row 2 B=Galaxy M9 210km AWD Black Gold Smart Shine Edition"

    normalized, errors = validate_candidate(candidate)

    assert normalized is None
    assert "model must not contain variant/version text" in errors


def test_validate_candidate_rejects_subtotal_variant():
    candidate = valid_candidate()
    candidate["variant"] = "小计"
    candidate["_evidence"]["variant"] = "row 12 A=小计"

    normalized, errors = validate_candidate(candidate)

    assert normalized is None
    assert "variant must not be subtotal/total text" in errors


def test_validate_candidate_rejects_variant_with_duplicate_model_prefix():
    candidate = valid_candidate()
    candidate["brand"] = "Changan"
    candidate["model"] = "Qiyuan A07"
    candidate["variant"] = "Qiyuan A07 730旗舰型"
    candidate["_evidence"]["brand"] = "row 2 A=长安"
    candidate["_evidence"]["model"] = "row 2 B=Qiyuan A07 730旗舰型"
    candidate["_evidence"]["variant"] = "row 2 B=Qiyuan A07 730旗舰型"

    normalized, errors = validate_candidate(candidate)

    assert normalized is None
    assert any("variant contains non-variant roles" in error for error in errors)


def test_validate_candidate_rejects_variant_with_long_spec_blob_or_announcement_code():
    candidate = valid_candidate()
    candidate["brand"] = "Wuling"
    candidate["model"] = "五菱荣光新卡"
    candidate["variant"] = "LZW5028XXYEQU 国六B | AJBL | LV0 （2座，货柜车-单蒸空调-晴空银-单层货柜）"
    candidate["_evidence"]["brand"] = "row 2 A=五菱"
    candidate["_evidence"]["model"] = "row 2 B=五菱荣光新卡"
    candidate["_evidence"]["variant"] = "row 2 C=LZW5028XXYEQU 国六B | AJBL | LV0 （2座，货柜车-单蒸空调-晴空银-单层货柜）"

    normalized, errors = validate_candidate(candidate)

    assert normalized is None
    assert any("variant contains non-variant roles" in error for error in errors)


def test_validate_candidate_rejects_fob_lower_than_exw():
    candidate = valid_candidate()
    candidate["cost_exw_usd"] = 10000
    candidate["cost_fob_usd"] = 9500
    candidate["_evidence"]["cost_exw_usd"] = "row 1 C=EXW USD; row 2 C=10000"
    candidate["_evidence"]["cost_fob_usd"] = "row 1 D=FOB USD; row 2 D=9500"

    normalized, errors = validate_candidate(candidate)

    assert normalized is None
    assert "cost_fob_usd must not be lower than cost_exw_usd on the same source row" in errors


def test_validate_candidate_keeps_supplier_base_separate_from_location():
    candidate = valid_candidate()
    candidate.update({
        "supplier": "温州迈卡新能源",
        "vehicle_supply_base": "霍尔果斯基地",
        "location": "南沙",
    })
    candidate["_evidence"].update({
        "supplier": "# Path parts: 1=温州迈卡新能源 | 2=霍尔果斯基地 | 3=报价.xlsx",
        "vehicle_supply_base": "# Path parts: 1=温州迈卡新能源 | 2=霍尔果斯基地 | 3=报价.xlsx",
        "location": "row 1 E=FCA南沙; row 2 E=9250",
    })

    normalized, errors = validate_candidate(candidate)

    assert errors == []
    assert normalized["supplier"] == "温州迈卡新能源"
    assert normalized["vehicle_supply_base"] == "霍尔果斯基地"
    assert normalized["location"] == "南沙"


def test_validate_candidate_rejects_base_in_location_and_port_in_base():
    candidate = valid_candidate()
    candidate.update({
        "location": "霍尔果斯基地",
        "vehicle_supply_base": "南沙",
    })
    candidate["_evidence"].update({
        "location": "merged A2:A10=霍尔果斯基地",
        "vehicle_supply_base": "row 1 E=FCA南沙",
    })

    normalized, errors = validate_candidate(candidate)

    assert normalized is None
    assert "location must not contain vehicle supply base text" in errors
    assert "vehicle_supply_base must not contain shipping place or port text" in errors


def test_validate_candidate_records_returns_invalid_report_shape():
    valid, invalid = validate_candidate_records([valid_candidate(), {"brand": "BYD"}])

    assert len(valid) == 1
    assert invalid[0]["index"] == 2
    assert "model is required" in invalid[0]["errors"]


def test_write_excel_evidence_bundle_writes_manifest_and_template(tmp_path: Path):
    root = tmp_path / "温州迈卡新能源" / "霍尔果斯基地"
    root.mkdir(parents=True)
    source = root / "supplier.xlsx"
    workbook = Workbook()
    sheet = workbook.active
    sheet["A1"] = "车型"
    sheet["B1"] = "FCA提货价 usd"
    sheet["A2"] = "Sealion 7"
    sheet["B2"] = 9250
    workbook.save(source)

    bundle = write_excel_evidence_bundle(tmp_path, tmp_path / "out")

    manifest = json.loads((bundle / "manifest.json").read_text("utf-8"))
    template = json.loads((bundle / "candidate_template.json").read_text("utf-8"))
    assert manifest["target"]["table_id"] == "tblyd52cT70XrFf1"
    assert manifest["files"][0]["row_count"] == 2
    assert manifest["files"][0]["path_parts"] == ["温州迈卡新能源", "霍尔果斯基地", "supplier.xlsx"]
    assert template["records"][0]["_evidence"]["model"]
    assert any("Wenzhou Maika example" in rule for rule in template["rules"])
    assert any("Supplier, vehicle_supply_base, and location may appear" in rule for rule in template["rules"])
