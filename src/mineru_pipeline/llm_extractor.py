from __future__ import annotations

from pathlib import Path
import base64
from datetime import datetime
import hashlib
import json
import os
import re
import time
import logging
from typing import Any

import requests
from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(PROJECT_ROOT / ".env", override=False)

logger = logging.getLogger("mineru_pipeline.llm_extractor")

try:
    from pydantic import BaseModel, Field, ValidationError
    HAS_PYDANTIC = True
except ImportError:
    HAS_PYDANTIC = False

TERM_PATTERN = re.compile(r"\b(EXW|FCA|FOB|CIF|CNF)\b", re.I)
PROJECT_ROOT = Path(__file__).resolve().parents[2]

from mineru_pipeline.schema import get_pydantic_vehicle_schema

if HAS_PYDANTIC:
    VehicleCandidateSchema = get_pydantic_vehicle_schema()

    class ExtractionPayloadSchema(BaseModel):
        rawText: str | None = Field(default="")
        parserNotes: str | None = Field(default="")
        candidates: list[VehicleCandidateSchema] = Field(default_factory=list)


def get_api_config() -> dict[str, str | None]:
    model = (
        os.getenv("PARSE_MODEL")
        or os.getenv("EXTRACT_MODEL")
        or os.getenv("IMPORT_MODEL")
        or os.getenv("OPENROUTER_SOURCE_IMPORT_MODEL")
        or os.getenv("OPENROUTER_MODEL")
        or os.getenv("GEMINI_SOURCE_IMPORT_MODEL", "minimax-m3")
    )
    api_key = (
        os.getenv("API_KEY")
        or os.getenv("OPENROUTER_API_KEY")
        or os.getenv("GEMINI_API_KEY")
        or os.getenv("OLLAMA_API_KEY")
    )
    base_url = (
        os.getenv("BASE_URL")
        or os.getenv("OPENROUTER_BASE_URL")
        or "https://ollama.com/v1"
    )
    is_gemini_native = "generativelanguage.googleapis.com" in base_url
    return {
        "provider": "gemini" if is_gemini_native else "openai",
        "api_key": api_key,
        "model": model,
        "base_url": base_url,
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


def validate_with_pydantic(data: dict[str, Any]) -> tuple[bool, str]:
    if not HAS_PYDANTIC or not data:
        return True, ""
    try:
        ExtractionPayloadSchema.model_validate(data)
        return True, ""
    except ValidationError as e:
        return False, str(e)


def build_prompt(text: str, supplier_name: str = "", mode: str = "text", error_feedback: str = "") -> str:
    parts = [
        "You are an AI vehicle data extraction assistant. Parse the source data into strict JSON.",
        "Output ONLY a valid JSON object without any explanatory text. The root object MUST contain a 'candidates' array.",
        "Root format: {\"rawText\":\"\",\"parserNotes\":\"\",\"candidates\":[...]}",
        "Allowed candidate fields: brand, modelName, year, manufactureDate, trimName, exteriorColor, interiorColor, stockQuantity, minQuantity, maxQuantity, steeringSetup, marketRegion, orderWaitingPeriod, costExwUsd, costFcaUsd, costFobUsd, officialPriceCny, location, notes.",
        "【STRICT REQUIREMENT: ALL OUTPUT VALUES MUST BE IN ENGLISH】",
        "- All text values (brand, modelName, trimName, exteriorColor, interiorColor, location, notes) MUST be in ENGLISH.",
        "- Translate Chinese colors to English: 白->White, 黑->Black, 灰->Grey, 银->Silver, 蓝->Blue, 红->Red, 金->Gold, 绿->Green, etc.",
        "- Canonical Brand & Model English names:",
        "  * 方程豹 豹3/5/7/8, 钛3/7 -> Brand: Fangchengbao, Model: Ti 3 / Leopard 5 / Ti 7 / Leopard 8",
        "  * 比亚迪 海鸥/海豚/汉/秦/海豹/海狮 -> Brand: BYD, Model: Seagull / Dolphin / Han EV / Qin PLUS EV / Seal / Sealion 7",
        "  * 问界 M9 -> Brand: AITO, Model: M9",
        "  * 深蓝 S05/S07 -> Brand: Deepal, Model: S05 / S07",
        "  * 启源 Q05 -> Brand: Changan Nevo, Model: Q05",
        "  * 远程 -> Brand: Farizon",
        "  * 吉利 -> Brand: Geely",
        "  * 极氪 -> Brand: Zeekr",
        "  * 零跑 -> Brand: Leapmotor",
        "  * 小米 -> Brand: Xiaomi",
        "Cost prices MUST be extracted as USD numbers (costExwUsd, costFcaUsd, costFobUsd). officialPriceCny is for domestic CNY MSRP.",
        "Do NOT invent unmentioned data.",
        f"Supplier: {supplier_name or 'Unknown'}",
        f"Parse mode: {mode}",
    ]
    if error_feedback:
        parts.append(f"🚨 Previous validation failed, please fix the following error:\n{error_feedback}")
    if text:
        parts.append(f"Raw source text:\n{text[:18000]}")
    return "\n\n".join(parts)


def _request_json(url: str, **kwargs: Any) -> dict[str, Any]:
    max_retries = 5
    for attempt in range(1, max_retries + 1):
        try:
            response = requests.request(timeout=180, url=url, **kwargs)
            data = response.json() if response.text else {}
            if response.status_code >= 400:
                err_info = data.get("error") if isinstance(data, dict) else str(data)
                if isinstance(err_info, dict):
                    message = err_info.get("message") or str(err_info)
                else:
                    message = str(err_info) or f"HTTP {response.status_code}"
                raise RuntimeError(message)
            return data
        except (requests.exceptions.RequestException, RuntimeError) as e:
            if attempt == max_retries:
                logger.error(f"HTTP Request failed after {max_retries} attempts: {e}")
                raise
            sleep_sec = 4 * attempt
            logger.warning(f"HTTP Request attempt {attempt} failed ({e}), retrying in {sleep_sec}s...")
            time.sleep(sleep_sec)
    return {}


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
    if not isinstance(data, dict):
        return None
    if "candidates" in data and isinstance(data.get("candidates"), list) and data["candidates"] and isinstance(data["candidates"][0], dict) and "content" in data["candidates"][0]:
        return extract_json_object(data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", ""))
    if "choices" in data:
        return _extract_openrouter_result(data)
    return extract_json_object(data)


def _extract_openrouter_result(data: dict[str, Any]) -> dict[str, Any] | None:
    if not isinstance(data, dict):
        return None
    if "choices" in data and isinstance(data.get("choices"), list) and data["choices"]:
        return extract_json_object(data.get("choices", [{}])[0].get("message", {}).get("content", ""))
    if "candidates" in data:
        return _extract_gemini_result(data)
    return extract_json_object(data)


def _clean_schema_for_gemini(schema: dict[str, Any]) -> dict[str, Any]:
    schema_copy = json.loads(json.dumps(schema))
    defs = schema_copy.pop("$defs", {})

    def resolve(obj: Any) -> Any:
        if isinstance(obj, dict):
            if "$ref" in obj:
                ref_key = obj["$ref"].split("/")[-1]
                if ref_key in defs:
                    resolved = resolve(defs[ref_key])
                    res = {**resolved}
                    for k, v in obj.items():
                        if k != "$ref":
                            res[k] = resolve(v)
                    return res
            return {k: resolve(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [resolve(item) for item in obj]
        return obj

    return resolve(schema_copy)


def call_ai_with_pydantic_retry(text: str, supplier_name: str = "", max_retries: int = 3) -> dict[str, Any] | None:
    config = get_api_config()
    if not config["api_key"] and config["provider"] not in ("ollama", "vllm"):
        raise RuntimeError("未设置 API Key。请在 .env 中设置 API_KEY, GEMINI_API_KEY 或 OPENROUTER_API_KEY")
    last_result: dict[str, Any] | None = None
    error_feedback = ""

    generation_config: dict[str, Any] = {
        "responseMimeType": "application/json",
        "temperature": 0.0
    }
    if HAS_PYDANTIC:
        generation_config["responseSchema"] = _clean_schema_for_gemini(ExtractionPayloadSchema.model_json_schema())

    for attempt in range(1, max_retries + 1):
        prompt = build_prompt(text, supplier_name, "text", error_feedback=error_feedback)
        try:
            if config["provider"] == "gemini":
                url = f"{config['base_url']}/models/{config['model']}:generateContent?key={config['api_key']}"
                data = _request_json(
                    url,
                    method="POST",
                    headers={"Content-Type": "application/json"},
                    json={"contents": [{"parts": [{"text": prompt}]}], "generationConfig": generation_config},
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
        except Exception as e:
            logger.error(f"API request failed for {supplier_name} (Attempt {attempt}/{max_retries}): {e}")
            result = None

        _write_ai_raw_response(result, supplier_name, attempt, prompt)
        last_result = result

        if result and _candidate_count(result) > 0:
            is_valid, err_msg = validate_with_pydantic(result)
            if is_valid:
                return result
            else:
                error_feedback = f"Validation Error on previous output:\n{err_msg}"
                print(f"⚠️ Pydantic validation error (Attempt {attempt}): {err_msg[:100]}...")

    if last_result and isinstance(last_result.get("candidates"), list):
        for cand in last_result["candidates"]:
            if isinstance(cand, dict):
                cand["_needs_human_review"] = True
                cand["_review_reason"] = "Pydantic validation failed after retries"

    return last_result


def call_ai(text: str, supplier_name: str = "") -> dict[str, Any] | None:
    empty_retries = int(os.getenv("GEMINI_EMPTY_RETRIES", "2") or "2")
    return call_ai_with_pydantic_retry(text, supplier_name, max_retries=empty_retries + 1)


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


def check_mineru_confidence(ocr_file_path: Path) -> float | None:
    """Check MinerU middle.json for OCR confidence score if present."""
    middle_json_path = ocr_file_path.with_name(f"{ocr_file_path.stem}_middle.json")
    if not middle_json_path.exists():
        return None
    try:
        data = json.loads(middle_json_path.read_text(encoding="utf-8"))
        confidences = []
        for page in data.get("pdf_info", []):
            for block in page.get("blocks", []):
                if "lines" in block:
                    for line in block["lines"]:
                        if "confidence" in line:
                            confidences.append(float(line["confidence"]))
        return sum(confidences) / len(confidences) if confidences else None
    except Exception:
        return None


def post_process_candidate(candidate: dict[str, Any], supplier_name: str = "", brand_hint: str = "", min_confidence: float | None = None) -> dict[str, Any]:
    if not candidate.get("brand") and brand_hint:
        candidate["brand"] = brand_hint
    if not candidate.get("supplierName") and supplier_name:
        candidate["supplierName"] = supplier_name
    for key in ("priceExw", "priceFob", "priceFca"):
        currency_key = f"{key}Currency"
        if candidate.get(key) and not candidate.get(currency_key):
            candidate[currency_key] = normalize_currency(candidate.get(key), json.dumps(candidate, ensure_ascii=False))
    
    if min_confidence is not None and min_confidence < 0.6:
        candidate["_needs_human_review"] = True
        candidate["_review_reason"] = f"MinerU OCR 低置信度警告 (avg confidence: {min_confidence:.2f})"

    return candidate


def process_ocr_output(ocr_file_path: Path, source_file_name: str = "") -> list[dict[str, Any]]:
    content = ocr_file_path.read_text("utf-8")
    if not content.strip():
        return []
    supplier = infer_supplier_from_path(source_file_name or ocr_file_path.name)
    brand = infer_brand_from_path(source_file_name or ocr_file_path.name)
    confidence = check_mineru_confidence(ocr_file_path)
    result = call_ai(content, supplier)
    return [post_process_candidate(c, supplier, brand, confidence) for c in (result or {}).get("candidates", [])]


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
