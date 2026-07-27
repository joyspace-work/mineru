from __future__ import annotations

import asyncio
from pathlib import Path
import pytest
from mineru_pipeline.async_pipeline import AsyncMinerUPipeline, run_async_pipeline


def test_async_decoupled_pipeline_excel_integration(monkeypatch, tmp_path):
    excel_file = tmp_path / "sample.txt"
    excel_file.write_text("# BYD Dolphin\nPrice: 99800 CNY", encoding="utf-8")

    def fake_call_ai_retry(content, supplier_name="", max_retries=3):
        return {
            "candidates": [
                {
                    "brand": "BYD",
                    "modelName": "Dolphin",
                    "priceExw": 99800,
                    "priceExwCurrency": "CNY",
                }
            ]
        }

    monkeypatch.setattr(
        "mineru_pipeline.async_pipeline.call_ai_with_pydantic_retry",
        fake_call_ai_retry,
    )

    results = run_async_pipeline([(excel_file, "supplier_byd")], concurrency=2, output_dir=tmp_path)

    assert len(results) == 1
    assert results[0]["brand"] == "BYD"
    assert results[0]["modelName"] == "Dolphin"
