from pathlib import Path
from mineru_pipeline.async_pipeline import AsyncMinerUPipeline, run_async_pipeline


def test_async_pipeline_queue_execution(monkeypatch, tmp_path):
    ocr_file = tmp_path / "test_ocr.md"
    ocr_file.write_text("# BYD Seagull\nPrice: 69800", encoding="utf-8")

    def fake_call_ai(content, source_name, max_retries=3):
        return {
            "candidates": [
                {
                    "brand": "BYD",
                    "modelName": "Seagull",
                    "priceExw": 69800,
                    "priceExwCurrency": "CNY"
                }
            ]
        }

    monkeypatch.setattr("mineru_pipeline.async_pipeline.call_ai_with_pydantic_retry", fake_call_ai)

    results = run_async_pipeline([(ocr_file, "test_ocr.md")], concurrency=2)

    assert len(results) == 1
    assert results[0]["brand"] == "BYD"
    assert results[0]["modelName"] == "Seagull"
    assert results[0]["priceExw"] == 69800
