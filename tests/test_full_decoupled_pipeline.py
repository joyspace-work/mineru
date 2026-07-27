from __future__ import annotations

import json
import sqlite3
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest

from mineru_pipeline.cli import build_parser, main
from mineru_pipeline.pipeline import (
    action_clean,
    action_delete,
    action_edit,
    action_list,
    action_sync,
    format_candidates_for_feishu,
    get_db,
    run_pipeline,
    save_candidates_to_db,
)


def test_cli_help_flag():
    """Verify that python -m mineru_pipeline --help or main(['--help']) outputs help and exits cleanly."""
    parser = build_parser()
    with pytest.raises(SystemExit) as exc_info:
        parser.parse_args(["--help"])
    assert exc_info.value.code == 0


def test_cli_subprocess_help():
    """Test running python -m mineru_pipeline --help as a subprocess."""
    import os
    env = os.environ.copy()
    env["PYTHONPATH"] = str(Path(__file__).resolve().parents[1] / "src")
    result = subprocess.run(
        [sys.executable, "-m", "mineru_pipeline", "--help"],
        capture_output=True,
        text=True,
        cwd=Path(__file__).resolve().parents[1],
        env=env,
    )
    assert result.returncode == 0
    assert "MinerU vehicle source recognition pipeline" in result.stdout
    assert "--dry-run" in result.stdout


def test_cli_actions_db_operations(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture):
    """Test list, edit, sync, delete, and clean CLI actions on SQLite database."""
    output_dir = tmp_path / "output"
    output_dir.mkdir(parents=True, exist_ok=True)
    db_file = output_dir / "local_source.db"
    monkeypatch.setattr("mineru_pipeline.pipeline.PROJECT_ROOT", tmp_path)
    monkeypatch.setattr("mineru_pipeline.pipeline.OUTPUT_DIR", output_dir)

    db = get_db(db_file)
    candidate = {
        "brand": "BYD",
        "model": "Seagull",
        "variant": "Flying Version",
        "exterior_color": "White",
        "cost_exw_cny": 69800,
        "supplier": "Test Supplier",
    }
    rec_ids = save_candidates_to_db(db, [candidate])
    rec_id = str(rec_ids[0])
    db.close()

    # 1. Action list
    ret = main(["list"])
    assert ret == 0
    captured = capsys.readouterr()
    assert "BYD" in captured.out
    assert "Seagull" in captured.out

    # 2. Action edit
    ret = main(["edit", "--id", rec_id, "--key", "exterior_color", "--val", "Black"])
    assert ret == 0
    captured = capsys.readouterr()
    assert f"Updated record #{rec_id}" in captured.out

    # Verify edit in DB
    db = sqlite3.connect(db_file)
    db.row_factory = sqlite3.Row
    row = db.execute("SELECT exterior_color FROM source_candidates WHERE id = ?", (rec_id,)).fetchone()
    assert row["exterior_color"] == "Black"
    db.close()

    # 3. Action sync --dry-run
    ret = main(["sync", "--dry-run"])
    assert ret == 0

    # 4. Action delete
    ret = main(["delete", "--id", rec_id])
    assert ret == 0
    captured = capsys.readouterr()
    assert f"Deleted record #{rec_id}" in captured.out

    # 5. Action clean
    ret = main(["clean"])
    assert ret == 0
    captured = capsys.readouterr()
    assert "Cleaned" in captured.out


def test_full_decoupled_pipeline_end_to_end(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture
):
    """
    Test end-to-end extraction pipeline integration:
    - Input classification directory structure
    - SDK OCR engine mock
    - Pydantic self-correction retry LLM extraction mock
    - RuleEngine formatting (brand/model mapping, price splitting, wait days)
    - SQLite StagingDB persistence
    - Output JSON/CSV generation
    """
    project_dir = tmp_path / "project"
    input_dir = project_dir / "input"
    output_dir = project_dir / "output"

    excel_dir = input_dir / "BYD Direct" / "Nansha" / "BYD" / "Seagull"
    excel_dir.mkdir(parents=True)
    output_dir.mkdir(parents=True)

    sample_csv = excel_dir / "sample_car_source.csv"
    sample_csv.write_text("品牌,车型,配置,EXW(USD),数量,等待天数\nBYD,Seagull,Flying Edition,68000,10,42", encoding="utf-8-sig")

    monkeypatch.setattr("mineru_pipeline.pipeline.PROJECT_ROOT", project_dir)
    monkeypatch.setattr("mineru_pipeline.pipeline.INPUT_DIR", input_dir)
    monkeypatch.setattr("mineru_pipeline.pipeline.OUTPUT_DIR", output_dir)
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-mock")

    # Execute main CLI run pipeline
    ret = main(["run"])
    assert ret == 0

    captured = capsys.readouterr()
    assert "Pipeline stage 1-2 complete" in captured.out

    # Verify output JSON file created
    final_dir = output_dir / "final"
    json_files = list(final_dir.glob("candidates_*.json"))
    assert len(json_files) >= 1

    extracted_data = json.loads(json_files[0].read_text(encoding="utf-8"))
    assert len(extracted_data) >= 1

    first_item = extracted_data[0]
    # Verify RuleEngine normalization: "比亚迪" -> "BYD", "海鸥" -> "Seagull"
    assert first_item["brand"] == "BYD"
    assert first_item["model"] == "Seagull"
    assert first_item["cost_exw_usd"] == round(68000 / 6.7)  # 10149 USD
    assert first_item["order_wait_days"] == 42  # 6 weeks * 7 = 42 days

    # Verify SQLite DB insertion
    db_file = output_dir / "local_source.db"
    assert db_file.exists()
    db = sqlite3.connect(db_file)
    db.row_factory = sqlite3.Row
    db_rows = db.execute("SELECT * FROM source_candidates").fetchall()
    assert len(db_rows) >= 1
    assert db_rows[0]["brand"] == "BYD"
    db.close()


def test_cli_argument_errors():
    """Verify CLI error handling for missing arguments in edit and delete."""
    parser = build_parser()
    with pytest.raises(SystemExit) as exc_info:
        main(["edit", "--id", "1"])
    assert exc_info.value.code != 0

    with pytest.raises(SystemExit) as exc_info:
        main(["delete"])
    assert exc_info.value.code != 0
