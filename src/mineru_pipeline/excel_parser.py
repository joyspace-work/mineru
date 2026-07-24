from __future__ import annotations

from pathlib import Path
import csv
import re
from typing import Any

from openpyxl import load_workbook


from mineru_pipeline.schema import get_header_aliases

HEADER_ALIASES = get_header_aliases()


def normalize_header_cell(raw: Any) -> str | None:
    if raw is None or raw == "":
        return None
    cleaned = str(raw).strip().replace(" ", "").replace("\n", "").replace("（", "(").replace("）", ")")
    lower = cleaned.lower()
    
    # 0. Check internal model code vs Series/Model name
    if "车型代码" in cleaned or "modelcode" in lower:
        return "modelCode"
    if "系列" in cleaned or "series" in lower or "车系" in cleaned:
        return "modelName"

    # 1. Exact match
    for alias, field in HEADER_ALIASES.items():
        if alias.lower() == lower or alias == cleaned:
            return field

    # 2. Check if header contains price indicators FIRST
    if any(p in cleaned for p in ["指导价", "msrp", "建议价", "零售价", "对标价"]):
        return "officialSuggestedPrice"
    if "exw" in lower:
        return "priceExw"
    if "fob" in lower:
        return "priceFob"
    if "fca" in lower:
        return "priceFca"
    if "cif" in lower:
        return "priceCif"

    # 3. Check for specific configuration description keywords
    if any(c in cleaned for c in ["主要配置描述", "配置描述", "车辆配置", "配置版本", "车型版本", "款型"]):
        return "trimName"
    if "配置" in cleaned and not any(p in cleaned for p in ["价", "元", "rmb", "usd", "美元", "币"]):
        return "trimName"
    if "版本" in cleaned and not any(p in cleaned for p in ["价", "元", "rmb", "usd", "美元", "币"]):
        return "trimName"

    # 4. Fallback alias matching
    for alias, field in HEADER_ALIASES.items():
        if len(alias) >= 2 and (alias in cleaned or alias.lower() in lower):
            return field
    return None


def format_rows_as_markdown_table(rows: list[list[Any]]) -> str:
    """Formats a 2D array of Excel cells into a Markdown table string."""
    clean_rows = []
    for r in rows:
        str_r = [("" if cell is None else str(cell)).strip().replace("\n", " ") for cell in r]
        if any(str_r):
            clean_rows.append(str_r)
    if not clean_rows:
        return ""
    max_cols = max(len(r) for r in clean_rows)
    padded = [r + [""] * (max_cols - len(r)) for r in clean_rows]
    headers = padded[0]
    headers_line = "| " + " | ".join(headers) + " |"
    sep_line = "| " + " | ".join(["---"] * max_cols) + " |"
    body_lines = ["| " + " | ".join(r) + " |" for r in padded[1:]]
    return "\n".join([headers_line, sep_line] + body_lines)


def excel_to_markdown(file_path: str | Path) -> str:
    """Converts an entire Excel workbook into a unified Markdown text document."""
    file_path = Path(file_path).resolve()
    sheets_data = _read_rows(file_path)
    parts = []
    for sheet_name, rows in sheets_data.items():
        if not rows:
            continue
        table = format_rows_as_markdown_table(rows)
        if table:
            parts.append(f"## Sheet: {sheet_name}\n\n{table}")
    return "\n\n".join(parts)


def infer_supplier(filename: str) -> str:
    parts = Path(filename).stem.split("__")
    return parts[1] if len(parts) >= 2 else ""


def infer_brand(filename: str) -> str:
    return Path(filename).stem.split("__")[0]


def _read_rows(file_path: Path) -> dict[str, list[list[Any]]]:
    if file_path.suffix.lower() == ".csv":
        with file_path.open("r", encoding="utf-8-sig", newline="") as handle:
            return {"csv": list(csv.reader(handle))}
    workbook = load_workbook(file_path, data_only=True)
    sheets_dict = {}
    for sheet in workbook.worksheets:
        # Unmerge ranges and fill all cells with top-left cell value for 100% parsing accuracy
        if hasattr(sheet, "merged_cells"):
            for merged_range in list(sheet.merged_cells.ranges):
                min_col, min_row, max_col, max_row = merged_range.bounds
                top_left_val = sheet.cell(row=min_row, column=min_col).value
                try:
                    sheet.unmerge_cells(start_row=min_row, start_column=min_col, end_row=max_row, end_column=max_col)
                except Exception:
                    pass
                for r in range(min_row, max_row + 1):
                    for c in range(min_col, max_col + 1):
                        sheet.cell(row=r, column=c).value = top_left_val

        rows = [[cell.value for cell in row] for row in sheet.iter_rows()]
        sheets_dict[sheet.title] = rows
    return sheets_dict


def parse_excel_file(file_path: str | Path) -> list[dict[str, Any]]:
    file_path = Path(file_path).resolve()
    base_dir = Path("input/classified/excels").resolve()
    if base_dir in file_path.parents:
        rel_path = file_path.relative_to(base_dir)
        rel_str = str(rel_path)
        parts = rel_path.parts
        supplier = parts[0] if len(parts) >= 1 else ""
        brand = parts[1] if len(parts) >= 3 else supplier
    else:
        rel_str = file_path.name
        supplier = infer_supplier(file_path.name)
        brand = infer_brand(file_path.name)

    all_rows: list[dict[str, Any]] = []

    for sheet_name, rows in _read_rows(file_path).items():
        if not rows:
            continue

        md_table = format_rows_as_markdown_table(rows)

        # Check if horizontal table header exists in first 10 rows (supporting multi-level/stacked headers)
        header_index = -1
        last_header_index = -1
        header_map: dict[int, str] = {}
        for index, row in enumerate(rows[:10]):
            has_data_values = any(
                isinstance(v, (int, float)) or (isinstance(v, str) and re.match(r"^\d{4,}$", str(v).strip()))
                for v in row if v is not None
            )
            if has_data_values and header_index >= 0:
                break
            mapped = {col: normalize_header_cell(value) for col, value in enumerate(row) if normalize_header_cell(value)}
            if mapped:
                if header_index < 0:
                    header_index = index
                last_header_index = index
                for col, field in mapped.items():
                    if col not in header_map:
                        header_map[col] = field

        # Handle Vertical Key-Value Parameter Tables (e.g. Foton / 福田 spec sheets)
        if header_index < 0:
            extracted_model = None
            extracted_brand = brand or file_path.parent.name

            for row in rows:
                if not row or len(row) < 2:
                    continue
                k = str(row[0] or "").strip()
                v = str(row[1] or "").strip()
                if any(kw in k for kw in ["车辆名称", "子品牌", "项目名称", "车型", "型号"]):
                    if v and not extracted_model:
                        extracted_model = v
                if any(kw in k for kw in ["品牌", "厂商"]):
                    if v and not extracted_brand:
                        extracted_brand = v

            if extracted_model or md_table:
                all_rows.append({
                    "_source": str(file_path),
                    "_source_file": rel_str,
                    "_sheet": sheet_name,
                    "_type": "unstructured",
                    "_rawText": md_table,
                    "brand": extracted_brand or brand,
                    "modelName": extracted_model or sheet_name,
                    "supplierName": supplier,
                })
            continue

        # Handle Horizontal Structured Tables with Forward-Fill for Merged Cells
        last_seen: dict[str, Any] = {}
        forward_fill_fields = ("modelName", "model", "brand", "supplierName", "location", "version_type", "status_vehicle")
        
        start_row_idx = last_header_index + 1 if last_header_index >= 0 else header_index + 1
        for row_number, row in enumerate(rows[start_row_idx:], start=start_row_idx + 1):
            if not row or all(value in (None, "") for value in row):
                continue

            candidate: dict[str, Any] = {
                "_source": str(file_path),
                "_source_file": rel_str,
                "_sheet": sheet_name,
                "_rowNum": row_number,
                "_type": "structured",
                "_rawText": md_table,
            }

            for col, field in header_map.items():
                if col >= len(row):
                    continue
                value = row[col]
                if value not in (None, ""):
                    cleaned_val = value if isinstance(value, (int, float)) else str(value).strip()
                    candidate[field] = cleaned_val
                    if field in forward_fill_fields:
                        last_seen[field] = cleaned_val
                    if field in ("modelName", "model"):
                        candidate["modelName"] = cleaned_val
                        candidate["model"] = cleaned_val
                        last_seen["modelName"] = cleaned_val
                        last_seen["model"] = cleaned_val
                elif field in forward_fill_fields and field in last_seen:
                    # Forward-fill merged/parent cells
                    candidate[field] = last_seen[field]
                    if field in ("modelName", "model"):
                        candidate["modelName"] = last_seen[field]
                        candidate["model"] = last_seen[field]

            if brand and "brand" not in candidate:
                candidate["brand"] = brand
            if supplier:
                candidate["supplierName"] = supplier
            elif "supplierName" not in candidate:
                candidate["supplierName"] = supplier

            if not any(candidate.get(k) for k in ("modelName", "model", "priceExw", "priceFob", "priceFca", "supplierPriceCny", "trimName", "trim_config")):
                continue
            all_rows.append(candidate)

    return all_rows
