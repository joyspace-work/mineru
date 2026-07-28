from mineru_pipeline.field_semantics import (
    TextRole,
    clean_variant_text,
    classify_text_roles,
    lint_candidate_semantics,
    normalize_model_family,
)


def test_text_role_classifier_separates_non_variant_fragments() -> None:
    assert TextRole.PRICE in classify_text_roles("220000")
    assert TextRole.POWER_BATTERY in classify_text_roles("宁德83kWh")
    assert TextRole.ANNOUNCEMENT_CODE in classify_text_roles("LZW5028XXYEQU 国六B")
    assert TextRole.SPEC_BLOB in classify_text_roles("2座，货柜车-单蒸空调-晴空银-单层货柜")
    assert TextRole.STOCK_COLOR not in classify_text_roles("2026金辉典藏版")


def test_model_family_normalization_extracts_main_family_without_brand_or_config() -> None:
    assert normalize_model_family("吉利牛仔 观野版", brand="Geely") == "Cowboy"
    assert normalize_model_family("Galaxy M9 210km AWD Black Gold Smart Shine Edition", brand="Geely") == "Galaxy M9"
    assert normalize_model_family("五菱荣光新卡 1.5L 5MT 单排", brand="Wuling") == "五菱荣光新卡"


def test_variant_cleaner_removes_duplicate_model_price_battery_and_spec_fragments() -> None:
    assert clean_variant_text("Qiyuan A07 730旗舰型", brand="Changan", model="Qiyuan A07") == "730旗舰型"
    assert clean_variant_text("L06 560ULTRA Laser", brand="Changan", model="L06") == "560ULTRA Laser"
    assert clean_variant_text("启源Q07", brand="Changan", model="Qiyuan Q07") is None
    assert clean_variant_text("中轴中顶-行镖版 | 220000 | 宁德83kWh", brand="Farizon", model="SV") == "中轴中顶-行镖版"
    assert clean_variant_text("LZW5028XXYEQU 国六B | AJBL | LV0 （2座，货柜车-单蒸空调-晴空银-单层货柜）", brand="Wuling", model="五菱荣光新卡") == "LV0"


def test_candidate_linter_rejects_field_role_drift() -> None:
    issues = lint_candidate_semantics(
        {
            "brand": "Farizon",
            "model": "SV",
            "variant": "中轴中顶-行镖版 | 220000 | 宁德83kWh",
        }
    )

    assert any(issue.field == "variant" and issue.code == "bad_variant_role" for issue in issues)


def test_variant_linter_accepts_range_and_powertrain_sales_names() -> None:
    for variant in ("225KM航海", "210KM元气熊", "1.5TD DCT 幸福 7座", "210进阶"):
        issues = lint_candidate_semantics({"brand": "Geely", "model": "Panda", "variant": variant})
        assert not any(issue.field == "variant" and issue.code == "weak_variant" for issue in issues)


def test_variant_linter_keeps_option_items_as_weak_variant() -> None:
    issues = lint_candidate_semantics({"brand": "IM Motors", "model": "LS6", "variant": "选装-冰箱"})

    assert any(issue.field == "variant" and issue.code == "weak_variant" for issue in issues)
