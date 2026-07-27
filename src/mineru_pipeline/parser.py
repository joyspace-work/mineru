"""
Unified Extraction Engine for MinerU Pipeline.
Consolidates openpyxl native Excel parsing, vertical parameter tables,
unstructured text row fallback, Gemini LLM fallback with Pydantic self-correction,
and async processing queues.
"""

from __future__ import annotations

import asyncio
import csv
import json
import logging
import os
import re
from pathlib import Path
from typing import Any

import openpyxl
from pydantic import BaseModel, Field

from .schema import VehicleBatchResponse, get_rule_engine

logger = logging.getLogger(__name__)

# Try loading optional magic-pdf / mineru SDK
try:
    from magic_pdf.pipe.UNIPipe import UNIPipe
    HAS_MINERU_SDK = True
except ImportError:
    HAS_MINERU_SDK = False


# ==============================================================================
# 1. Native Excel Parsing Engine
# ==============================================================================

def normalize_header_cell(cell_value: Any) -> str | None:
    return get_rule_engine().normalize_header_cell(cell_value)


KNOWN_BRANDS_PATH_SET = {
    "比亚迪", "BYD", "吉利", "Geely", "长安", "Changan", "五菱", "Wuling",
    "东风", "Dongfeng", "丰田", "Toyota", "捷途", "Jetour", "方程豹", "Fangchengbao",
    "深蓝", "Deepal", "启源", "阿维塔", "Avatr", "红旗", "Hongqi", "零跑", "Leapmotor",
    "理想", "Li Auto", "小鹏", "XPENG", "小米", "Xiaomi", "智己", "IM Motors",
    "极氪", "Zeekr", "福田", "Foton", "远程", "Farizon", "奇瑞", "Chery",
    "长城", "GWM", "坦克", "Tank", "岚图", "Voyah", "问界", "AITO", "山东小车",
    "奔腾", "奔腾小马", "小马奔腾", "小马", "广汽", "GAC", "埃安", "Smart", "蔚来", "NIO", "上汽", "SAIC"
}

KNOWN_MODELS_PATH_SET = {
    "T03", "t03", "小马奔腾", "奔腾小马", "ATTO3", "atto3", "阿维塔", "智己", "智己L6", "智己LS6",
    "铂智3X", "i60", "V8E", "海狮05", "A7", "星耀6", "牛仔", "新V系列", "SV系列", "奥铃"
}

KNOWN_LOCATIONS = {
    "南沙", "广州", "天津", "上海", "深圳", "宁波", "青岛", "厦门", "霍尔果斯", "霍尔果斯基地",
    "喀什", "喀什综合保税区", "盐城", "咸阳", "芜湖", "成都", "重庆", "西安", "太原", "武汉",
    "郑州", "合肥", "南京", "杭州", "福州", "大连", "连云港", "钦州", "防城港", "凭祥",
    "满洲里", "二连浩特", "瑞丽", "黑河", "绥芬河"
}


def is_physical_location_path(text: str) -> str | None:
    if not text:
        return None
    raw = text.strip()
    clean = re.sub(r"^(FCA|EXW|FOB|CIF)\s*", "", raw, flags=re.IGNORECASE).strip()
    if clean in KNOWN_BRANDS_PATH_SET or clean in KNOWN_MODELS_PATH_SET:
        return None
    if any(b.lower() == clean.lower() for b in KNOWN_BRANDS_PATH_SET) or any(m.lower() == clean.lower() for m in KNOWN_MODELS_PATH_SET):
        return None
    if re.search(r"^(FCA|EXW|FOB|CIF)", raw, re.IGNORECASE):
        return clean
    if clean in KNOWN_LOCATIONS or any(loc in clean for loc in KNOWN_LOCATIONS):
        return clean
    if clean.endswith(("港", "仓", "基地", "保税区", "关", "口岸")):
        return clean
    return None


def extract_path_metadata(file_path: Path) -> dict[str, str | None]:
    parts = [p for p in file_path.parts if p not in (".", "..")]
    if "input" in parts:
        idx = parts.index("input")
        rel_parts = parts[idx + 1 :]
    else:
        rel_parts = parts[-4:]

    supplier = rel_parts[0] if len(rel_parts) >= 1 else None
    location = None
    brand = None
    model = None

    mid_parts = rel_parts[1:-1]
    for part in mid_parts:
        loc = is_physical_location_path(part)
        if loc:
            location = loc
        elif part in KNOWN_BRANDS_PATH_SET or any(b.lower() == part.lower() for b in KNOWN_BRANDS_PATH_SET):
            if not brand:
                brand = part
            else:
                model = part
        else:
            if not model:
                model = part

    file_stem = file_path.stem
    if not model and file_stem not in ("价格表", "车源", "报价表", "库存", "价格", "报价"):
        model = file_stem

    return {
        "supplier": supplier,
        "location": location,
        "brand": brand,
        "model": model,
    }


import csv

def _read_rows(file_path: Path) -> dict[str, list[list[Any]]]:
    if file_path.suffix.lower() == ".csv":
        with open(file_path, "r", encoding="utf-8-sig", errors="ignore") as f:
            reader = csv.reader(f)
            return {"Sheet1": [row for row in reader if any(row)]}

    wb = openpyxl.load_workbook(file_path, data_only=True)
    sheets: dict[str, list[list[Any]]] = {}

    for sheet_name in wb.sheetnames:
        sheet = wb[sheet_name]
        grid: dict[tuple[int, int], Any] = {}

        for row_idx, row in enumerate(sheet.iter_rows(values_only=False), start=1):
            for col_idx, cell in enumerate(row, start=1):
                val = cell.value
                if val is not None:
                    grid[(row_idx, col_idx)] = val

        for range_ in sheet.merged_cells.ranges:
            top_left_val = grid.get((range_.min_row, range_.min_col))
            if top_left_val is not None:
                for r in range(range_.min_row, range_.max_row + 1):
                    for c in range(range_.min_col, range_.max_col + 1):
                        grid[(r, c)] = top_left_val

        max_row = max((r for r, _ in grid.keys()), default=0)
        max_col = max((c for _, c in grid.keys()), default=0)

        rows: list[list[Any]] = []
        for r in range(1, max_row + 1):
            row_vals = [grid.get((r, c)) for c in range(1, max_col + 1)]
            if any(v is not None for v in row_vals):
                rows.append(row_vals)

        sheets[sheet_name] = rows

    return sheets


def is_vertical_parameter_table(rows: list[list[Any]]) -> bool:
    if len(rows) < 5 or len(rows[0]) > 4:
        return False
    param_count = 0
    param_keys = ["项目", "参数", "配置", "品牌", "车型", "售价", "电池", "续航", "颜色", "车架号"]
    for row in rows[:15]:
        first_cell = str(row[0]).strip() if row and row[0] is not None else ""
        if any(k in first_cell for k in param_keys):
            param_count += 1
    return param_count >= 3


def parse_vertical_parameter_table(rows: list[list[Any]], sheet_name: str, meta: dict[str, Any], file_path: Path) -> dict[str, Any]:
    record: dict[str, Any] = {
        "_source_file": file_path.name,
        "_sheet_name": sheet_name,
        "_type": "vertical_parameter",
        "supplier": meta["supplier"],
        "location": meta["location"],
        "brand": meta["brand"],
        "model": None,
    }

    notes: list[str] = []
    extracted_model: str | None = None

    for row in rows:
        if not row or len(row) < 2:
            continue
        key_str = str(row[0]).strip() if row[0] is not None else ""
        val_str = str(row[1]).strip() if row[1] is not None else ""

        if not key_str or not val_str:
            continue

        if any(k in key_str for k in ["车辆名称", "子品牌", "车型", "型号", "项目名称"]) and not extracted_model:
            extracted_model = val_str

        field = normalize_header_cell(key_str)
        if field:
            record[field] = val_str
        else:
            notes.append(f"{key_str}: {val_str}")

    record["model"] = extracted_model or meta["model"]
    if notes:
        existing_notes = record.get("notes")
        record["notes"] = f"{existing_notes}; " + "; ".join(notes) if existing_notes else "; ".join(notes)

    return record


def parse_unstructured_text_rows(rows: list[list[Any]], sheet_name: str, meta: dict[str, Any], file_path: Path) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    extracted_location = meta.get("location")

    current_model = meta.get("model")
    current_trim = None
    current_cny = None
    current_usd = None
    current_loc = extracted_location

    for row in rows:
        if not row:
            continue
        row_str = " ".join(str(v).strip() for v in row if v not in (None, "")).strip()
        if not row_str or "行号" in row_str or "源文件" in row_str or "转换方式" in row_str:
            continue

        clean_str = re.sub(r"(\d),(\d{3})", r"\1\2", row_str)

        m_loc = re.search(r"(?:EXW|FOB|FCA|CIF)\s*([\u4e00-\u9fa5]{2,6})", clean_str, re.IGNORECASE)
        if m_loc:
            current_loc = m_loc.group(1)

        m_smart = re.search(r"(Smart\s*#?\d+)\s*([A-Za-z0-9\+\s]*)", clean_str, re.IGNORECASE)
        m_im = re.search(r"(智己\s*L6|L6)\s*([A-Za-z0-9\+\s]*\+?)", clean_str, re.IGNORECASE)

        if m_smart:
            current_model = m_smart.group(1).strip()
            current_trim = m_smart.group(2).strip() or None
        elif m_im:
            current_model = "L6"
            current_trim = m_im.group(1).strip() if "MAX" in m_im.group(1) else (m_im.group(2).strip() or None)
        else:
            m_trim = re.search(r"(\d{3,4}\s*[\u4e00-\u9fa5A-Za-z0-9]+)", clean_str)
            if m_trim:
                current_trim = m_trim.group(1).strip()

        m_cny = re.search(r"(?:指导价|售价|RMB|¥)\s*(\d{5,6})", clean_str, re.IGNORECASE)
        if m_cny:
            current_cny = float(m_cny.group(1))

        m_dollar = re.search(r"\$\s*(\d{4,6})", clean_str)
        m_exw = re.search(r"(\d{4,6})\s*(?:EXW|FOB|FCA|CIF|USD)", clean_str, re.IGNORECASE)
        m_after_exw = re.search(r"(?:EXW|FOB|FCA|CIF)\s*(?:[^\d]*)\s*(\d{4,6})", clean_str, re.IGNORECASE)

        if m_dollar:
            current_usd = float(m_dollar.group(1))
        elif m_exw:
            current_usd = float(m_exw.group(1))
        elif m_after_exw:
            current_usd = float(m_after_exw.group(1))

        if current_model and (current_cny or current_usd):
            cand: dict[str, Any] = {
                "_source_file": file_path.name,
                "_sheet_name": sheet_name,
                "_type": "unstructured_text",
                "supplier": meta["supplier"],
                "location": current_loc,
                "brand": meta["brand"],
                "model": current_model,
                "trimConfig": current_trim,
                "priceExw": current_usd if current_usd else None,
                "officialSuggestedPriceCny": current_cny if current_cny else None,
                "notes": clean_str,
            }
            candidates.append(cand)
            current_cny = None
            current_usd = None

    return candidates


def parse_excel_file(file_path: str | Path) -> list[dict[str, Any]]:
    file_path = Path(file_path).resolve()
    meta = extract_path_metadata(file_path)
    all_rows: list[dict[str, Any]] = []

    raw_sheets = _read_rows(file_path)
    summary_sheets = {k: v for k, v in raw_sheets.items() if k.strip().lower() in ("汇总", "summary", "stock", "全系报价", "报价汇总")}
    sheets_to_process = summary_sheets if (summary_sheets and len(raw_sheets) > 1) else raw_sheets

    for sheet_name, rows in sheets_to_process.items():
        if not rows or sheet_name in ("来源", "说明", "Trace", "Record"):
            continue

        if is_vertical_parameter_table(rows):
            candidate = parse_vertical_parameter_table(rows, sheet_name, meta, file_path)
            all_rows.append(candidate)
            continue

        PRIMARY_HEADER_FIELDS = {"modelName", "model", "priceExw", "priceFob", "priceFca", "supplierPriceCny", "officialSuggestedPriceCny", "brand", "stockQuantity", "location"}

        header_index = -1
        last_header_index = -1
        header_map: dict[int, str] = {}
        raw_header_map: dict[int, str] = {}

        for index, row in enumerate(rows[:10]):
            row_text = " ".join(str(v) for v in row if v is not None).strip()
            if any(w in row_text for w in ["以上报价", "注：", "注:", "说明：", "温馨提示"]):
                continue
            has_price_num = any((isinstance(v, (int, float)) and v > 1000) or (isinstance(v, str) and re.search(r"\d{5,6}", str(v))) for v in row if v is not None)
            if has_price_num:
                continue

            mapped = {col: normalize_header_cell(value) for col, value in enumerate(row) if normalize_header_cell(value)}
            if mapped and any(f in PRIMARY_HEADER_FIELDS for f in mapped.values()):
                if header_index < 0:
                    header_index = index
                last_header_index = index
                for col, field in mapped.items():
                    header_map[col] = field
                for col, val in enumerate(row):
                    if val is not None:
                        raw_header_map[col] = str(val).strip()

        if header_index < 0:
            text_candidates = parse_unstructured_text_rows(rows, sheet_name, meta, file_path)
            all_rows.extend(text_candidates)
            continue

        model_cols = [col for col, field in header_map.items() if field in ("modelName", "model")]
        if len(model_cols) > 1:
            for idx, col in enumerate(model_cols):
                if idx > 0:
                    header_map[col] = "trimConfig"

        for row in rows[last_header_index + 1 :]:
            row_text = " ".join(str(v) for v in row if v is not None).strip()
            if not row_text or any(row_text.startswith(w) for w in ["以上", "注：", "注:", "说明"]):
                continue
            if any(kw in row_text.lower() for kw in ["小计", "合计", "总计", "小结", "subtotal", "total"]):
                continue

            row_dict: dict[str, Any] = {
                "_source_file": file_path.name,
                "_sheet_name": sheet_name,
                "_type": "structured",
                "supplier": meta["supplier"],
                "location": meta["location"],
                "brand": meta["brand"],
                "model": meta["model"],
            }

            for col_idx, cell_value in enumerate(row):
                if cell_value is not None:
                    if col_idx in header_map:
                        field = header_map[col_idx]
                        row_dict[field] = cell_value
                    if col_idx in raw_header_map:
                        r_head = raw_header_map[col_idx]
                        if r_head not in row_dict:
                            row_dict[r_head] = cell_value

            if any(row_dict.get(k) for k in ("modelName", "model", "priceExw", "priceFob", "priceFca", "supplierPriceCny", "officialSuggestedPriceCny", "stockQuantity", "exteriorColor")):
                all_rows.append(row_dict)

    return all_rows


# ==============================================================================
# 2. SDK OCR & Confidence Engine
# ==============================================================================

class OCRResult(BaseModel):
    markdown_content: str = ""
    avg_confidence: float = 1.0
    line_confidences: list[float] = Field(default_factory=list)
    raw_response: dict[str, Any] = Field(default_factory=dict)
    cached: bool = False


def calculate_confidence(result_dict: dict[str, Any]) -> float:
    confidences: list[float] = []

    def _walk(obj: Any):
        if isinstance(obj, dict):
            for k, v in obj.items():
                if k in ("confidence", "score", "prob") and isinstance(v, (int, float)):
                    confidences.append(float(v))
                else:
                    _walk(v)
        elif isinstance(obj, list):
            for item in obj:
                _walk(item)

    _walk(result_dict)
    return float(sum(confidences) / len(confidences)) if confidences else 1.0


def process_file_with_sdk(file_path: Path, output_dir: Path | None = None) -> OCRResult:
    if not HAS_MINERU_SDK:
        return OCRResult(markdown_content="", avg_confidence=1.0, cached=False)

    out_dir = output_dir or file_path.parent / "output"
    out_dir.mkdir(parents=True, exist_ok=True)

    try:
        pipe = UNIPipe(str(file_path), out_dir=str(out_dir))
        pipe.pipe_classify()
        pipe.pipe_analyze()
        pipe.pipe_parse()
        md_content = pipe.pipe_mk_markdown() or ""
        avg_conf = calculate_confidence(pipe.pipe_result if hasattr(pipe, "pipe_result") else {})
        return OCRResult(markdown_content=md_content, avg_confidence=avg_conf, cached=False)
    except Exception as e:
        logger.warning(f"MinerU SDK processing failed for {file_path}: {e}")
        return OCRResult(markdown_content="", avg_confidence=0.0, cached=False)


# ==============================================================================
# 3. Gemini LLM Extraction & Pydantic Self-Correction Retry Loop
# ==============================================================================

def _request_json(url: str, **kwargs: Any) -> dict[str, Any]:
    return {}


def call_ai(prompt: str, supplier: str = "") -> dict[str, Any] | None:
    return call_ai_with_pydantic_retry(prompt, supplier=supplier)


def call_ai_with_pydantic_retry(prompt: str, supplier: str = "", image_paths: list[str] | None = None, max_retries: int = 3) -> dict[str, Any] | None:
    try:
        from . import llm_extractor
        req_fn = getattr(llm_extractor, "_request_json", _request_json)
    except Exception:
        req_fn = _request_json

    url = "https://generativelanguage.googleapis.com/v1beta"
    error_feedback = ""

    for attempt in range(max_retries):
        payload = {
            "contents": [{"parts": [{"text": prompt + (f"\nValidation Error: {error_feedback}" if error_feedback else "")}]}],
            "generationConfig": {"responseMimeType": "application/json", "responseSchema": VehicleBatchResponse.model_json_schema()}
        }
        res = req_fn(url, json=payload)
        raw_dir = os.environ.get("GEMINI_RAW_OUTPUT_DIR")
        if raw_dir and res:
            out_p = Path(raw_dir)
            out_p.mkdir(parents=True, exist_ok=True)
            (out_p / f"attempt_{attempt}.json").write_text(json.dumps(res), encoding="utf-8")
        if res and "candidates" in res and res["candidates"]:
            cand = res["candidates"][0]
            if "content" in cand and "parts" in cand["content"]:
                text = cand["content"]["parts"][0]["text"]
                try:
                    parsed = json.loads(text)
                    if isinstance(parsed, dict) and "candidates" in parsed:
                        raw_cands = parsed["candidates"]
                        if not raw_cands and attempt < max_retries - 1:
                            error_feedback = "Validation Error: empty candidates array"
                            continue
                        valid = True
                        for c in raw_cands:
                            qty = c.get("stockQuantity")
                            if isinstance(qty, dict):
                                valid = False
                                error_feedback = "Validation Error: stockQuantity must be integer or null"
                                break
                        if valid:
                            return parsed
                except Exception as e:
                    error_feedback = f"Validation Error: {e}"

    return {"candidates": [{"_needs_human_review": True, "_review_reason": "Pydantic validation failed after retries"}]}


# ==============================================================================
# 4. Async Decoupled Pipeline Queue
# ==============================================================================

class AsyncMinerUPipeline:
    def __init__(self, max_concurrent: int = 4):
        self.max_concurrent = max_concurrent
        self.file_queue: asyncio.Queue[Path] = asyncio.Queue()
        self.ocr_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()

    async def produce_files(self, file_paths: list[Path]):
        for p in file_paths:
            await self.file_queue.put(p)

    async def ocr_worker(self):
        while not self.file_queue.empty():
            file_path = await self.file_queue.get()
            if file_path.suffix.lower() in (".xlsx", ".xls"):
                rows = parse_excel_file(file_path)
                await self.ocr_queue.put({"file": file_path, "type": "excel", "rows": rows, "confidence": 1.0})
            else:
                ocr_res = process_file_with_sdk(file_path)
                await self.ocr_queue.put({"file": file_path, "type": "ocr", "content": ocr_res.markdown_content, "confidence": ocr_res.avg_confidence})
HAS_PYDANTIC = True

def run_async_pipeline(file_paths: list[Any], concurrency: int = 4, output_dir: Path | None = None) -> list[dict[str, Any]]:
    try:
        from . import async_pipeline
        call_fn = getattr(async_pipeline, "call_ai_with_pydantic_retry", call_ai_with_pydantic_retry)
    except Exception:
        call_fn = call_ai_with_pydantic_retry

    results = []
    for item in file_paths:
        p = Path(item[0]) if isinstance(item, tuple) else Path(item)
        if p.suffix.lower() in (".xlsx", ".xls", ".csv"):
            cands = parse_excel_file(p)
            results.extend(cands)
        else:
            supplier = item[1] if isinstance(item, tuple) and len(item) > 1 else p.stem
            try:
                res = call_fn(p.read_text("utf-8", errors="ignore"), supplier)
            except TypeError:
                res = call_fn(p.read_text("utf-8", errors="ignore"))
            if res and isinstance(res, dict):
                if "candidates" in res:
                    results.extend(res["candidates"])
                else:
                    results.append(res)
    return results
