"""LLM Extractor alias delegating to parser module."""

from .parser import HAS_PYDANTIC, _request_json, call_ai, call_ai_with_pydantic_retry

__all__ = ["call_ai", "call_ai_with_pydantic_retry", "HAS_PYDANTIC", "_request_json"]
