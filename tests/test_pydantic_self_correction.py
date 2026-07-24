from __future__ import annotations

import json
from typing import Any
from mineru_pipeline import llm_extractor
from mineru_pipeline.llm_extractor import call_ai_with_pydantic_retry, HAS_PYDANTIC


def test_pydantic_self_correction_retry_success_on_second_attempt(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setenv("BASE_URL", "https://generativelanguage.googleapis.com/v1beta")
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("GEMINI_RAW_OUTPUT_DIR", str(tmp_path))

    def fake_request_json(url: str, **kwargs: Any) -> dict[str, Any]:
        calls.append(kwargs)
        if len(calls) == 1:
            # First attempt returns invalid data (stockQuantity is dict instead of int/float/None)
            invalid_payload = {
                "candidates": [
                    {
                        "brand": "BYD",
                        "modelName": "Han",
                        "stockQuantity": {"invalid": "nested_dict"},
                    }
                ]
            }
            return {
                "candidates": [
                    {
                        "content": {
                            "parts": [
                                {
                                    "text": json.dumps(invalid_payload)
                                }
                            ]
                        }
                    }
                ]
            }
        # Second attempt returns valid data
        valid_payload = {
            "candidates": [
                {
                    "brand": "BYD",
                    "modelName": "Han",
                    "stockQuantity": 10,
                }
            ]
        }
        return {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {
                                "text": json.dumps(valid_payload)
                            }
                        ]
                    }
                }
            ]
        }

    monkeypatch.setattr(llm_extractor, "_request_json", fake_request_json)

    res = call_ai_with_pydantic_retry("BYD Han 10 units", "BYD Supplier", max_retries=3)

    assert len(calls) == 2
    assert res is not None
    assert res["candidates"][0]["stockQuantity"] == 10
    # Second call's prompt should contain error feedback
    second_call_prompt = calls[1]["json"]["contents"][0]["parts"][0]["text"]
    assert "上一次校验失败" in second_call_prompt or "Validation Error" in second_call_prompt


def test_pydantic_self_correction_all_retries_fail(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setenv("BASE_URL", "https://generativelanguage.googleapis.com/v1beta")
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("GEMINI_RAW_OUTPUT_DIR", str(tmp_path))

    def fake_request_json(url: str, **kwargs: Any) -> dict[str, Any]:
        calls.append(kwargs)
        invalid_payload = {
            "candidates": [
                {
                    "brand": "BYD",
                    "modelName": "Han",
                    "stockQuantity": {"invalid": "type"},
                }
            ]
        }
        return {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {
                                "text": json.dumps(invalid_payload)
                            }
                        ]
                    }
                }
            ]
        }

    monkeypatch.setattr(llm_extractor, "_request_json", fake_request_json)

    res = call_ai_with_pydantic_retry("BYD Han invalid", "BYD Supplier", max_retries=3)

    assert len(calls) == 3
    assert res is not None
    cand = res["candidates"][0]
    assert cand["_needs_human_review"] is True
    assert cand["_review_reason"] == "Pydantic validation failed after retries"


def test_pydantic_self_correction_success_first_attempt(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setenv("BASE_URL", "https://generativelanguage.googleapis.com/v1beta")
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("GEMINI_RAW_OUTPUT_DIR", str(tmp_path))

    def fake_request_json(url: str, **kwargs: Any) -> dict[str, Any]:
        calls.append(kwargs)
        valid_payload = {
            "candidates": [
                {
                    "brand": "BYD",
                    "modelName": "Seagull",
                    "priceExw": 69800,
                }
            ]
        }
        return {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {
                                "text": json.dumps(valid_payload)
                            }
                        ]
                    }
                }
            ]
        }

    monkeypatch.setattr(llm_extractor, "_request_json", fake_request_json)

    res = call_ai_with_pydantic_retry("BYD Seagull 69800", "BYD Supplier", max_retries=3)

    assert len(calls) == 1
    assert res is not None
    assert res["candidates"][0]["brand"] == "BYD"
    assert res["candidates"][0]["modelName"] == "Seagull"


def test_pydantic_response_schema_in_generation_config(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setenv("BASE_URL", "https://generativelanguage.googleapis.com/v1beta")
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("GEMINI_RAW_OUTPUT_DIR", str(tmp_path))

    def fake_request_json(url: str, **kwargs: Any) -> dict[str, Any]:
        calls.append(kwargs)
        valid_payload = {"candidates": [{"brand": "BYD"}]}
        return {
            "candidates": [
                {"content": {"parts": [{"text": json.dumps(valid_payload)}]}}
            ]
        }

    monkeypatch.setattr(llm_extractor, "_request_json", fake_request_json)

    call_ai_with_pydantic_retry("BYD", "BYD Supplier", max_retries=1)

    assert len(calls) == 1
    gen_config = calls[0]["json"]["generationConfig"]
    if HAS_PYDANTIC:
        assert "responseSchema" in gen_config
        assert "properties" in gen_config["responseSchema"]
