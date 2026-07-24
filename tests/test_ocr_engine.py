from pathlib import Path
import pytest
from mineru_pipeline.ocr_engine import process_file_with_sdk, OCRResult, calculate_confidence, _run_unipipe_parse

def test_process_file_with_sdk_mock(monkeypatch, tmp_path):
    sample_file = tmp_path / "sample.pdf"
    sample_file.write_bytes(b"%PDF-1.4 mock pdf content")

    def fake_unipipe_parse(file_path, output_dir):
        filename_stem = file_path.stem
        md_file = output_dir / f"{filename_stem}.md"
        md_file.write_text("# BYD Seagull\nPrice: 69800", encoding="utf-8")
        middle_json = output_dir / f"{filename_stem}_middle.json"
        middle_json.write_text('{"pdf_info": [{"blocks": [{"lines": [{"confidence": 0.85}]}]}]}', encoding="utf-8")
        return md_file

    monkeypatch.setattr("mineru_pipeline.ocr_engine._run_unipipe_parse", fake_unipipe_parse)

    result = process_file_with_sdk(sample_file, tmp_path)

    assert isinstance(result, OCRResult)
    assert result.markdown_path.exists()
    assert "# BYD Seagull" in result.markdown_content
    assert result.avg_confidence == 0.85
    assert result.is_cached is False


def test_process_file_with_sdk_caching(monkeypatch, tmp_path):
    sample_file = tmp_path / "car.pdf"
    sample_file.write_bytes(b"%PDF-1.4 car content")
    out_dir = tmp_path / "output"

    parse_count = 0

    def fake_unipipe_parse(file_path, output_dir):
        nonlocal parse_count
        parse_count += 1
        filename_stem = file_path.stem
        md_file = output_dir / f"{filename_stem}.md"
        md_file.write_text(f"# Parsed attempt {parse_count}", encoding="utf-8")
        middle_json = output_dir / f"{filename_stem}_middle.json"
        middle_json.write_text('{"pdf_info": [{"blocks": [{"lines": [{"confidence": 0.9}]}]}]}', encoding="utf-8")
        return md_file

    monkeypatch.setattr("mineru_pipeline.ocr_engine._run_unipipe_parse", fake_unipipe_parse)

    # First call: not cached
    res1 = process_file_with_sdk(sample_file, out_dir)
    assert res1.is_cached is False
    assert parse_count == 1
    assert "attempt 1" in res1.markdown_content
    assert res1.avg_confidence == 0.9

    # Second call: cached
    res2 = process_file_with_sdk(sample_file, out_dir)
    assert res2.is_cached is True
    assert parse_count == 1
    assert "attempt 1" in res2.markdown_content

    # Third call with force=True: re-run parse
    res3 = process_file_with_sdk(sample_file, out_dir, force=True)
    assert res3.is_cached is False
    assert parse_count == 2
    assert "attempt 2" in res3.markdown_content


def test_calculate_confidence(tmp_path):
    # Non-existent file
    assert calculate_confidence(tmp_path / "non_existent.json") is None

    # Invalid JSON
    invalid_json = tmp_path / "invalid.json"
    invalid_json.write_text("invalid json content", encoding="utf-8")
    assert calculate_confidence(invalid_json) is None

    # Valid JSON with confidence values
    valid_json = tmp_path / "valid_middle.json"
    valid_json.write_text('''{
        "pdf_info": [
            {
                "blocks": [
                    {
                        "lines": [
                            {"confidence": 0.80},
                            {"confidence": 0.90}
                        ]
                    },
                    {
                        "lines": [
                            {"confidence": 0.70}
                        ]
                    }
                ]
            }
        ]
    }''', encoding="utf-8")
    assert calculate_confidence(valid_json) == pytest.approx(0.80)

    # Empty pdf_info or lines without confidence
    empty_json = tmp_path / "empty_middle.json"
    empty_json.write_text('{"pdf_info": []}', encoding="utf-8")
    assert calculate_confidence(empty_json) is None
