import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def load_ocr_process_module():
    spec = importlib.util.spec_from_file_location("ocr_process", ROOT / "scripts" / "ocr_process.py")
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
