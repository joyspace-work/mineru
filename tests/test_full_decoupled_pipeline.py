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
        "trim_config": "Flying Version",
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
    classified_dir = input_dir / "classified"
    pdfs_dir = classified_dir / "pdfs"
    excels_dir = classified_dir / "excels"
    texts_dir = classified_dir / "texts"
    output_dir = project_dir / "output"

    pdfs_dir.mkdir(parents=True)
    excels_dir.mkdir(parents=True)
    texts_dir.mkdir(parents=True)
    output_dir.mkdir(parents=True)

    sample_pdf = pdfs_dir / "sample_car_source.pdf"
    sample_pdf.write_bytes(b"%PDF-1.4 Mock Car Quotation")

    sample_txt = texts_dir / "sample_note.txt"
    sample_txt.write_text("BYD Seagull White Stock 5 Price 65000 CNY", encoding="utf-8")

    monkeypatch.setattr("mineru_pipeline.pipeline.PROJECT_ROOT", project_dir)
    monkeypatch.setattr("mineru_pipeline.pipeline.INPUT_DIR", input_dir)
    monkeypatch.setattr("mineru_pipeline.pipeline.CLASSIFIED_DIR", classified_dir)
    monkeypatch.setattr("mineru_pipeline.pipeline.OUTPUT_DIR", output_dir)
    monkeypatch.setattr("mineru_pipeline.pipeline.RECOGNIZED_DIR", output_dir / "recognized" / "mineru")
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-mock")

    # Mock SDK parse engine
    def fake_process_file_with_sdk(file_path: Path, out_dir: Path, force: bool = False):
        from mineru_pipeline.ocr_engine import OCRResult
        md_file = out_dir / f"{file_path.stem}.md"
        md_file.write_text("# 比亚迪 海鸥 Quotation\nStock: 10\nPrice: 68000 CNY", encoding="utf-8")
        return OCRResult(
            source_path=file_path,
            markdown_path=md_file,
            markdown_content=md_file.read_text(encoding="utf-8"),
            avg_confidence=0.88,
            is_cached=False,
        )

    # Mock LLM Pydantic Retry
    def fake_call_ai_pydantic_retry(content: str, supplier_name: str = "", max_retries: int = 3):
        return {
            "candidates": [
                {
                    "brand": "比亚迪",
                    "modelName": "海鸥",
                    "trimName": "Flying Edition",
                    "color": "暖阳白",
                    "stockQuantity": 10,
                    "priceExw": 68000,
                    "priceExwCurrency": "CNY",
                    "leadTimeText": "4-6周",
                    "supplierName": supplier_name or "BYD Direct",
                }
            ]
        }

    monkeypatch.setattr("mineru_pipeline.async_pipeline.process_file_with_sdk", fake_process_file_with_sdk)
    monkeypatch.setattr("mineru_pipeline.async_pipeline.call_ai_with_pydantic_retry", fake_call_ai_pydantic_retry)
    monkeypatch.setattr("mineru_pipeline.llm_extractor.call_ai_with_pydantic_retry", fake_call_ai_pydantic_retry)

    # Execute main CLI run pipeline
    ret = main(["run", "--skip-classify", "--skip-ocr"])
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
