from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
import csv
from typing import Any

from openpyxl import load_workbook
from openpyxl.utils import get_column_letter


EXCEL_SUFFIXES = {".xlsx", ".xlsm", ".csv"}


@dataclass(frozen=True)
class ExcelText:
    source: Path
    text: str
    sheet_count: int
    row_count: int
    path_parts: tuple[str, ...] = ()


def iter_excel_files(source: str | Path) -> list[Path]:
    root = Path(source)
    if root.is_file():
        return [root] if root.suffix.lower() in EXCEL_SUFFIXES and not root.name.startswith("~$") else []
    if not root.exists():
        return []
    return sorted(
        path
        for path in root.rglob("*")
        if path.is_file() and path.suffix.lower() in EXCEL_SUFFIXES and not path.name.startswith("~$")
    )


def cell_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    return str(value).replace("\r", " ").replace("\n", " ").strip()


def _trim_cells(values: list[str]) -> list[str]:
    while values and values[-1] == "":
        values.pop()
    return values


def path_evidence_lines(path: Path, root: Path | None = None) -> tuple[list[str], tuple[str, ...]]:
    try:
        display_path = path.relative_to(root) if root else path
    except ValueError:
        display_path = path
    parts = tuple(display_path.parts)
    lines = [
        f"# Source: {path.name}",
        f"# Path: {display_path}",
    ]
    if parts:
        lines.append("# Path parts: " + " | ".join(f"{index + 1}={part}" for index, part in enumerate(parts)))
    return lines, parts


def _render_csv(path: Path, root: Path | None = None) -> ExcelText:
    lines, parts = path_evidence_lines(path, root)
    lines.append("## Sheet: csv")
    row_count = 0
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        for row_number, row in enumerate(csv.reader(handle), start=1):
            values = _trim_cells([cell_text(value) for value in row])
            if not values:
                continue
            row_count += 1
            lines.append(f"row {row_number}: " + " | ".join(f"{get_column_letter(i)}={value}" for i, value in enumerate(values, start=1)))
    return ExcelText(source=path, text="\n".join(lines), sheet_count=1, row_count=row_count, path_parts=parts)


def render_excel_file(path: str | Path, root: str | Path | None = None) -> ExcelText:
    source = Path(path)
    source_root = Path(root) if root else None
    if source.suffix.lower() == ".csv":
        return _render_csv(source, source_root)

    workbook = load_workbook(source, data_only=True, read_only=False)
    lines, parts = path_evidence_lines(source, source_root)
    total_rows = 0
    try:
        for sheet in workbook.worksheets:
            merged_values: dict[tuple[int, int], str] = {}
            merged_notes: list[str] = []
            for merged in sheet.merged_cells.ranges:
                anchor = sheet.cell(merged.min_row, merged.min_col).value
                anchor_text = cell_text(anchor)
                if anchor_text:
                    merged_notes.append(f"{merged.coord}={anchor_text}")
                for row in range(merged.min_row, merged.max_row + 1):
                    for col in range(merged.min_col, merged.max_col + 1):
                        merged_values[(row, col)] = anchor_text

            sheet_lines = [f"## Sheet: {sheet.title}"]
            if merged_notes:
                sheet_lines.append("merged: " + " | ".join(merged_notes))

            used_rows = 0
            for row in sheet.iter_rows():
                values: list[str] = []
                for cell in row:
                    value = cell_text(cell.value)
                    if not value:
                        value = merged_values.get((cell.row, cell.column), "")
                    values.append(value)
                values = _trim_cells(values)
                if not values:
                    continue
                used_rows += 1
                total_rows += 1
                cells = " | ".join(
                    f"{get_column_letter(index)}={value}"
                    for index, value in enumerate(values, start=1)
                    if value != ""
                )
                sheet_lines.append(f"row {row[0].row}: {cells}")

            if used_rows:
                lines.extend(sheet_lines)
    finally:
        workbook.close()

    return ExcelText(source=source, text="\n".join(lines), sheet_count=len(workbook.worksheets), row_count=total_rows, path_parts=parts)
