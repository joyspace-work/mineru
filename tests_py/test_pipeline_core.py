from pathlib import Path

from mineru_pipeline.pipeline import (
    adapt_fields_to_feishu_table,
    format_candidates_for_feishu,
    get_db,
    record_to_feishu_fields,
    run_extraction,
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


def test_format_candidates_accepts_base_aligned_snake_case_fields():
    formatted = format_candidates_for_feishu([
        {
            "brand": "BYD",
            "model": "Shark",
            "trim_config": "BYD SHARK 6 PREMIUM 左舵国标",
            "manufacture_date": "2026年6月",
            "exterior_color": "黑",
            "interior_color": None,
            "stock_quantity": 25,
            "official_suggested_price_cny": None,
            "cost_fca_usd": 33650,
            "location": "广州南沙基地",
            "supplier": "温州迈卡新能源",
            "notes": "充电桩随车",
            "steering_setup": "左舵",
            "market_region": "国际版",
        }
    ])

    assert len(formatted) == 1
    row = formatted[0]
    assert row["model"] == "Shark"
    assert row["trim_config"] == "BYD SHARK 6 PREMIUM 左舵国标"
    assert row["cost_fca_usd"] == 33650
    assert row["steering_setup"] == "左舵"
    assert row["version_type"] == "国际版"


def test_record_to_feishu_fields_uses_manufacture_date_not_time():
    fields = record_to_feishu_fields({
        "brand": "BYD",
        "model": "Dolphin",
        "manufacture_date": "2026-07-03",
    })

    assert isinstance(fields["manufacture_date"], int)
    assert "time" not in fields


def test_record_to_feishu_fields_converts_dates_to_milliseconds():
    fields = record_to_feishu_fields({
        "brand": "BYD",
        "model": "Dolphin",
        "manufacture_date": "2026-07-03",
    })

    assert fields["manufacture_date"] > 1_700_000_000_000


def test_adapt_fields_to_feishu_table_maps_production_date_and_filters_unknown_fields():
    adapted = adapt_fields_to_feishu_table(
        {"brand": "BYD", "manufacture_date": 1_785_283_200_000, "cost_cif_usd": 100},
        {"brand", "production_date"},
    )

    assert adapted == {"brand": "BYD", "production_date": 1_785_283_200_000}


def test_pipeline_input_dir_can_be_scoped_by_environment(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("PIPELINE_INPUT_DIR", str(tmp_path / "scoped_input"))

    from mineru_pipeline import pipeline

    assert pipeline.input_dir() == tmp_path / "scoped_input"


def test_run_extraction_reads_excel_files_only(monkeypatch, tmp_path: Path):
    excel = tmp_path / "supplier.xlsx"
    image = tmp_path / "image.png"
    excel.write_bytes(b"xlsx")
    image.write_bytes(b"png")

    calls = []

    def fake_process_excel_file(path):
        calls.append(path)
        return [{"brand": "BYD", "modelName": "Dolphin"}]

    monkeypatch.setattr("mineru_pipeline.pipeline.process_excel_file", fake_process_excel_file)
    monkeypatch.setattr("mineru_pipeline.pipeline.compute_file_hash", lambda path: f"hash-{path.name}")

    db = get_db(tmp_path / "db.sqlite")
    try:
        rows = run_extraction(db, True, tmp_path)
    finally:
        db.close()

    assert len(rows) == 1
    assert calls == [excel]
    assert rows[0]["_source_file"] == "supplier.xlsx"


def test_sqlite_schema_has_manufacture_date(tmp_path: Path):
    db = get_db(tmp_path / "local_source.db")
    try:
        columns = [row["name"] for row in db.execute("PRAGMA table_info(source_candidates)").fetchall()]
    finally:
        db.close()

    assert "manufacture_date" in columns


def test_get_db_can_use_environment_scoped_database(monkeypatch, tmp_path: Path):
    db_path = tmp_path / "scoped.db"
    monkeypatch.setenv("LOCAL_SOURCE_DB_PATH", str(db_path))
    db = get_db()
    try:
        assert db_path.exists()
    finally:
        db.close()
