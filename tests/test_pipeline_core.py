from pathlib import Path

from mineru_pipeline.excel_parser import normalize_header_cell
from mineru_pipeline.parser import extract_path_metadata
from mineru_pipeline.pipeline import (
    clean_variant,
    clean_variant_and_extract_notes,
    derive_variant_from_context,
    format_candidates_for_feishu,
    get_db,
    record_to_feishu_fields,
)


def test_format_candidates_filters_invalid_rows_and_extracts_usd_costs():
    rows = [
        {"brand": None, "modelName": "Dolphin", "costExwUsd": 10000},
        {"brand": "BYD", "modelName": None, "costExwUsd": 10000},
        {"brand": "BYD", "modelName": "Dolphin", "costExwUsd": 12000},
        {"brand": "BYD", "modelName": "Dolphin", "costExwUsd": 15000},
    ]

    formatted = format_candidates_for_feishu(rows)

    assert len(formatted) == 2
    assert any(row.get("cost_exw_usd") == 12000 for row in formatted)
    assert any(row.get("cost_exw_usd") == 15000 for row in formatted)


def test_trade_term_prices_default_to_usd_without_usd_header():
    formatted = format_candidates_for_feishu([
        {
            "brand": "Geely",
            "modelName": "Galaxy A7",
            "priceFca": 14300,
            "priceFob": 14700,
            "FCA价格": 14300,
            "FOB价格": 14700,
            "location": "FCA南沙",
        }
    ])

    assert len(formatted) == 1
    assert formatted[0]["cost_fca_usd"] == 14300
    assert formatted[0]["cost_fob_usd"] == 14700
    assert formatted[0]["supplier_price_cny"] is None
    assert formatted[0]["location"] == "南沙"


def test_explicit_rmb_trade_prices_are_not_fx_converted_to_usd():
    formatted = format_candidates_for_feishu([
        {
            "brand": "Bestune",
            "modelName": "小马",
            "priceExw": 31764,
            "priceFob": 32546,
            "EXW人民币": 31764,
            "FOB RMB": 32546,
        }
    ])

    assert len(formatted) == 1
    assert formatted[0]["cost_exw_usd"] == 4741
    assert formatted[0]["cost_fob_usd"] == 4858
    assert formatted[0]["supplier_price_cny"] == 31764
    assert "EXW人民币: 31764" in formatted[0]["notes"]
    assert "FOB人民币: 32546" in formatted[0]["notes"]


def test_record_to_feishu_fields_never_writes_display_prices():
    fields = record_to_feishu_fields({
        "brand": "BYD",
        "model": "Dolphin",
        "supplier_price_cny": 99800,
        "display_price_low": 1000,
        "display_price_high": 2000,
    })

    assert fields.get("人民币指导价") == 99800 or fields.get("supplier_price_cny") == 99800
    assert "display_price_low" not in fields
    assert "display_price_high" not in fields


def test_variant_strips_model_prefix_prices_and_battery_details():
    variant, notes = clean_variant_and_extract_notes(
        "Qiyuan A07 730旗舰型 | 220000 | 宁德83kWh",
        "Changan",
        "Qiyuan A07",
    )

    assert variant == "730旗舰型"
    assert "220000" in notes
    assert "宁德83kWh" in notes


def test_variant_keeps_real_named_van_edition_but_rejects_axis_only_specs():
    assert clean_variant("中轴高顶-行动派 | 220000 | 宁德83kWh", "Farizon", "Xingxiang V") == "中轴高顶-行动派"
    assert clean_variant("短轴低顶-行镖版", "Farizon", "Xingxiang V") == "短轴低顶-行镖版"
    assert clean_variant("中轴低顶", "Farizon", "Xingxiang V") is None
    assert clean_variant("明窗盲窗", "Farizon", "Xingxiang V") is None


def test_variant_rejects_pure_range_battery_price_and_trade_terms():
    assert clean_variant("430km", "BYD", "Yuan PLUS") is None
    assert clean_variant("49.92kWh", "BYD", "Yuan PLUS") is None
    assert clean_variant("FOB 14700", "Geely", "Galaxy A7") is None
    assert clean_variant("220000", "Wuling", "Rongguang") is None
    assert clean_variant("LV2", "Wuling", "Hongguang") is None
    assert clean_variant("LV0 LV1", "Wuling", "Hongguang") is None


def test_variant_keeps_sales_edition_without_repeating_model():
    assert clean_variant("Qiyuan A07 730旗舰型", "Changan", "Qiyuan A07") == "730旗舰型"
    assert clean_variant("560ULTRA Laser", "Avatr", "07") == "560ULTRA Laser"
    assert clean_variant("49.92kwh 第二代元PLUS智驾版 433KM领先型 Second Generation Yuan PLUS Smart Drive Edition 430km Leading Edition", "BYD", "Yuan PLUS") is not None


def test_variant_keeps_lv_equipment_level_in_notes_not_variant():
    variant, notes = clean_variant_and_extract_notes(
        "LV2（6座、空调H、EPS、ESC、前后碟刹、铝合金轮）",
        "Wuling",
        "Hongguang",
    )

    assert variant is None
    assert "LV2" in notes
    assert "EPS" in notes


def test_variant_strips_lv_suffix_from_real_version_text():
    assert "N510M REEV Chinese Version" in clean_variant("N510M REEV Chinese Version LV0", "Wuling", "Hongguang EV")


def test_variant_derives_from_compact_model_text_and_filename():
    assert clean_variant("T032025款310舒享版", "Leapmotor", "T03") == "2025款310舒享版"

    byd_variant = derive_variant_from_context(
        {"_source_file": "海狮05EV 520智驾版-国际版出口车型.xlsx"},
        "BYD",
        "Sealion 7",
    )
    assert byd_variant == "520智驾版"

    ti3_variant = derive_variant_from_context(
        {"_source_file": "钛3 2025款501KM 智驾Ultra版-国际版出口车型.xlsx"},
        "Fangchengbao",
        "Ti 3",
    )
    assert ti3_variant == "2025款501KM 智驾Ultra版"


def test_variant_does_not_derive_from_wuling_model_codes():
    assert derive_variant_from_context({"_source_file": "AS45.xlsx"}, "Wuling", "Hongguang S3") is None
    assert derive_variant_from_context({"_source_file": "261G.xlsx"}, "Wuling", "Bingo S") is None
    assert derive_variant_from_context({"_source_file": "AGMC.xlsx"}, "Wuling", "Rongguang") is None
    assert derive_variant_from_context({"_source_file": "0R03.xlsx"}, "Wuling", "Starlight 730") is None


def test_variant_rejects_known_model_family_names():
    assert clean_variant("Cowboy", "Geely", "Galaxy L6") is None
    assert clean_variant("海狮05EV", "BYD", "Seal") is None
    assert clean_variant("Hongguang", "Wuling", "Hongguang") is None
    assert clean_variant("Qin Plus", "BYD", "Qin PLUS EV") is None
    assert clean_variant("Galaxy Xingyao 6", "Geely", "Galaxy L6") is None
    assert clean_variant("Sealion 05 EV", "BYD", "Seal") is None


def test_format_candidates_resolves_model_id_and_manufacture_year_month():
    formatted = format_candidates_for_feishu([
        {"brand": "BYD", "modelName": "Dolphin", "manufactureDate": "2026-07-03"},
        {"brand": "比亚迪", "modelName": "海鸥", "time": "2026.07.05"},
    ])

    dolphin = next(row for row in formatted if row["model"] == "Dolphin")
    seagull = next(row for row in formatted if row["model"] == "Seagull")
    assert dolphin["model_id"].startswith("MDL-")
    assert dolphin["manufacture_year"] == 2026
    assert dolphin["manufacture_month"] == 7
    assert seagull["model_id"].startswith("MDL-")
    assert seagull["manufacture_year"] == 2026
    assert seagull["manufacture_month"] == 7


def test_record_to_feishu_fields_includes_manufacture_year_month():
    fields = record_to_feishu_fields({
        "brand": "BYD",
        "model": "Dolphin",
        "manufacture_year": 2026,
        "manufacture_month": 7,
    })

    assert fields.get("生产年份") == 2026 or fields.get("manufacture_year") == 2026
    assert fields.get("生产月份") == 7 or fields.get("manufacture_month") == 7


def test_excel_header_aliases_include_manufacture_year_month():
    assert normalize_header_cell("manufacture_year") == "manufactureYear"
    assert normalize_header_cell("manufacture_month") == "manufactureMonth"
    assert normalize_header_cell("生产年份") == "manufactureYear"
    assert normalize_header_cell("生产月份") == "manufactureMonth"





def test_path_metadata_uses_input_catalog_context():
    path = Path("project/input/APT/南沙/Leapmotor/T03/T032025款310舒享版.xlsx")

    assert extract_path_metadata(path) == {
        "supplier": "APT",
        "location": "南沙",
        "brand": "Leapmotor",
        "model": "T03",
    }


def test_sqlite_schema_has_manufacture_year_month(tmp_path: Path):
    db = get_db(tmp_path / "local_source.db")
    try:
        columns = [row["name"] for row in db.execute("PRAGMA table_info(source_candidates)").fetchall()]
    finally:
        db.close()

    assert "manufacture_year" in columns
    assert "manufacture_month" in columns


def test_normalize_brand_model_handles_model_in_brand_column():
    from mineru_pipeline.pipeline import normalize_brand_model
    b1, m1 = normalize_brand_model("2025款\nA7", "2025款150探索+")
    assert b1 == "Geely"
    assert m1 == "Galaxy A7"

    b2, m2 = normalize_brand_model("吉利牛仔", "2026款观野版")
    assert b2 == "Geely"
    assert m2 == "Cowboy"
def test_normalize_location_cn_canonicalization():
    from mineru_pipeline.pipeline import normalize_location_cn
    assert normalize_location_cn("广州南沙基地") == "南沙"
    assert normalize_location_cn("南沙是") == "南沙"
    assert normalize_location_cn("FCA南沙港") == "南沙"
    assert normalize_location_cn("霍尔果斯综合保税区") == "霍尔果斯"
    assert normalize_location_cn("小马奔腾") is None
