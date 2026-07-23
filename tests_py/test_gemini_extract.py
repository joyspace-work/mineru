from mineru_pipeline import gemini_extract


def test_openrouter_defaults_to_nvidia_model(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER", "openrouter")
    monkeypatch.delenv("OPENROUTER_SOURCE_IMPORT_MODEL", raising=False)

    config = gemini_extract.get_api_config()

    assert config["provider"] == "openrouter"
    assert config["model"] == "nvidia/nemotron-3-ultra-550b-a55b:free"


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

    monkeypatch.setattr(gemini_extract, "_request_json", fake_request_json)

    result = gemini_extract.call_ai("table text", "supplier")

    assert len(calls) == 2
    assert result["candidates"] == [{"brand": "BYD", "modelName": "Dolphin"}]
    assert len(list(tmp_path.glob("*.json"))) == 2


def test_chunk_text_preserves_html_tables(monkeypatch):
    monkeypatch.setenv("LLM_CHUNK_CHARS", "80")
    text = "intro\n<table><tr><td>A</td></tr></table>\n" + ("paragraph " * 20)

    chunks = gemini_extract.chunk_text_for_extraction(text)

    assert len(chunks) > 1
    assert any("<table><tr><td>A</td></tr></table>" in chunk for chunk in chunks)
    assert not any("<table>" in chunk and "</table>" not in chunk for chunk in chunks)


def test_prompt_is_extraction_focused_without_business_mapping():
    prompt = gemini_extract.build_prompt("<table><tr><td>车型</td></tr></table>", "supplier")

    assert "远程 V6E" not in prompt
    assert "Brand=Farizon" not in prompt
    assert "MinerU" in prompt
    assert "<table>" in prompt


def test_process_ocr_output_merges_semantic_chunks(monkeypatch, tmp_path):
    ocr_file = tmp_path / "BYD__supplier__sheet.md"
    ocr_file.write_text("<table><tr><td>one</td></tr></table>\n\n<table><tr><td>two</td></tr></table>", "utf-8")
    calls = []

    def fake_chunk_text(content):
        return ["chunk-one", "chunk-two"]

    def fake_call_ai(text, supplier):
        calls.append((text, supplier))
        return {"candidates": [{"brand": "BYD", "modelName": text}]}

    monkeypatch.setattr(gemini_extract, "chunk_text_for_extraction", fake_chunk_text)
    monkeypatch.setattr(gemini_extract, "call_ai", fake_call_ai)

    rows = gemini_extract.process_ocr_output(ocr_file, "BYD__supplier__sheet.png")

    assert [row["modelName"] for row in rows] == ["chunk-one", "chunk-two"]
    assert len(calls) == 2
