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
        "src/mineru_pipeline/input_classifier.py",
        "src/mineru_pipeline/excel_parser.py",
        "src/mineru_pipeline/llm_extractor.py",
        "src/mineru_pipeline/ocr_engine.py",
        "src/mineru_pipeline/pipeline.py",
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
    ocr_script = (ROOT / "scripts" / "ocr_process.py").read_text("utf-8")
    env_example = (ROOT / ".env.example").read_text("utf-8")
    readme = (ROOT / "README.md").read_text("utf-8")

    assert 'os.environ.get("MINERU_BACKEND", "pipeline")' in ocr_script
    assert "MINERU_BACKEND=" in env_example
    assert "MINERU_BACKEND=" in readme
