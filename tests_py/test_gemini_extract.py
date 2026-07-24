from mineru_pipeline import gemini_extract


def test_deepseek_defaults_to_official_v4_pro(monkeypatch):
    monkeypatch.delenv("AI_PROVIDER", raising=False)
    monkeypatch.delenv("DEEPSEEK_SOURCE_IMPORT_MODEL", raising=False)

    config = gemini_extract.get_api_config()

    assert config["provider"] == "deepseek"
    assert config["model"] == "deepseek-v4-pro"
    assert config["base_url"] == "https://api.deepseek.com"


def test_call_ai_retries_empty_candidates(monkeypatch, tmp_path):
    calls = []

    monkeypatch.setenv("AI_PROVIDER", "deepseek")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "test-key")
    monkeypatch.setenv("LLM_EMPTY_RETRIES", "1")
    monkeypatch.setenv("LLM_RAW_OUTPUT_DIR", str(tmp_path))

    def fake_request_json(*args, **kwargs):
        calls.append(kwargs)
        if len(calls) == 1:
            return {"choices": [{"message": {"content": '{"candidates": []}'}}]}
        return {
            "choices": [
                {
                    "message": {
                        "content": '{"candidates": [{"brand": "BYD", "modelName": "Dolphin"}]}'
                    },
                }
            ]
        }

    monkeypatch.setattr(gemini_extract, "_request_json", fake_request_json)

    result = gemini_extract.call_ai("table text", "supplier")

    assert len(calls) == 2
    first_payload = calls[0]["json"]
    assert first_payload["model"] == "deepseek-v4-pro"
    assert first_payload["max_tokens"] == 16000
    assert first_payload["thinking"] == {"type": "disabled"}
    assert first_payload["messages"][0]["role"] == "user"
    assert isinstance(first_payload["messages"][0]["content"], str)
    assert result["candidates"] == [{"brand": "BYD", "modelName": "Dolphin"}]
    assert len(list(tmp_path.glob("*.json"))) == 2


def test_deepseek_max_tokens_can_be_overridden(monkeypatch):
    monkeypatch.setenv("LLM_MAX_TOKENS", "12000")

    assert gemini_extract._llm_max_tokens("deepseek") == 12000


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


def test_prompt_enforces_deepseek_strict_json_contract():
    prompt = gemini_extract.build_prompt("<table><tr><td>车型</td></tr></table>", "supplier")

    assert "禁止输出 null 作为顶层结果" in prompt
    assert "只能输出一个可被 json.loads 直接解析的 JSON 对象" in prompt
    assert '"candidates":[]' in prompt
    assert "每个 candidate 必须包含完整字段集合" in prompt
    assert "不要使用 Markdown 代码块" in prompt


def test_prompt_keeps_llm_output_on_extraction_schema_not_base_schema():
    prompt = gemini_extract.build_prompt("<table><tr><td>FCA提货价 usd</td></tr></table>", "supplier")

    assert "modelName" in prompt
    assert "trimName" in prompt
    assert "stockQuantity" in prompt
    assert "priceFca" in prompt
    assert "priceFcaCurrency" in prompt
    assert "cost_fca_usd" not in prompt
    assert "输出字段名必须使用下列 snake_case 字段" not in prompt


def test_prompt_includes_output_template_and_self_check_rules():
    prompt = gemini_extract.build_prompt("<table><tr><td>7月交付</td></tr></table>", "supplier")

    assert "输出样例模板" in prompt
    assert '"priceFca":9250' in prompt
    assert '"priceFcaCurrency":"USD"' in prompt
    assert '"rawFields":{}' in prompt
    assert "candidate.rawText 只保留不超过 80 个字符" in prompt
    assert "最多保留 3 个关键源字段" in prompt
    assert "7月交付" in prompt
    assert "交付说明必须保留到 notes" in prompt
    assert "日期范围或多月份不要改写成单日" in prompt
    assert "不要改写车型名中的空格、连字符、大小写" in prompt
    assert "自检" in prompt


def test_prompt_template_can_be_overridden_from_environment(monkeypatch):
    monkeypatch.setenv("LLM_PROMPT_TEMPLATE", "供应商={supplier_name}; 模式={mode}; 文本={text}")

    prompt = gemini_extract.build_prompt("table text", "supplier", "text")

    assert prompt == "供应商=supplier; 模式=text; 文本=table text"


def test_raw_debug_file_includes_unparsed_api_response(monkeypatch, tmp_path):
    monkeypatch.setenv("LLM_RAW_OUTPUT_DIR", str(tmp_path))

    api_response = {"choices": [{"message": {"content": "not json text"}}]}

    gemini_extract._write_ai_raw_response(
        None,
        "supplier",
        1,
        "prompt",
        provider="deepseek",
        api_response=api_response,
        raw_message_text="not json text",
    )

    payload = __import__("json").loads(next(tmp_path.glob("*.json")).read_text("utf-8"))

    assert payload["provider"] == "deepseek"
    assert payload["response"] is None
    assert payload["raw_message_text"] == "not json text"
    assert payload["api_response"] == api_response


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
