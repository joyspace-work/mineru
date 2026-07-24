from pathlib import Path

from mineru_pipeline.gui import (
    RunOptions,
    build_pipeline_command,
    iter_selected_files,
    provider_environment,
    recognized_manifest_files,
    sqlite_status,
    selected_extensions,
    stage_selected_input,
    summarize_candidates,
    summarize_llm_raw,
)


def test_selected_extensions_defaults_to_all_supported_types():
    extensions = selected_extensions([])

    assert ".png" in extensions
    assert ".pdf" in extensions
    assert ".xlsx" in extensions


def test_iter_selected_files_filters_multiple_types(tmp_path: Path):
    image = tmp_path / "sheet.png"
    pdf = tmp_path / "quote.pdf"
    excel = tmp_path / "table.xlsx"
    image.write_bytes(b"image")
    pdf.write_bytes(b"pdf")
    excel.write_bytes(b"xlsx")

    files = iter_selected_files(tmp_path, ["images", "pdfs"])

    assert files == [pdf, image] or files == [image, pdf]
    assert excel not in files


def test_stage_selected_input_copies_filtered_folder(tmp_path: Path):
    source = tmp_path / "source"
    source.mkdir()
    (source / "a.png").write_bytes(b"a")
    (source / "b.txt").write_text("b", "utf-8")
    input_dir = tmp_path / "input"

    pipeline_input, count = stage_selected_input(str(source), ["images"], input_dir, batch_name="batch")

    assert pipeline_input == input_dir.resolve()
    assert count == 1
    assert (input_dir / "batch" / "a.png").read_bytes() == b"a"
    assert not (input_dir / "batch" / "b.txt").exists()


def test_stage_selected_input_replaces_previous_gui_batch(tmp_path: Path):
    source = tmp_path / "source"
    source.mkdir()
    (source / "new.png").write_bytes(b"new")
    input_dir = tmp_path / "input"
    stale = input_dir / "old" / "stale.png"
    stale.parent.mkdir(parents=True)
    stale.write_bytes(b"old")

    _pipeline_input, count = stage_selected_input(str(source), ["images"], input_dir, batch_name="batch")

    assert count == 1
    assert not stale.exists()
    assert (input_dir / "batch" / "new.png").exists()


def test_provider_environment_uses_provider_specific_keys():
    env = provider_environment(RunOptions(
        provider="openrouter",
        api_key="key",
        model="model",
        base_url="https://example.test",
        prompt_template="prompt",
    ))

    assert env["AI_PROVIDER"] == "openrouter"
    assert env["OPENROUTER_API_KEY"] == "key"
    assert env["OPENROUTER_SOURCE_IMPORT_MODEL"] == "model"
    assert env["OPENROUTER_BASE_URL"] == "https://example.test"
    assert env["LLM_PROMPT_TEMPLATE"] == "prompt"


def test_build_pipeline_command_uses_layer_actions():
    options = RunOptions(provider="deepseek", api_key="key", model="model", base_url="")

    command = build_pipeline_command("recognize", options)

    assert command[1:3] == ["-m", "mineru_pipeline"]
    assert "--action" in command
    assert "recognize" in command
    assert "--backend" in command
    assert "hybrid-engine" in command


def test_build_pipeline_command_can_target_selected_layer_files(tmp_path: Path):
    options = RunOptions(provider="deepseek", api_key="key", model="model", base_url="")
    ocr_output = tmp_path / "recognized.md"
    raw_candidates = tmp_path / "raw_candidates_1.json"

    extract_command = build_pipeline_command("extract", options, ocr_output=ocr_output)
    aggregate_command = build_pipeline_command("aggregate", options, raw_candidates=raw_candidates)

    assert extract_command[-2:] == ["--ocr-output", str(ocr_output)]
    assert aggregate_command[-2:] == ["--raw-candidates", str(raw_candidates)]


def test_recognized_manifest_files_uses_current_manifest_outputs(tmp_path: Path):
    root = tmp_path / "recognized" / "mineru"
    output_dir = root / "images" / "sheet"
    output_dir.mkdir(parents=True)
    markdown = output_dir / "sheet.md"
    metadata = output_dir / "sheet.json"
    stale = root / "old.md"
    markdown.write_text("current", "utf-8")
    metadata.write_text("{}", "utf-8")
    stale.write_text("stale", "utf-8")
    (root / "manifest.json").write_text(
        '{"files":[{"output_path":' + repr(str(markdown)).replace("'", '"') + '}]}',
        "utf-8",
    )

    files = recognized_manifest_files(root)

    assert markdown in files
    assert metadata in files
    assert stale not in files


def test_recognized_manifest_files_does_not_show_stale_files_after_empty_run(tmp_path: Path):
    root = tmp_path / "recognized" / "mineru"
    root.mkdir(parents=True)
    stale = root / "old.md"
    stale.write_text("stale", "utf-8")
    manifest = root / "manifest.json"
    manifest.write_text('{"total_files":0,"files":[]}', "utf-8")

    files = recognized_manifest_files(root)

    assert files == [manifest]
    assert stale not in files


def test_summarize_llm_raw_shows_debug_metadata(tmp_path: Path):
    raw = tmp_path / "raw.json"
    raw.write_text(
        '{"provider":"deepseek","candidate_count":2,"prompt_hash":"abc",'
        '"raw_message_text":"{\\"candidates\\":[1,2]}",'
        '"api_response":{"choices":[{"finish_reason":"stop"}],"usage":{"completion_tokens":123}}}',
        "utf-8",
    )

    summary = summarize_llm_raw(raw)

    assert "candidate_count: 2" in summary
    assert "finish_reason: stop" in summary
    assert "completion_tokens: 123" in summary


def test_summarize_candidates_counts_rows_and_sources(tmp_path: Path):
    path = tmp_path / "candidates.json"
    path.write_text(
        '[{"brand":"BYD","source_file":"a.png","stock_quantity":2},'
        '{"brand":"BYD","source_file":"a.png","stock_quantity":3}]',
        "utf-8",
    )

    summary = summarize_candidates(path)

    assert "candidate_count: 2" in summary
    assert "stock_sum: 5" in summary
    assert "BYD: 2" in summary
    assert "a.png: 2" in summary


def test_sqlite_status_reports_candidate_status_counts(tmp_path: Path):
    import sqlite3

    db_path = tmp_path / "local_source.db"
    db = sqlite3.connect(db_path)
    db.execute("CREATE TABLE source_candidates (id INTEGER, brand TEXT, model TEXT, stock_quantity INTEGER, status TEXT, created_at TEXT)")
    db.execute("INSERT INTO source_candidates VALUES (1, 'BYD', 'Dolphin', 2, 'pending', 'now')")
    db.commit()
    db.close()

    status = sqlite_status(db_path)

    assert "total: 1" in status
    assert "pending" in status
