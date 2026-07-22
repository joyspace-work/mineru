from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import shutil


BUCKETS: dict[str, set[str]] = {
    "images": {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".svg"},
    "pdfs": {".pdf"},
    "excels": {".xlsx", ".xls", ".csv"},
    "documents": {".docx", ".doc", ".rtf"},
    "presentations": {".pptx", ".ppt"},
    "texts": {".txt", ".md"},
}
JUNK_NAMES = {".DS_Store", "Thumbs.db", "desktop.ini"}
JUNK_EXTENSIONS = {".db", ".mp4", ".avi", ".mov", ".mkv", ".wmv", ".flv"}
EXT_TO_BUCKET = {ext: bucket for bucket, exts in BUCKETS.items() for ext in exts}


@dataclass
class ClassificationStats:
    deleted: int = 0
    classified: int = 0
    skipped: int = 0


def _relative_prefixed_name(input_dir: Path, file_path: Path) -> str:
    return "__".join(file_path.relative_to(input_dir).parts)


def _resolve_collision(dest_path: Path) -> Path:
    if not dest_path.exists():
        return dest_path
    counter = 1
    while True:
        candidate = dest_path.with_name(f"{dest_path.stem}_{counter}{dest_path.suffix}")
        if not candidate.exists():
            return candidate
        counter += 1


def classify_inputs(input_dir: Path) -> ClassificationStats:
    input_dir = input_dir.resolve()
    classified_dir = input_dir / "classified"
    for bucket in [*BUCKETS, "other"]:
        (classified_dir / bucket).mkdir(parents=True, exist_ok=True)

    stats = ClassificationStats()
    files = [
        path for path in input_dir.rglob("*")
        if path.is_file() and "classified" not in path.relative_to(input_dir).parts
    ]

    for file_path in files:
        ext = file_path.suffix.lower()
        if file_path.name in JUNK_NAMES or ext in JUNK_EXTENSIONS:
            file_path.unlink(missing_ok=True)
            stats.deleted += 1
            continue

        if file_path.name == "新建 文本文档.txt" and file_path.stat().st_size == 0:
            file_path.unlink(missing_ok=True)
            stats.deleted += 1
            continue

        bucket = EXT_TO_BUCKET.get(ext, "other")
        dest_path = _resolve_collision(classified_dir / bucket / _relative_prefixed_name(input_dir, file_path))
        shutil.move(str(file_path), str(dest_path))
        stats.classified += 1

    for directory in sorted([p for p in input_dir.rglob("*") if p.is_dir()], reverse=True):
        if directory == classified_dir or "classified" in directory.relative_to(input_dir).parts:
            continue
        try:
            directory.rmdir()
        except OSError:
            pass

    return stats
