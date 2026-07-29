"""
Unit tests for Continuous Learning RuleEngine and Schema Intelligence Platform.
"""

import json
from pathlib import Path
from mineru_pipeline.rule_engine import RuleEngine


def test_rule_engine_default_initialization(tmp_path: Path):
    kb_file = tmp_path / "test_kb.json"
    engine = RuleEngine(kb_path=kb_file)
    assert kb_file.exists()
    assert engine.normalize_header_cell("指导价") == "officialSuggestedPriceCny"
    assert engine.normalize_header_cell("提货地点") == "location"
    assert engine.normalize_header_cell("外观色") == "exteriorColor"


def test_rule_engine_distill_edit_and_persist(tmp_path: Path):
    kb_file = tmp_path / "test_kb.json"
    engine = RuleEngine(kb_path=kb_file)

    # Distill a user edit rule
    rule = engine.distill_rule_from_edit("model", "e-π 007", "eπ007", context="test_edit")
    assert rule is not None
    assert rule["field"] == "model"
    assert rule["target_value"] == "eπ007"

    # Reload engine from disk and verify persistence
    engine2 = RuleEngine(kb_path=kb_file)
    learned = engine2.kb_data.get("user_learned_rules", [])
    assert len(learned) == 1
    assert learned[0]["target_value"] == "eπ007"


def test_rule_engine_telemetry_reporting(tmp_path: Path):
    kb_file = tmp_path / "test_kb.json"
    engine = RuleEngine(kb_path=kb_file)

    engine.record_run_telemetry(deterministic_count=100, ai_count=2)
    summary = engine.get_telemetry_summary()

    assert "Schema Intelligence Telemetry Report" in summary
    assert "102" in summary
    assert "98.0%" in summary or "100" in summary


def test_rule_engine_trade_term_price_validation(tmp_path: Path):
    kb_file = tmp_path / "test_kb.json"
    engine = RuleEngine(kb_path=kb_file)

    # 1. Normal reasonable EXW -> FCA difference ($500 base ± 400 => $100 ~ $900)
    warns = engine.validate_trade_term_prices(exw_usd=10000, fca_usd=10500, fob_usd=11000)
    assert len(warns) == 0

    # 2. Anomalous EXW -> FCA difference ($50 => below $100 lower bound)
    warns_low = engine.validate_trade_term_prices(exw_usd=10000, fca_usd=10050, fob_usd=None)
    assert len(warns_low) == 1
    assert "EXW->FCA" in warns_low[0]

    # 3. Inverted price (FCA < EXW)
    warns_inv = engine.validate_trade_term_prices(exw_usd=10000, fca_usd=9500, fob_usd=None)
    assert len(warns_inv) == 1
    assert "EXW->FCA" in warns_inv[0]

