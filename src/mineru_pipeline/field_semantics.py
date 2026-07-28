from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
import re
from typing import Iterable


class TextRole(str, Enum):
    MODEL_FAMILY = "model_family"
    SALES_VARIANT = "sales_variant"
    BODY_STRUCTURE = "body_structure"
    POWER_BATTERY = "power_battery"
    PRICE = "price"
    LOCATION = "location"
    STOCK_COLOR = "stock_color"
    SPEC_BLOB = "spec_blob"
    ANNOUNCEMENT_CODE = "announcement_code"
    DUPLICATE_MODEL = "duplicate_model"


@dataclass(frozen=True)
class SemanticIssue:
    field: str
    code: str
    message: str


MODEL_ALIASES: dict[str, tuple[str, ...]] = {
    "Q05": ("启源Q05",),
    "Qiyuan A06": ("启源A06",),
    "Qiyuan A07": ("启源A07",),
    "Qiyuan Q07": ("启源Q07",),
    "BYD E7": ("比亚迪 E7", "比亚迪E7"),
    "Cowboy": ("吉利牛仔", "全新牛仔"),
    "Eado 460": ("逸动460", "第四代逸动"),
    "L6": ("IM L6", "智己L6"),
    "LS6": ("IM LS6", "智己LS6"),
    "Shark": ("鲨鱼皮卡", "比亚迪鲨鱼", "BYD Shark"),
    "Seagull": ("海鸥",),
    "Sealion 05 EV": ("海狮05EV", "海狮05 EV"),
    "Sealion 06 EV": ("海狮06EV", "海狮06 EV"),
    "Sealion 06 DM-i": ("海狮06DM-i", "海狮06DMI", "海狮06 DM-i"),
    "Sealion 7": ("海狮07EV", "海狮07 EV", "海狮07"),
}

GENERIC_MODEL_PATTERNS: tuple[tuple[str, str], ...] = (
    (r"五菱荣光新卡", "五菱荣光新卡"),
    (r"五菱之光EV", "五菱之光EV"),
    (r"五菱扬光电卡", "五菱扬光电卡"),
    (r"\bQiyuan\s+A06\b|启源\s*A06", "Qiyuan A06"),
    (r"\bQiyuan\s+A07\b|启源\s*A07", "Qiyuan A07"),
    (r"\bQiyuan\s+Q07\b|启源\s*Q07", "Qiyuan Q07"),
    (r"\bQ05\b|启源\s*Q05", "Q05"),
    (r"\bL06\b", "L06"),
    (r"\bLumin\b", "Lumin"),
    (r"\bS05\b", "S05"),
    (r"\bS07\b", "S07"),
    (r"\bS09\b", "S09"),
    (r"\b(Max|Ultra)\b", "{match}"),
    (r"\b(?:IM\s*)?(L6|LS6)\b", "{upper_match}"),
    (r"\b(SU7|YU7)\b", "{upper_match}"),
    (r"吉利牛仔|全新牛仔|\bCowboy\b", "Cowboy"),
    (r"Galaxy\s+Xingyao\s+\d+", "{match_title}"),
    (r"Galaxy\s+[A-Za-z]+\s*\d+|Galaxy\s+[A-Z]\d+", "{match_title}"),
    (r"\b(V6E|V7E|V8E|SV)\b", "{upper_match}"),
    (r"海狮05\s*EV|海狮05EV|Sealion\s*05\s*EV", "Sealion 05 EV"),
    (r"海狮06\s*EV|海狮06EV|Sealion\s*06\s*EV", "Sealion 06 EV"),
    (r"海狮06\s*DMI|海狮06DMI|Sealion\s*06\s*DM-?i", "Sealion 06 DM-i"),
    (r"海狮07\s*EV|海狮07EV|Sealion\s*7\s*EV|Sealion\s*7", "Sealion 7"),
    (r"驱逐舰05|Destroyer\s*05", "Destroyer 05"),
    (r"钛3|Tai\s*3|Ti\s*3", "Ti 3"),
    (r"BYD\s+TI7|TI7|钛7", "Ti 7"),
)

BODY_STRUCTURE_PATTERN = re.compile(r"^(?:短轴|中轴|长轴).*(?:低顶|中顶|高顶)$")
BATTERY_PATTERN = re.compile(r"(?:宁德|智芯)?\s*\d+(?:\.\d+)?\s*kwh\b", re.I)
PRICE_PATTERN = re.compile(r"(?:^|\s|\|)\d{5,}(?:\.\d+)?(?:\s|\||$)|[$¥￥]\s*\d")
ANNOUNCEMENT_CODE_PATTERN = re.compile(r"\b[A-Z]{2,}\d{3,}[A-Z0-9]*\b")
SPEC_BLOB_PATTERN = re.compile(
    r"(?:ABS|EBD|EPS|Airbag|Window|Door|Seat|Radio|USB|Bluetooth|气囊|电动窗|空调|倒车|收音机|座椅|弹簧|悬架)",
    re.I,
)
SALES_VARIANT_PATTERN = re.compile(
    r"(?:版|型|款|PLUS|MAX|ULTRA|PRO|Laser|旗舰|领先|舒享|豪华|行动派|行镖版|行享版|LV\s*\d+|\d+\s*KM\s*[\u4e00-\u9fffA-Za-z+]+|\b\d{3,}\s*[\u4e00-\u9fff]+|\b\d+(?:\.\d+)?TD\b.*[\u4e00-\u9fff]|\bDCT\b.*[\u4e00-\u9fff])",
    re.I,
)
LOCATION_PATTERN = re.compile(r"^(?:Nansha|南沙|上海|宁波|深圳|天津|霍尔果斯|广州|重庆|武汉|北京)(?:[-/][\u4e00-\u9fffA-Za-z]+)?$", re.I)
COLOR_WORD_PATTERN = r"(?:暖阳白|海域白|雪域白|珍珠白|晴空银|星空灰|灰|白|黑|蓝|绿|红|银|金|橙|黄|紫|粉|棕)"
STOCK_COLOR_PATTERN = re.compile(rf"\d+\s*{COLOR_WORD_PATTERN}(?:/{COLOR_WORD_PATTERN})?")


def clean_text(value: object) -> str | None:
    if value in (None, ""):
        return None
    text = str(value).strip()
    return text if text not in {"", "/", "-", "—"} else None


def _render_replacement(template: str, match: re.Match[str]) -> str:
    if template == "{match}":
        return match.group(1 if match.lastindex else 0).strip()
    if template == "{upper_match}":
        return match.group(1 if match.lastindex else 0).strip().upper()
    if template == "{match_title}":
        return re.sub(r"\s+", " ", match.group(0).strip())
    return template


def normalize_model_family(value: object, *, brand: str | None = None) -> str | None:
    text = clean_text(value)
    if not text:
        return None
    first_line = text.splitlines()[0].strip()
    first_line = re.sub(r"\s*载重\s*\d+\s*kg.*$", "", first_line, flags=re.I).strip()
    for pattern, replacement in GENERIC_MODEL_PATTERNS:
        match = re.search(pattern, first_line, re.I)
        if match:
            return _render_replacement(replacement, match)
    if brand and brand.lower() in first_line.lower():
        first_line = re.sub(re.escape(brand), "", first_line, flags=re.I).strip(" -_/：:")
    first_line = re.sub(r"\b\d+(?:\.\d+)?L\b.*$", "", first_line, flags=re.I).strip()
    return first_line or None


def model_aliases(model: str | None) -> tuple[str, ...]:
    if not model:
        return ()
    return MODEL_ALIASES.get(model, ())


def strip_model_prefix(text: str, model: str | None) -> str:
    if not model:
        return text.strip()
    candidates = (model, *model_aliases(model))
    result = text
    for candidate in candidates:
        result = re.sub(rf"^{re.escape(candidate)}\s*[-_/：:]*\s*", "", result, flags=re.I).strip()
    return result


def classify_text_roles(value: object, *, model: str | None = None) -> set[TextRole]:
    text = clean_text(value)
    if not text:
        return set()
    roles: set[TextRole] = set()
    normalized = text.strip()
    if PRICE_PATTERN.search(normalized):
        roles.add(TextRole.PRICE)
    if BATTERY_PATTERN.search(normalized):
        roles.add(TextRole.POWER_BATTERY)
    if ANNOUNCEMENT_CODE_PATTERN.search(normalized):
        roles.add(TextRole.ANNOUNCEMENT_CODE)
    if LOCATION_PATTERN.fullmatch(normalized):
        roles.add(TextRole.LOCATION)
    stock_color_matches = STOCK_COLOR_PATTERN.finditer(normalized)
    if any(not re.match(r"20\d{2}$", match.group(0)[:4]) for match in stock_color_matches):
        roles.add(TextRole.STOCK_COLOR)
    if BODY_STRUCTURE_PATTERN.fullmatch(normalized):
        roles.add(TextRole.BODY_STRUCTURE)
    if SPEC_BLOB_PATTERN.search(normalized) or len(normalized) > 80 or normalized.count("，") + normalized.count(",") >= 3:
        roles.add(TextRole.SPEC_BLOB)
    if SALES_VARIANT_PATTERN.search(normalized):
        roles.add(TextRole.SALES_VARIANT)
    family = normalize_model_family(normalized)
    if family and family.lower() == normalized.lower():
        roles.add(TextRole.MODEL_FAMILY)
    stripped = strip_model_prefix(normalized, model)
    if model and stripped != normalized:
        roles.add(TextRole.DUPLICATE_MODEL)
    if model and (not stripped or stripped.lower() == normalized.lower() == model.lower()):
        roles.add(TextRole.DUPLICATE_MODEL)
    if model and normalized in model_aliases(model):
        roles.add(TextRole.DUPLICATE_MODEL)
    return roles


def clean_variant_text(variant: object, *, brand: str | None = None, model: str | None = None) -> str | None:
    text = clean_text(variant)
    if not text:
        return None
    if brand == "Wuling":
        match = re.search(r"\bLV\s*([0-9]+)\b", text, re.I)
        return f"LV{match.group(1)}" if match else None

    parts: list[str] = []
    for raw_part in re.split(r"\s*\|\s*", text):
        part = clean_text(raw_part)
        if not part:
            continue
        part = re.sub(r"(?:源地点|地点)\s*[:：]\s*[A-Za-z\u4e00-\u9fff/-]+", "", part).strip(" ;；")
        part = BATTERY_PATTERN.sub("", part).strip()
        part = strip_model_prefix(part, model)
        if not part:
            continue
        roles = classify_text_roles(part, model=model)
        if roles & {TextRole.PRICE, TextRole.POWER_BATTERY, TextRole.LOCATION, TextRole.STOCK_COLOR, TextRole.ANNOUNCEMENT_CODE, TextRole.SPEC_BLOB, TextRole.DUPLICATE_MODEL}:
            if TextRole.SALES_VARIANT not in roles:
                continue
        if TextRole.BODY_STRUCTURE in roles and TextRole.SALES_VARIANT not in roles:
            continue
        if brand == "Farizon" and model in {"V6E", "V7E", "V8E"}:
            if "货版" in part:
                part = "货版"
            elif "客版" in part:
                part = "客版"
            elif "货" in part and "版" in part:
                part = "货版"
            elif "客" in part and "版" in part:
                part = "客版"
            elif "盲窗" in part or "明窗" in part:
                continue
        if brand == "Farizon" and model == "SV" and not re.search(r"(行动派|行镖版|行享版)", part):
            continue
        if re.search(r"[\u4e00-\u9fff]", part):
            part = re.sub(
                r"\s+(?:Second|Active|Pilot|Leading|Cloud|Smart|Ultra|Max|Generation|Drive|Edition)\b.*$",
                "",
                part,
                flags=re.I,
            ).strip()
        if part and part not in parts:
            parts.append(part)
    return " | ".join(parts) if parts else None


def lint_candidate_semantics(candidate: dict[str, object]) -> list[SemanticIssue]:
    issues: list[SemanticIssue] = []
    model = clean_text(candidate.get("model"))
    variant = clean_text(candidate.get("variant"))
    if model:
        model_roles = classify_text_roles(model)
        forbidden = model_roles & {
            TextRole.PRICE,
            TextRole.LOCATION,
            TextRole.STOCK_COLOR,
            TextRole.SPEC_BLOB,
            TextRole.ANNOUNCEMENT_CODE,
        }
        if forbidden:
            issues.append(SemanticIssue("model", "bad_model_role", f"model contains non-family roles: {', '.join(sorted(role.value for role in forbidden))}"))
    if variant:
        variant_roles = classify_text_roles(variant, model=model)
        forbidden = variant_roles & {
            TextRole.PRICE,
            TextRole.POWER_BATTERY,
            TextRole.LOCATION,
            TextRole.STOCK_COLOR,
            TextRole.SPEC_BLOB,
            TextRole.ANNOUNCEMENT_CODE,
            TextRole.DUPLICATE_MODEL,
        }
        if forbidden:
            issues.append(SemanticIssue("variant", "bad_variant_role", f"variant contains non-variant roles: {', '.join(sorted(role.value for role in forbidden))}"))
        if TextRole.SALES_VARIANT not in variant_roles:
            issues.append(SemanticIssue("variant", "weak_variant", "variant does not look like a sales version"))
    return issues


def summarize_semantic_issues(candidates: Iterable[dict[str, object]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for candidate in candidates:
        for issue in lint_candidate_semantics(candidate):
            key = f"{issue.field}:{issue.code}"
            counts[key] = counts.get(key, 0) + 1
    return counts
