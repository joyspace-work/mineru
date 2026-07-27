from pathlib import Path
import tomllib


ROOT = Path(__file__).resolve().parents[1]


def test_pyproject_declares_current_runtime_dependencies():
    data = tomllib.loads((ROOT / "pyproject.toml").read_text("utf-8"))

    assert data["build-system"]["requires"] == ["setuptools==83.0.0", "wheel==0.47.0"]
    assert data["project"]["name"] == "vehicle-source-excel-pipeline"
    assert "openpyxl==3.1.5" in data["project"]["dependencies"]
    assert "python-dotenv==1.2.2" in data["project"]["dependencies"]
    assert "requests==2.34.2" in data["project"]["dependencies"]
    assert not any(dep.startswith("mineru==") for dep in data["project"]["dependencies"])
    assert not any(dep.startswith("paddleocr==") for dep in data["project"]["dependencies"])
    assert data["project"]["scripts"]["mineru-pipeline"] == "mineru_pipeline.cli:main"
    assert "mineru-gui" not in data["project"]["scripts"]


def test_python_entrypoint_files_exist():
    expected = [
        "src/mineru_pipeline/__init__.py",
        "src/mineru_pipeline/cli.py",
        "src/mineru_pipeline/excel_text.py",
        "src/mineru_pipeline/gemini_extract.py",
        "src/mineru_pipeline/pipeline.py",
    ]

    for rel_path in expected:
        assert (ROOT / rel_path).exists(), rel_path


def test_readme_uses_python_commands_not_legacy_commands():
    readme = (ROOT / "README.md").read_text("utf-8")

    assert "python -m mineru_pipeline" in readme
    assert "pip install -e ." in readme
    assert "Excel/CSV 输入" in readme
    assert "MinerU OCR" in readme
    assert "scripts/run_pipeline" + ".js" not in readme
    assert "package" + ".json" not in readme


def test_project_no_longer_exposes_mineru_or_gui_runtime():
    env_example = (ROOT / ".env.example").read_text("utf-8")
    readme = (ROOT / "README.md").read_text("utf-8")

    assert "MINERU_BACKEND" not in env_example
    assert "mineru-gui" not in readme
    assert not (ROOT / "src" / "mineru_pipeline" / "gui.py").exists()
    assert not (ROOT / "src" / "mineru_pipeline" / "ocr_process.py").exists()
