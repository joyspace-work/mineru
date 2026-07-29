"""RuleEngine alias delegating to schema module."""

from .schema import DEFAULT_KNOWLEDGE_BASE, KNOWLEDGE_BASE_PATH, RuleEngine, get_rule_engine

__all__ = ["DEFAULT_KNOWLEDGE_BASE", "KNOWLEDGE_BASE_PATH", "RuleEngine", "get_rule_engine"]
