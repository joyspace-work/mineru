import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def load_ocr_process_module():
    spec = importlib.util.spec_from_file_location("ocr_process", ROOT / "src" / "mineru_pipeline" / "ocr_process.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_process_with_mineru_sdk_invokes_do_parse(monkeypatch, tmp_path):
    module = load_ocr_process_module()
    source = tmp_path / "sample.png"
    source.write_bytes(b"fake image")
    output_dir = tmp_path / "out"
    calls = {}

    def fake_read_fn(path):
        calls["read_path"] = path
        return b"pdf bytes"

    def fake_do_parse(output_dir_arg, pdf_file_names, pdf_bytes_list, p_lang_list, **kwargs):
        calls["output_dir"] = output_dir_arg
        calls["names"] = pdf_file_names
        calls["bytes"] = pdf_bytes_list
        calls["langs"] = p_lang_list
        calls["kwargs"] = kwargs
        md_dir = Path(output_dir_arg) / "sample" / "ocr"
        md_dir.mkdir(parents=True, exist_ok=True)
        (md_dir / "sample.md").write_text("recognized", "utf-8")

    monkeypatch.setattr(module, "mineru_sdk_read_fn", fake_read_fn)
    monkeypatch.setattr(module, "mineru_sdk_do_parse", fake_do_parse)
    monkeypatch.setenv("MINERU_BACKEND", "hybrid-engine")
    monkeypatch.setenv("MINERU_EFFORT", "medium")
    monkeypatch.setenv("MINERU_METHOD", "ocr")

    result = module.process_with_mineru_sdk(source, output_dir)

    assert result.name == "sample.md"
    assert calls["read_path"] == source
    assert calls["names"] == ["sample"]
    assert calls["bytes"] == [b"pdf bytes"]
    assert calls["langs"] == ["ch"]
    assert calls["kwargs"]["backend"] == "hybrid-engine"
    assert calls["kwargs"]["parse_method"] == "ocr"
    assert calls["kwargs"]["effort"] == "medium"


def test_ocr_main_returns_failure_instead_of_exiting_when_mineru_missing(monkeypatch):
    module = load_ocr_process_module()

    monkeypatch.setattr(module, "mineru_sdk_do_parse", None)
    monkeypatch.setattr(module, "mineru_sdk_read_fn", None)
    monkeypatch.setattr(module, "check_paddleocr_installed", lambda: False)

    assert module.main(["--engine", "mineru"]) == 1


def test_analyze_recognition_confidence_marks_low_scores(monkeypatch, tmp_path):
    module = load_ocr_process_module()
    md_path = tmp_path / "sample.md"
    md_path.write_text("recognized", "utf-8")
    detail_path = tmp_path / "sample_middle.json"
    detail_path.write_text(
        '{"pages":[{"rec_scores":[0.95,0.58],"lines":[{"confidence":0.72},{"score":0.41}]}]}',
        "utf-8",
    )

    monkeypatch.setenv("MINERU_CONFIDENCE_THRESHOLD", "0.6")

    quality = module.analyze_recognition_confidence(md_path)

    assert quality["confidence_available"] is True
    assert quality["threshold"] == 0.6
    assert quality["min_confidence"] == 0.41
    assert quality["low_confidence_count"] == 2
    assert quality["requires_manual_review"] is True
    assert quality["warning"] == "recognition_confidence_below_threshold"


def test_analyze_recognition_confidence_allows_missing_scores(tmp_path):
    module = load_ocr_process_module()
    md_path = tmp_path / "sample.md"
    md_path.write_text("recognized", "utf-8")
    (tmp_path / "sample_middle.json").write_text('{"pages":[{"text":"ok"}]}', "utf-8")

    quality = module.analyze_recognition_confidence(md_path)

    assert quality["confidence_available"] is False
    assert quality["requires_manual_review"] is False
