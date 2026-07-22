from pathlib import Path

from mineru_pipeline.excel_parser import normalize_header_cell
from mineru_pipeline.pipeline import (
    format_candidates_for_feishu,
    get_db,
    record_to_feishu_fields,
)


def test_format_candidates_filters_invalid_rows_and_separates_cny_from_usd():
    rows = [
        {"brand": None, "modelName": "Dolphin", "priceExw": 10000},
        {"brand": "BYD", "modelName": None, "priceExw": 10000},
        {"brand": "BYD", "modelName": "Dolphin", "priceExw": 70000, "priceExwCurrency": "CNY"},
        {"brand": "BYD", "modelName": "Dolphin", "priceExw": 12000, "priceExwCurrency": "USD"},
        {"brand": "BYD", "modelName": "Dolphin", "priceExw": 35000},
        {"brand": "BYD", "modelName": "Dolphin", "priceExw": 15000},
    ]

    formatted = format_candidates_for_feishu(rows)

    assert len(formatted) == 4
    assert not any(row.get("cost_exw_usd") == 70000 for row in formatted)
    assert any(row.get("cost_exw_cny") == 70000 for row in formatted)
    assert not any(row.get("cost_exw_usd") == 35000 for row in formatted)
    assert any(row.get("cost_exw_cny") == 35000 for row in formatted)
    assert any(row.get("cost_exw_usd") == 12000 for row in formatted)
    assert any(row.get("cost_exw_usd") == 15000 for row in formatted)


def test_format_candidates_resolves_model_id_and_manufacture_date():
    formatted = format_candidates_for_feishu([
        {"brand": "BYD", "modelName": "Dolphin", "manufactureDate": "2026-07-03"},
        {"brand": "比亚迪", "modelName": "海鸥", "time": "2026.07.05"},
    ])

    dolphin = next(row for row in formatted if row["model"] == "Dolphin")
    seagull = next(row for row in formatted if row["model"] == "Seagull")
    assert dolphin["model_id"].startswith("MDL-")
    assert dolphin["manufacture_date"] == "2026-07-03"
    assert seagull["model_id"].startswith("MDL-")
    assert seagull["manufacture_date"] == "2026-07-05"


def test_record_to_feishu_fields_uses_manufacture_date_not_time():
    fields = record_to_feishu_fields({
        "brand": "BYD",
        "model": "Dolphin",
        "manufacture_date": "2026-07-03",
    })

    assert fields["manufacture_date"] == "2026-07-03"
    assert "time" not in fields


def test_excel_header_aliases_include_manufacture_date():
    assert normalize_header_cell("manufacture_date") == "manufactureDate"
    assert normalize_header_cell("time") == "manufactureDate"
    assert normalize_header_cell("生产日期") == "manufactureDate"


def test_sqlite_schema_has_manufacture_date(tmp_path: Path):
    db = get_db(tmp_path / "local_source.db")
    try:
        columns = [row["name"] for row in db.execute("PRAGMA table_info(source_candidates)").fetchall()]
    finally:
        db.close()

    assert "manufacture_date" in columns
