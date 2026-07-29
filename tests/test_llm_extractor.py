from mineru_pipeline import llm_extractor


def test_call_ai_retries_empty_candidates(monkeypatch, tmp_path):
    calls = []

    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("GEMINI_EMPTY_RETRIES", "1")
    monkeypatch.setenv("GEMINI_RAW_OUTPUT_DIR", str(tmp_path))

    def fake_request_json(*args, **kwargs):
        calls.append(kwargs)
        if len(calls) == 1:
            return {"candidates": [{"content": {"parts": [{"text": '{"candidates": []}'}]}}]}
        return {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {
                                "text": '{"candidates": [{"brand": "BYD", "modelName": "Dolphin"}]}'
                            }
                        ]
                    }
                }
            ]
        }

    monkeypatch.setattr(llm_extractor, "_request_json", fake_request_json)

    result = llm_extractor.call_ai("table text", "supplier")

    assert len(calls) == 2
    assert result["candidates"] == [{"brand": "BYD", "modelName": "Dolphin"}]
    assert len(list(tmp_path.glob("*.json"))) == 2
