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
TABLE_BLOCK_PATTERN = re.compile(r"<table[\s\S]*?</table>", re.I)


def get_api_config() -> dict[str, str | None]:
    provider = os.getenv("AI_PROVIDER", "deepseek").strip().lower()
    if provider == "deepseek":
        return {
            "provider": "deepseek",
            "api_key": os.getenv("DEEPSEEK_API_KEY"),
            "model": os.getenv("DEEPSEEK_SOURCE_IMPORT_MODEL", "deepseek-v4-pro"),
            "base_url": os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
        }
    if provider == "openrouter":
        return {
            "provider": "openrouter",
            "api_key": os.getenv("OPENROUTER_API_KEY"),
            "model": os.getenv("OPENROUTER_SOURCE_IMPORT_MODEL", "nvidia/nemotron-3-ultra-550b-a55b:free"),
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


def _llm_chunk_limit() -> int:
    raw = os.getenv("LLM_CHUNK_CHARS", "18000")
    try:
        return max(50, int(raw))
    except ValueError:
        return 18000


def _llm_max_tokens(provider: str) -> int:
    raw = os.getenv("LLM_MAX_TOKENS")
    if raw:
        try:
            return max(1000, int(raw))
        except ValueError:
            pass
    return 16000 if provider == "deepseek" else 5000


def chunk_text_for_extraction(text: str, max_chars: int | None = None) -> list[str]:
    limit = max_chars or _llm_chunk_limit()
    if len(text) <= limit:
        return [text]

    blocks: list[str] = []
    cursor = 0
    for match in TABLE_BLOCK_PATTERN.finditer(text):
        prefix = text[cursor:match.start()]
        blocks.extend(part for part in re.split(r"\n{2,}", prefix) if part.strip())
        blocks.append(match.group(0))
        cursor = match.end()
    blocks.extend(part for part in re.split(r"\n{2,}", text[cursor:]) if part.strip())

    chunks: list[str] = []
    current = ""
    for block in blocks:
        if not current:
            current = block
            continue
        next_chunk = f"{current}\n\n{block}"
        if len(next_chunk) <= limit:
            current = next_chunk
        else:
            chunks.append(current)
            current = block
    if current:
        chunks.append(current)
    return chunks


def build_prompt(text: str, supplier_name: str = "", mode: str = "text") -> str:
    return "\n\n".join([
        "你是车源导入解析助手。请把供应商发来的车源资料解析为严格 JSON。",
        "你的职责是事实提取：尽量按源文本字面提取字段，不做车型库匹配、品牌别名修正、汇率换算或外部资料补全。后续代码会负责业务规范化。",
        "输出契约：只能输出一个可被 json.loads 直接解析的 JSON 对象；不要使用 Markdown 代码块；不要输出解释文字、前言、结尾、注释或多余字符。",
        "禁止输出 null 作为顶层结果。即使无法提取任何车源，也必须输出：{\"rawText\":\"\",\"parserNotes\":\"无法从输入中识别车源候选\",\"candidates\":[]}。",
        "顶层格式必须是：{\"rawText\":\"\",\"parserNotes\":\"\",\"candidates\":[]}，其中 candidates 必须永远是数组，不能是 null、字符串或对象。",
        "每个 candidate 必须包含完整字段集合：brand, modelName, year, manufactureDate, trimName, exteriorColor, interiorColor, stockQuantity, priceExw, priceExwCurrency, priceFca, priceFcaCurrency, priceFob, priceFobCurrency, officialPrice, location, preorderMinDays, preorderMaxDays, canPreorder, notes, rawText, rawFields, confidence, uncertainFields。",
        "字段缺失时用 null；文本字段保留源文本；数字字段只填数字；currency 字段只能填 CNY、USD 或 null；confidence 填 0 到 1 的数字；uncertainFields 必须是字符串数组。",
        "MinerU 可能输出 HTML <table> 或 Markdown 表格。请按表头和单元格相对位置解析；rowspan/colspan 表示上方或左侧字段延续到后续行。",
        "表格解析规则：逐行读取 table；跳过合计、更多车型、标题、空行等非具体车源行；跨行地点必须复制到覆盖范围内的每个 candidate。",
        "如果一个颜色单元格包含多组数量+颜色组合，例如 `20白/灰+10灰/灰`，请拆成多条 candidates，并复制同一行的车型、价格、地点等字段。",
        "如果一个地点单元格跨多行，例如 `<td rowspan=\"10\">霍尔果斯基地</td>`，该地点适用于它覆盖的所有候选行。",
        "价格列名包含 EXW/FCA/FOB/CIF 和 usd/cny 时，必须写到对应 price* 与 price*Currency 字段；不要把官方指导价误写为成本价。",
        "Few-shot 示例：输入行 `<tr><td rowspan=\"2\">霍尔果斯基地</td><td>车型A</td><td>¥79,800</td><td>2026年5月</td><td>30</td><td>20白/灰+10灰/灰</td><td>赠送卡片钥匙</td><td>/</td><td>现车</td><td>9250</td></tr>` 必须拆成两个 candidates，第一条 stockQuantity=20 exteriorColor=\"白\" interiorColor=\"灰\" priceFca=9250 priceFcaCurrency=\"USD\" location=\"霍尔果斯基地\"；第二条 stockQuantity=10 exteriorColor=\"灰\" interiorColor=\"灰\"，其他字段复制。",
        "输出样例模板只用于说明字段形状，不要复制样例内容：{\"rawText\":\"源表片段\",\"parserNotes\":\"逐行解析 table，按颜色数量拆分，跳过合计行\",\"candidates\":[{\"brand\":null,\"modelName\":\"海狮05EV 520旗智航版-国际版国内车型\",\"year\":null,\"manufactureDate\":\"2026年7月\",\"trimName\":null,\"exteriorColor\":\"暖阳白\",\"interiorColor\":\"黑\",\"stockQuantity\":3,\"priceExw\":null,\"priceExwCurrency\":null,\"priceFca\":9250,\"priceFcaCurrency\":\"USD\",\"priceFob\":null,\"priceFobCurrency\":null,\"officialPrice\":137800,\"location\":\"霍尔果斯基地\",\"preorderMinDays\":null,\"preorderMaxDays\":null,\"canPreorder\":true,\"notes\":\"赠送卡片钥匙 | 7月交付\",\"rawText\":\"海狮05EV...3暖阳白/黑...7月交付...9250\",\"rawFields\":{},\"confidence\":0.95,\"uncertainFields\":[]}]}。",
        "为避免输出过长：candidate.rawText 只保留不超过 80 个字符的原始证据片段；candidate.rawFields 默认输出空对象 {}，除非某字段确实不确定，最多保留 3 个关键源字段。",
        "交付说明必须保留到 notes：例如 `7月交付`、`5月底排产`、`6-8周`、`6月底7月初交付`、`国际版海外车型` 都属于源表事实，不能丢弃。",
        "日期范围或多月份不要改写成单日：例如 `2025年10月/11月` 必须原样放入 manufactureDate，不要改成 `2025-10-01` 或 `2025-10-11`。",
        "不要改写车型名中的空格、连字符、大小写：例如 `海狮 07EV`、`海狮06 DMI`、`DM-i`、`BYD SHARK 6 PREMIUM 左舵国标` 应按源文本保留。",
        "自检：输出前确认 candidates 数量等于表格具体车源行按颜色数量拆分后的数量；每条 candidate 都必须有完整字段；源表中出现的价格、数量、地点、颜色、生产日期、赠送、备注、交付说明不能遗漏。",
        "如果价格列是 `FCA提货价 usd`，只填写 priceFca 和 priceFcaCurrency=\"USD\"，不要同时填写 priceExw 或 priceFob。",
        "不得编造源文件不存在的数据，不得联网补全，不得汇率换算。",
        f"供应商：{supplier_name or '未知'}",
        f"解析模式：{mode}",
        f"原始文本：\n{text}" if text else "",
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
    configured = os.getenv("LLM_RAW_OUTPUT_DIR") or os.getenv("GEMINI_RAW_OUTPUT_DIR")
    return Path(configured) if configured else PROJECT_ROOT / "output" / "final" / "llm_raw"


def _write_ai_raw_response(
    result: dict[str, Any] | None,
    supplier_name: str,
    attempt: int,
    prompt: str,
    provider: str | None = None,
    api_response: dict[str, Any] | None = None,
    raw_message_text: str | None = None,
) -> None:
    output_dir = _raw_output_dir()
    output_dir.mkdir(parents=True, exist_ok=True)
    safe_supplier = re.sub(r"[^A-Za-z0-9._-]+", "_", supplier_name or "unknown").strip("_") or "unknown"
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    prompt_hash = hashlib.sha256(prompt.encode("utf-8")).hexdigest()[:12]
    payload = {
        "created_at": datetime.now().isoformat(),
        "supplier": supplier_name,
        "provider": provider,
        "attempt": attempt,
        "prompt_hash": prompt_hash,
        "candidate_count": _candidate_count(result),
        "response": result,
        "raw_message_text": raw_message_text,
        "api_response": api_response,
    }
    path = output_dir / f"{timestamp}_{safe_supplier}_attempt{attempt}_{prompt_hash}.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), "utf-8")


def _extract_gemini_result(data: dict[str, Any]) -> dict[str, Any] | None:
    return extract_json_object(data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", ""))


def _extract_openrouter_result(data: dict[str, Any]) -> dict[str, Any] | None:
    return extract_json_object(data.get("choices", [{}])[0].get("message", {}).get("content", ""))


def _extract_chat_completion_result(data: dict[str, Any]) -> dict[str, Any] | None:
    return extract_json_object(data.get("choices", [{}])[0].get("message", {}).get("content", ""))


def _raw_gemini_text(data: dict[str, Any]) -> str:
    return str(data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", ""))


def _raw_chat_completion_text(data: dict[str, Any]) -> str:
    return str(data.get("choices", [{}])[0].get("message", {}).get("content", ""))


def call_ai(text: str, supplier_name: str = "") -> dict[str, Any] | None:
    config = get_api_config()
    if not config["api_key"]:
        raise RuntimeError("未设置 API Key。请在 .env 中设置 DEEPSEEK_API_KEY、GEMINI_API_KEY 或 OPENROUTER_API_KEY")
    prompt = build_prompt(text, supplier_name, "text")
    empty_retries = int(os.getenv("LLM_EMPTY_RETRIES") or os.getenv("GEMINI_EMPTY_RETRIES", "2") or "2")
    max_tokens = _llm_max_tokens(str(config["provider"]))
    last_result: dict[str, Any] | None = None
    for attempt in range(1, empty_retries + 2):
        if config["provider"] == "deepseek":
            url = f"{config['base_url']}/chat/completions"
            data = _request_json(
                url,
                method="POST",
                headers={"Authorization": f"Bearer {config['api_key']}", "Content-Type": "application/json"},
                json={
                    "model": config["model"],
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": max_tokens,
                    "response_format": {"type": "json_object"},
                    "thinking": {"type": "disabled"},
                },
            )
            raw_message_text = _raw_chat_completion_text(data)
            result = _extract_chat_completion_result(data)
        elif config["provider"] == "gemini":
            url = f"{config['base_url']}/models/{config['model']}:generateContent?key={config['api_key']}"
            data = _request_json(
                url,
                method="POST",
                headers={"Content-Type": "application/json"},
                json={"contents": [{"parts": [{"text": prompt}]}], "generationConfig": {"responseMimeType": "application/json", "temperature": 0.1}},
            )
            raw_message_text = _raw_gemini_text(data)
            result = _extract_gemini_result(data)
        else:
            url = f"{config['base_url']}/chat/completions"
            data = _request_json(
                url,
                method="POST",
                headers={"Authorization": f"Bearer {config['api_key']}", "Content-Type": "application/json"},
                json={"model": config["model"], "messages": [{"role": "user", "content": [{"type": "text", "text": prompt}]}], "max_tokens": max_tokens, "response_format": {"type": "json_object"}},
            )
            raw_message_text = _raw_chat_completion_text(data)
            result = _extract_openrouter_result(data)
        _write_ai_raw_response(
            result,
            supplier_name,
            attempt,
            prompt,
            provider=str(config["provider"]),
            api_response=data,
            raw_message_text=raw_message_text,
        )
        last_result = result
        if _candidate_count(result) > 0:
            return result
    return last_result


def call_ai_vision_fallback(file_path: Path, supplier_name: str = "") -> dict[str, Any] | None:
    config = get_api_config()
    if not config["api_key"]:
        raise RuntimeError("未设置 API Key。请在 .env 中设置 DEEPSEEK_API_KEY、GEMINI_API_KEY 或 OPENROUTER_API_KEY")
    ext = file_path.suffix.lower()
    mime = {".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif"}.get(ext)
    if not mime:
        raise RuntimeError(f"Vision fallback does not support file type: {ext}")
    prompt = build_prompt("MinerU 识别失败。用户已确认使用视觉大模型兜底识别此附件内容。", supplier_name, f"vision_fallback_user_approved ({ext})")
    payload = base64.b64encode(file_path.read_bytes()).decode("ascii")
    if config["provider"] != "gemini":
        raise RuntimeError("Vision fallback is only enabled for Gemini in the Python pipeline")
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
    rows: list[dict[str, Any]] = []
    chunks = chunk_text_for_extraction(content)
    for index, chunk in enumerate(chunks, 1):
        result = call_ai(chunk, supplier)
        for candidate in (result or {}).get("candidates", []):
            candidate["_chunk_index"] = index
            candidate["_chunk_count"] = len(chunks)
            rows.append(post_process_candidate(candidate, supplier, brand))
    return rows


def process_text_file(text_file_path: Path) -> list[dict[str, Any]]:
    content = text_file_path.read_text("utf-8")
    if len(content.strip()) < 5:
        return []
    supplier = infer_supplier_from_path(text_file_path.name)
    brand = infer_brand_from_path(text_file_path.name)
    rows: list[dict[str, Any]] = []
    chunks = chunk_text_for_extraction(content)
    for index, chunk in enumerate(chunks, 1):
        result = call_ai(chunk, supplier)
        for candidate in (result or {}).get("candidates", []):
            candidate["_chunk_index"] = index
            candidate["_chunk_count"] = len(chunks)
            rows.append(post_process_candidate(candidate, supplier, brand))
    return rows


def process_vision_fallback_file(file_path: Path) -> list[dict[str, Any]]:
    supplier = infer_supplier_from_path(file_path.name)
    brand = infer_brand_from_path(file_path.name)
    result = call_ai_vision_fallback(file_path, supplier)
    rows = [post_process_candidate(c, supplier, brand) for c in (result or {}).get("candidates", [])]
    for row in rows:
        row["_recognition_warning"] = "vision_fallback_user_approved"
    return rows
