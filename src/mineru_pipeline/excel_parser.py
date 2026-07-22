from __future__ import annotations

from pathlib import Path
import csv
from typing import Any

from openpyxl import load_workbook


HEADER_ALIASES = {
    "品牌": "brand", "车辆品牌": "brand", "brand": "brand", "厂商": "brand",
    "车型": "modelName", "型号": "modelName", "车款": "modelName", "model": "modelName",
    "产品名称": "modelName", "产品": "modelName", "车辆名称": "modelName",
    "配置": "trimName", "版本": "trimName", "款型": "trimName", "trim": "trimName",
    "规格": "trimName", "车型版本": "trimName", "配置版本": "trimName",
    "年款": "year", "年份": "year", "year": "year", "款": "year",
    "manufacture_date": "manufactureDate", "manufacturedate": "manufactureDate",
    "production_date": "manufactureDate", "productiondate": "manufactureDate",
    "time": "manufactureDate", "制造日期": "manufactureDate", "生产日期": "manufactureDate",
    "出厂日期": "manufactureDate", "生产时间": "manufactureDate", "制造时间": "manufactureDate",
    "出厂时间": "manufactureDate",
    "出厂价": "priceExw", "EXW": "priceExw", "exw": "priceExw", "exw价格": "priceExw",
    "出厂报价": "priceExw", "工厂价": "priceExw", "裸车价": "priceExw",
    "不含税价": "priceExw", "含税价": "priceExw", "指导价": "priceExw",
    "车辆价格": "priceExw", "单价": "priceExw", "价格": "priceExw", "price": "priceExw",
    "FOB": "priceFob", "fob": "priceFob", "FOB价格": "priceFob", "fob价格": "priceFob",
    "FOB价": "priceFob", "离岸价": "priceFob",
    "FCA": "priceFca", "fca": "priceFca", "FCA价格": "priceFca",
    "CIF": "priceCif", "cif": "priceCif", "CIF价格": "priceCif", "到岸价": "priceCif",
    "币种": "currency", "currency": "currency",
    "颜色": "color", "车身颜色": "color", "外观颜色": "color", "color": "color",
    "内饰颜色": "interiorColor", "内饰": "interiorColor",
    "提货地": "location", "发货地": "location", "仓库": "location", "地点": "location",
    "发运地": "location", "出发港": "location", "港口": "location",
    "库存": "quantity", "数量": "quantity", "台数": "quantity", "可订数量": "quantity",
    "qty": "quantity", "在库数量": "quantity", "现货": "quantity",
    "备注": "notes", "说明": "notes", "notes": "notes", "remark": "notes",
    "供应商": "supplierName", "经销商": "supplierName", "报价方": "supplierName",
    "左右舵": "steeringPosition", "方向盘": "steeringPosition",
}


def normalize_header_cell(raw: Any) -> str | None:
    if raw is None or raw == "":
        return None
    cleaned = str(raw).strip().replace(" ", "").replace("\n", "").replace("（", "(").replace("）", ")")
    if cleaned in HEADER_ALIASES:
        return HEADER_ALIASES[cleaned]
    lower = cleaned.lower()
    for alias, field in HEADER_ALIASES.items():
        if alias.lower() == lower:
            return field
    for alias, field in HEADER_ALIASES.items():
        if cleaned in alias or alias in cleaned:
            return field
    return None


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
    return {
        sheet.title: [[cell for cell in row] for row in sheet.iter_rows(values_only=True)]
        for sheet in workbook.worksheets
    }


def parse_excel_file(file_path: str | Path) -> list[dict[str, Any]]:
    file_path = Path(file_path)
    supplier = infer_supplier(file_path.name)
    brand = infer_brand(file_path.name)
    all_rows: list[dict[str, Any]] = []

    for sheet_name, rows in _read_rows(file_path).items():
        if len(rows) < 2:
            continue

        header_index = -1
        header_map: dict[int, str] = {}
        for index, row in enumerate(rows[:10]):
            mapped = {col: normalize_header_cell(value) for col, value in enumerate(row)}
            mapped = {col: field for col, field in mapped.items() if field}
            if len(mapped) >= 2:
                header_index = index
                header_map = mapped
                break

        if header_index < 0:
            all_rows.append({
                "_source": str(file_path),
                "_sheet": sheet_name,
                "_type": "unstructured",
                "_rawText": "\n".join("\t".join("" if c is None else str(c) for c in row) for row in rows),
                "brand": brand,
                "supplierName": supplier,
            })
            continue

        for row_number, row in enumerate(rows[header_index + 1:], start=header_index + 2):
            if not row or all(value in (None, "") for value in row):
                continue
            candidate: dict[str, Any] = {
                "_source": str(file_path),
                "_sheet": sheet_name,
                "_rowNum": row_number,
                "_type": "structured",
            }
            for col, field in header_map.items():
                if col >= len(row):
                    continue
                value = row[col]
                if value not in (None, ""):
                    candidate[field] = value if isinstance(value, (int, float)) else str(value).strip()
            candidate.setdefault("brand", brand)
            candidate.setdefault("supplierName", supplier)
            if not any(candidate.get(k) for k in ("modelName", "priceExw", "priceFob", "trimName")):
                continue
            all_rows.append(candidate)

    return all_rows
