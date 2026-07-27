from pathlib import Path

from mineru_pipeline.excel_parser import normalize_header_cell
from mineru_pipeline.pipeline import (
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

    assert fields["manufacture_year"] == 2026
    assert fields["manufacture_month"] == 7


def test_excel_header_aliases_include_manufacture_year_month():
    assert normalize_header_cell("manufacture_year") == "manufactureYear"
    assert normalize_header_cell("manufacture_month") == "manufactureMonth"
    assert normalize_header_cell("生产年份") == "manufactureYear"
    assert normalize_header_cell("生产月份") == "manufactureMonth"





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
