from __future__ import annotations

import json
from pathlib import Path
import pytest

from mineru_pipeline.pipeline import format_candidates_for_feishu, is_invalid_model_name
from mineru_pipeline.excel_parser import parse_excel_file, normalize_header_cell


class TestExtractionEvals:
    """Eval test suite covering multi-scenario vehicle extraction, cleaning rules, and edge cases."""

    def test_eval_scenario_1_shandong_ev_brand_and_model(self):
        """Scenario 1: Shandong EV brand & model collapsing to strictly 2 rows with exact EXW prices ($9100, $7800)."""
        raw_candidates_kw = [{
            "supplier": "山东小车工厂",
            "brand": "山东小车",
            "model": "卡王",
            "variant": "卡王KW EXW9100",
            "source_file": "山东小车工厂/卡王KW EXW9100.xlsx"
        }]
        res_kw = format_candidates_for_feishu(raw_candidates_kw)
        assert len(res_kw) == 1
        assert res_kw[0]["brand"] == "Shandong EV"
        assert res_kw[0]["model"] == "KW"
        assert res_kw[0]["cost_exw_usd"] == 9100

        raw_candidates_xgp = [{
            "supplier": "山东小车工厂",
            "brand": "山东小车",
            "model": "小钢炮",
            "variant": "小钢炮XGP EXW7800",
            "source_file": "山东小车工厂/小钢炮XGP EXW7800.xlsx"
        }]
        res_xgp = format_candidates_for_feishu(raw_candidates_xgp)
        assert len(res_xgp) == 1
        assert res_xgp[0]["brand"] == "Shandong EV"
        assert res_xgp[0]["model"] == "XGP"
        assert res_xgp[0]["cost_exw_usd"] == 7800

    def test_eval_scenario_byd_sealion_05ev(self):
        """Scenario: BYD Sealion 05 EV variants ('海狮05ev', '海狮05 EV', '海狮05') should normalize to BYD / Sealion 7."""
        from mineru_pipeline.pipeline import normalize_brand_model
        assert normalize_brand_model("比亚迪", "海狮05ev") == ("BYD", "Sealion 7")
        assert normalize_brand_model("BYD", "海狮05 EV") == ("BYD", "Sealion 7")
        assert normalize_brand_model("BYD", "海狮05") == ("BYD", "Sealion 7")
        assert normalize_brand_model("海狮", "05ev") == ("BYD", "Sealion 7")

    def test_eval_scenario_4level_directory_metadata_inheritance(self):
        """Scenario: 4-level directory hierarchy (Supplier / Location / Brand / Model) automatically inherited."""
        from mineru_pipeline.excel_parser import extract_path_metadata
        p = Path("/Users/a12/projects/mineru/input/广州恩特湃/FCA南沙/BYD/海狮05/价格表.xlsx")
        meta = extract_path_metadata(p)
        assert meta["supplier"] == "广州恩特湃"
        assert meta["location"] == "南沙"
        assert meta["brand"] == "BYD"
        assert meta["model"] == "海狮05"

    def test_eval_scenario_2_wuling_model_code_vs_common_name(self):
        """Scenario 2: Brand for all Wuling vehicles MUST always be Wuling, series keywords (荣光, 宏光, etc.) belong in variant."""
        raw_candidates = [{
            "supplier": "广州恩特湃",
            "brand": "五菱",
            "model": "G31A",  # Model code
            "variant": "荣光新单排货车 N350 Single Cab Pickup",
            "supplier_price_cny": 45000,
            "source_file": "广州恩特湃/五菱/报价.xlsx"
        }]
        res = format_candidates_for_feishu(raw_candidates)
        assert len(res) == 1
        assert res[0]["brand"] == "Wuling"  # Strictly Wuling
        assert "荣光" in res[0]["variant"] or "Rongguang" in res[0]["variant"]

    def test_eval_scenario_3_multi_color_string_splitting(self):
        """Scenario 3: Split multi-color string '3暖阳白/黑+13海域白/黑+13灰/黑' into 3 records."""
        raw_candidates = [{
            "supplier": "温州迈卡新能源",
            "brand": "比亚迪",
            "model": "海鸥",
            "variant": "300Pro",
            "exterior_color": "3暖阳白/黑+13海域白/黑+13灰/黑",
            "supplier_price_cny": 69800,
            "source_file": "比亚迪报价.xlsx"
        }]
        res = format_candidates_for_feishu(raw_candidates)
        assert len(res) == 3
        # Record 1
        assert res[0]["stock_quantity"] == 3
        assert res[0]["exterior_color"] == "暖阳白"
        assert res[0]["interior_color"] == "黑"
        # Record 2
        assert res[1]["stock_quantity"] == 13
        assert res[1]["exterior_color"] == "海域白"
        assert res[1]["interior_color"] == "黑"
        # Record 3
        assert res[2]["stock_quantity"] == 13
        assert res[2]["exterior_color"] == "灰"
        assert res[2]["interior_color"] == "黑"

    def test_eval_scenario_4_quantity_prefix_stripping(self):
        """Scenario 4: Stripping quantity prefix from color strings like '110白'."""
        raw_candidates = [{
            "supplier": "测试供应商",
            "brand": "吉利",
            "model": "银河 E5",
            "exterior_color": "110白",
            "interior_color": "黑",
            "supplier_price_cny": 109800,
            "source_file": "吉利报价.xlsx"
        }]
        res = format_candidates_for_feishu(raw_candidates)
        assert len(res) == 1
        assert res[0]["stock_quantity"] == 110
        assert res[0]["exterior_color"] == "白"

    def test_eval_scenario_5_usd_cost_bounds_filtering(self):
        """Scenario 5: Filter USD costs outside $1,000–$200,000 range (e.g. 3, 205, 1500000)."""
        raw_candidates = [
            {"supplier": "Test", "brand": "BYD", "model": "Dolphin", "variant": "T1", "cost_exw_usd": 3},
            {"supplier": "Test", "brand": "BYD", "model": "Dolphin", "variant": "T2", "cost_exw_usd": 205},
            {"supplier": "Test", "brand": "BYD", "model": "Dolphin", "variant": "T3", "cost_exw_usd": 12500},
            {"supplier": "Test", "brand": "BYD", "model": "Dolphin", "variant": "T4", "cost_exw_usd": 1500000},
        ]
        res = format_candidates_for_feishu(raw_candidates)
        assert len(res) == 4
        assert res[0]["cost_exw_usd"] is None
        assert res[1]["cost_exw_usd"] is None
        assert res[2]["cost_exw_usd"] == 12500
        assert res[3]["cost_exw_usd"] is None

    def test_eval_scenario_6_footer_noise_rejection(self):
        """Scenario 6: Rejection of footer remarks like '1. 以上汇率为境外人民币'."""
        assert is_invalid_model_name("1. 以上汇率为境外人民币") is True
        assert is_invalid_model_name("基于广州滚装船运费... ") is True
        assert is_invalid_model_name("二类底盘含空调及定速巡航") is True
        assert is_invalid_model_name("Dolphin") is False
        assert is_invalid_model_name("Seagull") is False

    def test_eval_scenario_7_steering_setup_defaulting(self):
        """Scenario 7: steering_setup is None if unstated, BUT '国内版' automatically implies '左舵'."""
        # Unstated and not domestic -> None
        raw_unknown = [{
            "supplier": "Test",
            "brand": "Zeekr",
            "model": "001",
            "steering_setup": None
        }]
        res_unknown = format_candidates_for_feishu(raw_unknown)
        assert res_unknown[0]["steering_setup"] is None

        # Domestic version -> Left hand drive (左舵)
        raw_domestic = [{
            "supplier": "Test",
            "brand": "Zeekr",
            "model": "001",
            "version_type": "国内版",
            "steering_setup": None
        }]
        res_domestic = format_candidates_for_feishu(raw_domestic)
        assert res_domestic[0]["steering_setup"] == "左舵"

    def test_eval_scenario_8_deduplication_and_priceless_collapsing(self):
        """Scenario 8: Deduplicating exact duplicate rows and collapsing priceless rows."""
        raw_candidates = [
            {"supplier": "S1", "brand": "Zeekr", "model": "001", "variant": "WE 100kWh", "source_file": "f1.xlsx"},
            {"supplier": "S1", "brand": "Zeekr", "model": "001", "variant": "WE 100kWh", "source_file": "f1.xlsx"},
            {"supplier": "S1", "brand": "Zeekr", "model": "001", "variant": "WE 100kWh", "source_file": "f1.xlsx"},
        ]
        res = format_candidates_for_feishu(raw_candidates)
        assert len(res) == 1

    def test_eval_scenario_9_brand_and_model_official_translation(self):
        """Scenario 9: Official translation of Chinese brands & models to English/Pinyin."""
        raw_candidates = [
            {"supplier": "S1", "brand": "问界", "model": "M9"},
            {"supplier": "S1", "brand": "方程豹", "model": "豹5"},
            {"supplier": "S1", "brand": "极氪", "model": "001"},
            {"supplier": "S1", "brand": "深蓝", "model": "S07"},
        ]
        res = format_candidates_for_feishu(raw_candidates)
        assert res[0]["brand"] == "AITO" and res[0]["model"] == "M9"
        assert res[1]["brand"] == "Fangchengbao" and res[1]["model"] == "Leopard 5"
        assert res[2]["brand"] == "Zeekr" and res[2]["model"] == "001"
        assert res[3]["brand"] == "Deepal" and res[3]["model"] == "S07"
