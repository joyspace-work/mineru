from pathlib import Path

import pytest

from mineru_pipeline.pipeline import (
    adapt_fields_to_feishu_table,
    get_db,
    record_to_feishu_fields,
    save_candidates_to_db,
)


def test_record_to_feishu_fields_uses_target_table_fields_only():
    fields = record_to_feishu_fields({
        "brand": "BYD",
        "model": "Sealion 7",
        "market_region": ["国际版"],
        "developer": "王旭",
        "review_progress": "待审核",
        "cost_fca_usd": 9250,
    })

    assert fields["brand"] == "BYD"
    assert fields["market_region"] == ["国际版"]
    assert fields["cost_fca_usd"] == 9250
    assert "developer" not in fields
    assert "review_progress" not in fields


def test_record_to_feishu_fields_converts_db_number_strings():
    fields = record_to_feishu_fields({
        "brand": "BYD",
        "model": "Sealion 7",
        "cost_fca_usd": "9,250",
        "stock_quantity": "3",
    })

    assert fields["cost_fca_usd"] == 9250
    assert fields["stock_quantity"] == 3


def test_adapt_fields_to_feishu_table_filters_unknown_and_readonly_fields():
    adapted = adapt_fields_to_feishu_table(
        {"brand": "BYD", "developer": "王旭", "cost_cif_usd": 100, "cost_fca_usd": 9250},
        {"brand", "developer", "cost_fca_usd"},
    )

    assert adapted == {"brand": "BYD", "cost_fca_usd": 9250}


def test_pipeline_input_dir_can_be_scoped_by_environment(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("PIPELINE_INPUT_DIR", str(tmp_path / "scoped_input"))

    from mineru_pipeline import pipeline

    assert pipeline.input_dir() == tmp_path / "scoped_input"


def test_sqlite_schema_has_target_fields(tmp_path: Path):
    db = get_db(tmp_path / "local_source.db")
    try:
        columns = [row["name"] for row in db.execute("PRAGMA table_info(source_candidates)").fetchall()]
    finally:
        db.close()

    assert "manufacture_year" in columns
    assert "cost_fca_usd" in columns
    assert "review_progress" not in columns


def test_get_db_can_use_environment_scoped_database(monkeypatch, tmp_path: Path):
    db_path = tmp_path / "scoped.db"
    monkeypatch.setenv("LOCAL_SOURCE_DB_PATH", str(db_path))
    db = get_db()
    try:
        assert db_path.exists()
    finally:
        db.close()


def test_save_candidates_to_db_serializes_multi_select(tmp_path: Path):
    db = get_db(tmp_path / "local_source.db")
    try:
        ids = save_candidates_to_db(db, [{"brand": "BYD", "model": "Sealion 7", "market_region": ["国际版"]}])
        row = db.execute("SELECT market_region FROM source_candidates WHERE id = ?", (ids[0],)).fetchone()
    finally:
        db.close()

    assert row["market_region"] == '["国际版"]'


def test_get_db_adds_missing_target_columns_to_existing_database(tmp_path: Path):
    db_path = tmp_path / "old.db"
    db = get_db(db_path)
    db.execute("DROP TABLE source_candidates")
    db.execute("CREATE TABLE source_candidates (id INTEGER PRIMARY KEY AUTOINCREMENT, brand TEXT)")
    db.commit()
    db.close()

    db = get_db(db_path)
    try:
        columns = {row["name"] for row in db.execute("PRAGMA table_info(source_candidates)").fetchall()}
    finally:
        db.close()

    assert "cost_fca_usd" in columns
    assert "market_region" in columns


def test_editing_unknown_column_fails_fast():
    from mineru_pipeline.pipeline import action_edit

    assert action_edit("1", "review_progress", "done") == 1
