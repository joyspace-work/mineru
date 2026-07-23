from pathlib import Path
import tomllib


ROOT = Path(__file__).resolve().parents[1]


def test_pyproject_declares_current_runtime_dependencies():
    data = tomllib.loads((ROOT / "pyproject.toml").read_text("utf-8"))

    assert data["build-system"]["requires"] == ["setuptools==83.0.0", "wheel==0.47.0"]
    assert data["project"]["name"] == "mineru-vehicle-pipeline"
    assert "mineru==3.4.4" in data["project"]["dependencies"]
    assert "paddleocr==3.7.0" in data["project"]["dependencies"]
    assert "openpyxl==3.1.5" in data["project"]["dependencies"]
    assert "python-dotenv==1.2.2" in data["project"]["dependencies"]
    assert "requests==2.34.2" in data["project"]["dependencies"]
    assert data["project"]["scripts"]["mineru-pipeline"] == "mineru_pipeline.cli:main"


def test_python_entrypoint_files_exist():
    expected = [
        "src/mineru_pipeline/__init__.py",
        "src/mineru_pipeline/cli.py",
        "src/mineru_pipeline/classify_inputs.py",
        "src/mineru_pipeline/excel_parser.py",
        "src/mineru_pipeline/gemini_extract.py",
        "src/mineru_pipeline/ocr_process.py",
        "src/mineru_pipeline/pipeline.py",
        "scripts/ocr_process.py",
    ]

    for rel_path in expected:
        assert (ROOT / rel_path).exists(), rel_path


def test_readme_uses_python_commands_not_legacy_commands():
    readme = (ROOT / "README.md").read_text("utf-8")

    assert "python -m mineru_pipeline" in readme
    assert "pip install -e ." in readme
    assert "scripts/run_pipeline" + ".js" not in readme
    assert "package" + ".json" not in readme


def test_mineru_defaults_use_fast_pipeline_backend():
    ocr_script = (ROOT / "src" / "mineru_pipeline" / "ocr_process.py").read_text("utf-8")
    env_example = (ROOT / ".env.example").read_text("utf-8")
    readme = (ROOT / "README.md").read_text("utf-8")

    assert 'os.environ.get("MINERU_BACKEND", "pipeline")' in ocr_script
    assert "MINERU_BACKEND=pipeline" in env_example
    assert "MINERU_BACKEND=pipeline" in readme


def test_ocr_process_uses_mineru_sdk_without_cli_fallback():
    ocr_script = (ROOT / "src" / "mineru_pipeline" / "ocr_process.py").read_text("utf-8")

    assert "from mineru.cli.common import do_parse as mineru_sdk_do_parse" in ocr_script
    assert "read_fn as mineru_sdk_read_fn" in ocr_script
    assert "process_with_mineru_sdk" in ocr_script
    assert "process_with_mineru_cli" not in ocr_script
    assert "magic-pdf" not in ocr_script
    assert "MINERU_CLI_FALLBACK" not in ocr_script


def test_legacy_parse_document_uses_sdk_for_mineru():
    parse_document = (ROOT / "scripts" / "parse_document.py").read_text("utf-8")

    assert "from mineru_pipeline.ocr_process import process_with_mineru" in parse_document
    assert "magic-pdf" not in parse_document
    assert 'shutil.which("mineru")' not in parse_document
