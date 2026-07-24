from __future__ import annotations

import asyncio
from pathlib import Path
import pytest
from mineru_pipeline.async_pipeline import AsyncMinerUPipeline, run_async_pipeline
from mineru_pipeline.ocr_engine import OCRResult


def test_async_decoupled_pipeline_low_confidence(monkeypatch, tmp_path):
    ocr_file = tmp_path / "low_conf.md"
    ocr_file.write_text("# Low Confidence Vehicle Data\nPrice: 80000 CNY", encoding="utf-8")
    middle_file = tmp_path / "low_conf_middle.json"
    middle_file.write_text(
        '{"pdf_info": [{"blocks": [{"lines": [{"confidence": 0.45}]}]}]}',
        encoding="utf-8",
    )

    calls = []

    def fake_call_ai_retry(content, supplier_name="", max_retries=3):
        calls.append((content, supplier_name))
        return {
            "candidates": [
                {
                    "brand": "Chery",
                    "modelName": "Tiggo",
                    "priceExw": 80000,
                    "priceExwCurrency": "CNY",
                }
            ]
        }

    monkeypatch.setattr(
        "mineru_pipeline.async_pipeline.call_ai_with_pydantic_retry",
        fake_call_ai_retry,
    )

    pipeline = AsyncMinerUPipeline(concurrency=2, output_dir=tmp_path)
    results = asyncio.run(pipeline.run([(ocr_file, "supplier_test")]))

    assert len(results) == 1
    assert len(calls) == 1
    assert results[0]["brand"] == "Chery"
    assert results[0]["_needs_human_review"] is True
    assert "MinerU OCR 低置信度警告" in results[0]["_review_reason"]
    assert "0.45" in results[0]["_review_reason"]


def test_async_decoupled_pipeline_pdf_sdk_integration(monkeypatch, tmp_path):
    pdf_file = tmp_path / "sample.pdf"
    pdf_file.write_bytes(b"%PDF-1.4 mock pdf content")

    def fake_process_file_with_sdk(file_path, output_dir, force=False):
        md_path = output_dir / "sample.md"
        md_path.write_text("# BYD Dolphin\nPrice: 99800 CNY", encoding="utf-8")
        return OCRResult(
            source_path=file_path,
            markdown_path=md_path,
            markdown_content=md_path.read_text(encoding="utf-8"),
            avg_confidence=0.92,
            is_cached=False,
        )

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
        "mineru_pipeline.async_pipeline.process_file_with_sdk",
        fake_process_file_with_sdk,
    )
    monkeypatch.setattr(
        "mineru_pipeline.async_pipeline.call_ai_with_pydantic_retry",
        fake_call_ai_retry,
    )

    results = run_async_pipeline([(pdf_file, "supplier_byd")], concurrency=2, output_dir=tmp_path)

    assert len(results) == 1
    assert results[0]["brand"] == "BYD"
    assert results[0]["modelName"] == "Dolphin"
    assert results[0].get("_needs_human_review") is not True
