from __future__ import annotations

from pathlib import Path
import base64
from datetime import datetime
import hashlib
import json
import os
import re
from typing import Any

import requests


TERM_PATTERN = re.compile(r"\b(EXW|FCA|FOB|CIF|CNF)\b", re.I)
PROJECT_ROOT = Path(__file__).resolve().parents[2]


def get_api_config() -> dict[str, str | None]:
    provider = os.getenv("AI_PROVIDER", "gemini").strip().lower()
    if provider == "openrouter":
        return {
            "provider": "openrouter",
            "api_key": os.getenv("OPENROUTER_API_KEY"),
            "model": os.getenv("OPENROUTER_SOURCE_IMPORT_MODEL", "google/gemini-3.5-flash"),
            "base_url": os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
        }
    return {
        "provider": "gemini",
        "api_key": os.getenv("GEMINI_API_KEY"),
        "model": os.getenv("GEMINI_SOURCE_IMPORT_MODEL", "gemini-3.5-flash"),
        "base_url": "https://generativelanguage.googleapis.com/v1beta",
    }


def infer_supplier_from_path(filename: str) -> str:
    parts = Path(filename).stem.split("__")
    return parts[1] if len(parts) >= 2 else ""


def infer_brand_from_path(filename: str) -> str:
    return Path(filename).stem.split("__")[0]


def normalize_currency(value: Any, context: str = "") -> str:
    text = f"{value or ''} {context}".lower()
    if any(token in text for token in ("usd", "美金", "美元", "$")):
        return "USD"
    if any(token in text for token in ("rmb", "cny", "人民币")):
        return "CNY"
    price = to_number(value) or 0
    if price >= 50000:
        return "CNY"
    return "USD" if price > 0 else ""


def to_number(value: Any) -> float | None:
    if value in (None, ""):
        return None
    cleaned = re.sub(r"[^0-9.]", "", str(value))
    if not cleaned:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def extract_json_object(text: Any) -> dict[str, Any] | None:
    if isinstance(text, dict):
        return text
    value = str(text or "").strip()
    if not value:
        return None
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        fenced = re.search(r"```(?:json)?\s*([\s\S]*?)```", value, re.I)
        if fenced:
            return extract_json_object(fenced.group(1))
        start = value.find("{")
        end = value.rfind("}")
        if start >= 0 and end > start:
            try:
                return json.loads(value[start:end + 1])
            except json.JSONDecodeError:
                return None
    return None


def build_prompt(text: str, supplier_name: str = "", mode: str = "text") -> str:
    return "\n\n".join([
        "你是车源导入解析助手。请把供应商发来的车源资料解析为严格 JSON。",
        "只输出一个 JSON 对象，不要输出解释文字。顶层必须包含 candidates 数组。",
        "顶层格式必须是：{\"rawText\":\"\",\"parserNotes\":\"\",\"candidates\":[...]}。",
        "字段必须使用：brand, modelName, year, manufactureDate, trimName, exteriorColor, interiorColor, stockQuantity, priceExw, priceExwCurrency, priceFca, priceFcaCurrency, priceFob, priceFobCurrency, officialPrice, location, preorderMinDays, preorderMaxDays, canPreorder, notes, rawText, rawFields, confidence, uncertainFields。",
        "远程 V6E / V7E / V8E 必须映射为 Brand=Farizon，Model=V6E/V7E/V8E。EXW工厂列必须作为 priceExw，人民币语境输出 priceExwCurrency=CNY。MinerU table cell drift 时要区分座位数和电池。",
        "除品牌和车型规范化外，不得编造源文件不存在的数据，不得联网补全，不得汇率换算。",
        f"供应商：{supplier_name or '未知'}",
        f"解析模式：{mode}",
        f"原始文本：\n{text[:18000]}" if text else "",
    ])


def _request_json(url: str, **kwargs: Any) -> dict[str, Any]:
    response = requests.request(timeout=180, url=url, **kwargs)
    data = response.json() if response.text else {}
    if response.status_code >= 400:
        message = data.get("error", {}).get("message") or f"HTTP {response.status_code}"
        raise RuntimeError(message)
    return data


def _candidate_count(result: dict[str, Any] | None) -> int:
    candidates = (result or {}).get("candidates", [])
    return len(candidates) if isinstance(candidates, list) else 0


def _raw_output_dir() -> Path:
    configured = os.getenv("GEMINI_RAW_OUTPUT_DIR")
    return Path(configured) if configured else PROJECT_ROOT / "output" / "final" / "gemini_raw"


def _write_ai_raw_response(result: dict[str, Any] | None, supplier_name: str, attempt: int, prompt: str) -> None:
    output_dir = _raw_output_dir()
    output_dir.mkdir(parents=True, exist_ok=True)
    safe_supplier = re.sub(r"[^A-Za-z0-9._-]+", "_", supplier_name or "unknown").strip("_") or "unknown"
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    prompt_hash = hashlib.sha256(prompt.encode("utf-8")).hexdigest()[:12]
    payload = {
        "created_at": datetime.now().isoformat(),
        "supplier": supplier_name,
        "attempt": attempt,
        "prompt_hash": prompt_hash,
        "candidate_count": _candidate_count(result),
        "response": result,
    }
    path = output_dir / f"{timestamp}_{safe_supplier}_attempt{attempt}_{prompt_hash}.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), "utf-8")


def _extract_gemini_result(data: dict[str, Any]) -> dict[str, Any] | None:
    return extract_json_object(data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", ""))


def _extract_openrouter_result(data: dict[str, Any]) -> dict[str, Any] | None:
    return extract_json_object(data.get("choices", [{}])[0].get("message", {}).get("content", ""))


def call_ai(text: str, supplier_name: str = "") -> dict[str, Any] | None:
    config = get_api_config()
    if not config["api_key"]:
        raise RuntimeError("未设置 API Key。请在 .env 中设置 GEMINI_API_KEY 或 OPENROUTER_API_KEY")
    prompt = build_prompt(text, supplier_name, "text")
    empty_retries = int(os.getenv("GEMINI_EMPTY_RETRIES", "2") or "2")
    last_result: dict[str, Any] | None = None
    for attempt in range(1, empty_retries + 2):
        if config["provider"] == "gemini":
            url = f"{config['base_url']}/models/{config['model']}:generateContent?key={config['api_key']}"
            data = _request_json(
                url,
                method="POST",
                headers={"Content-Type": "application/json"},
                json={"contents": [{"parts": [{"text": prompt}]}], "generationConfig": {"responseMimeType": "application/json", "temperature": 0.1}},
            )
            result = _extract_gemini_result(data)
        else:
            url = f"{config['base_url']}/chat/completions"
            data = _request_json(
                url,
                method="POST",
                headers={"Authorization": f"Bearer {config['api_key']}", "Content-Type": "application/json"},
                json={"model": config["model"], "messages": [{"role": "user", "content": [{"type": "text", "text": prompt}]}], "max_tokens": 5000, "response_format": {"type": "json_object"}},
            )
            result = _extract_openrouter_result(data)
        _write_ai_raw_response(result, supplier_name, attempt, prompt)
        last_result = result
        if _candidate_count(result) > 0:
            return result
    return last_result


def call_ai_vision_fallback(file_path: Path, supplier_name: str = "") -> dict[str, Any] | None:
    config = get_api_config()
    if not config["api_key"]:
        raise RuntimeError("未设置 API Key。请在 .env 中设置 GEMINI_API_KEY 或 OPENROUTER_API_KEY")
    ext = file_path.suffix.lower()
    mime = {".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif"}.get(ext)
    if not mime:
        raise RuntimeError(f"Vision fallback does not support file type: {ext}")
    prompt = build_prompt("MinerU 识别失败。用户已确认使用视觉大模型兜底识别此附件内容。", supplier_name, f"vision_fallback_user_approved ({ext})")
    payload = base64.b64encode(file_path.read_bytes()).decode("ascii")
    if config["provider"] != "gemini":
        raise RuntimeError("OpenRouter vision fallback is not enabled in the Python pipeline")
    url = f"{config['base_url']}/models/{config['model']}:generateContent?key={config['api_key']}"
    data = _request_json(
        url,
        method="POST",
        headers={"Content-Type": "application/json"},
        json={"contents": [{"parts": [{"text": prompt}, {"inlineData": {"mimeType": mime, "data": payload}}]}], "generationConfig": {"responseMimeType": "application/json", "temperature": 0.1}},
    )
    return extract_json_object(data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", ""))


def post_process_candidate(candidate: dict[str, Any], supplier_name: str = "", brand_hint: str = "") -> dict[str, Any]:
    if not candidate.get("brand") and brand_hint:
        candidate["brand"] = brand_hint
    if not candidate.get("supplierName") and supplier_name:
        candidate["supplierName"] = supplier_name
    for key in ("priceExw", "priceFob", "priceFca"):
        currency_key = f"{key}Currency"
        if candidate.get(key) and not candidate.get(currency_key):
            candidate[currency_key] = normalize_currency(candidate.get(key), json.dumps(candidate, ensure_ascii=False))
    return candidate


def process_ocr_output(ocr_file_path: Path, source_file_name: str = "") -> list[dict[str, Any]]:
    content = ocr_file_path.read_text("utf-8")
    if not content.strip():
        return []
    supplier = infer_supplier_from_path(source_file_name or ocr_file_path.name)
    brand = infer_brand_from_path(source_file_name or ocr_file_path.name)
    result = call_ai(content, supplier)
    return [post_process_candidate(c, supplier, brand) for c in (result or {}).get("candidates", [])]


def process_text_file(text_file_path: Path) -> list[dict[str, Any]]:
    content = text_file_path.read_text("utf-8")
    if len(content.strip()) < 5:
        return []
    supplier = infer_supplier_from_path(text_file_path.name)
    brand = infer_brand_from_path(text_file_path.name)
    result = call_ai(content, supplier)
    return [post_process_candidate(c, supplier, brand) for c in (result or {}).get("candidates", [])]


def process_vision_fallback_file(file_path: Path) -> list[dict[str, Any]]:
    supplier = infer_supplier_from_path(file_path.name)
    brand = infer_brand_from_path(file_path.name)
    result = call_ai_vision_fallback(file_path, supplier)
    rows = [post_process_candidate(c, supplier, brand) for c in (result or {}).get("candidates", [])]
    for row in rows:
        row["_recognition_warning"] = "vision_fallback_user_approved"
    return rows
