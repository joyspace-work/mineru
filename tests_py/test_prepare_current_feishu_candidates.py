from scripts.prepare_current_feishu_candidates import convert, normalize_variant_text, normalize_wuling_model, split_model_trim, split_place_fields


def test_official_suggested_price_maps_to_supplier_price_not_display_price() -> None:
    candidate = convert(
        {
            "brand": "BYD",
            "model": "QinPLUS EV",
            "official_suggested_price_cny": 99800,
            "supplier": "test supplier",
            "content_hash": "test-record-id",
            "source_file": "source.xlsx",
            "source_sheet": "Sheet1",
            "source_row": 2,
        }
    )

    assert candidate is not None
    assert candidate["supplier_price_cny"] == 99800
    assert candidate["display_price_low"] is None
    assert candidate["display_price_high"] is None


def test_geely_model_and_variant_are_split_cleanly() -> None:
    candidate = convert(
        {
            "brand": "Geely",
            "model": "Galaxy M9 210km AWD Black Gold Smart Shine Edition",
            "cost_exw_usd": 30000,
            "supplier": "test supplier",
            "content_hash": "geely-record-id",
            "source_file": "source.xlsx",
            "source_sheet": "Sheet1",
            "source_row": 3,
        }
    )

    assert candidate is not None
    assert candidate["brand"] == "Geely"
    assert candidate["model"] == "Galaxy M9"
    assert candidate["variant"] == "210km AWD Black Gold Smart Shine Edition"


def test_geely_bilingual_model_does_not_leak_into_variant() -> None:
    model, variant = split_model_trim(
        "Geely",
        "2025 Model Geely Galaxy M9 / 2025款吉利银河M9（全系6座）",
        "100KM 两驱启航版",
    )

    assert model == "Galaxy M9"
    assert variant == "100KM 两驱启航版"


def test_subtotal_rows_are_skipped_before_validation() -> None:
    candidate = convert(
        {
            "brand": "Dongfeng",
            "model": "纳米01",
            "trim_config": "小计",
            "stock_quantity": 954,
            "supplier": "浙江创睿",
            "content_hash": "subtotal-record-id",
            "source_file": "source.xlsx",
            "source_sheet": "Sheet1",
            "source_row": 26,
        }
    )

    assert candidate is None


def test_base_and_location_do_not_cross_fill() -> None:
    base_candidate = convert(
        {
            "brand": "BYD",
            "model": "QinPLUS EV",
            "location": "霍尔果斯基地",
            "cost_fca_usd": 9250,
            "supplier": "温州迈卡新能源",
            "content_hash": "base-record-id",
            "source_file": "source.xlsx",
            "source_sheet": "Sheet1",
            "source_row": 2,
        }
    )
    port_candidate = convert(
        {
            "brand": "BYD",
            "model": "QinPLUS EV",
            "location": "FCA南沙",
            "cost_fca_usd": 9250,
            "supplier": "温州迈卡新能源",
            "content_hash": "port-record-id",
            "source_file": "source.xlsx",
            "source_sheet": "Sheet1",
            "source_row": 3,
        }
    )

    assert base_candidate is not None
    assert base_candidate["vehicle_supply_base"] == "霍尔果斯基地"
    assert base_candidate["location"] is None
    assert port_candidate is not None
    assert port_candidate["location"] == "南沙"
    assert port_candidate["vehicle_supply_base"] is None


def test_base_only_places_and_non_locations_do_not_enter_location() -> None:
    assert split_place_fields("FCA霍尔果斯") == (None, "霍尔果斯")
    assert split_place_fields("EXW湘潭") == (None, "湘潭")
    assert split_place_fields("EXW可指定发运") == (None, None)


def test_order_wait_days_extracts_day_period_from_notes() -> None:
    candidate = convert(
        {
            "brand": "Xiaomi",
            "model": "Xiaomi SU7 后驱标准版",
            "cost_exw_cny": 219900,
            "notes": "订车交付周期：45天；排产需预付5%车款",
            "supplier": "杭州三只盒子",
            "content_hash": "wait-days-id",
            "source_file": "source.xlsx",
            "source_sheet": "Sheet1",
            "source_row": 2,
        }
    )

    assert candidate is not None
    assert candidate["order_wait_days"] == 45


def test_notes_do_not_include_internal_source_or_price_evidence() -> None:
    candidate = convert(
        {
            "brand": "Xiaomi",
            "model": "Xiaomi SU7 后驱标准版",
            "cost_exw_cny": 219900,
            "notes": "订车交付周期：45天；排产需预付5%车款",
            "supplier": "杭州三只盒子",
            "content_hash": "clean-notes-id",
            "source_file": "source.xlsx",
            "source_sheet": "Sheet1",
            "source_row": 2,
        }
    )

    assert candidate is not None
    assert candidate["notes"] == "订车交付周期：45天；排产需预付5%车款"
    assert "source=" not in candidate["notes"]
    assert "cost_exw_cny=" not in candidate["notes"]
    assert "source=" in candidate["_evidence"]["supplier_price_cny"]
    assert "cost_exw_cny=219900" in candidate["_evidence"]["supplier_price_cny"]


def test_geely_cowboy_uses_english_model_without_brand_repeat() -> None:
    model, variant = split_model_trim("Geely", "吉利牛仔", "2026款观野版+越野套件")

    assert model == "Cowboy"
    assert variant == "2026款观野版+越野套件"


def test_variant_removes_battery_and_duplicate_english_description() -> None:
    variant = normalize_variant_text(
        "BYD",
        "Yuan Plus",
        "49.92kwh 第二代元PLUS智驾版 433KM领先型 Second Generation Yuan PLUS Smart Drive Edition 430km Leading Edition",
    )

    assert variant == "第二代元PLUS智驾版 433KM领先型"


def test_variant_removes_price_and_battery_fragments() -> None:
    variant = normalize_variant_text("Farizon", "SV", "中轴中顶-行镖版 | 220000 | 宁德83kWh")

    assert variant == "中轴中顶-行镖版"


def test_wuling_model_stops_at_main_family() -> None:
    assert normalize_wuling_model("五菱荣光新卡 1.5L 5MT 单排") == "五菱荣光新卡"
    assert normalize_wuling_model("五菱荣光新卡双后轮 2.0L 5MT 单排") == "五菱荣光新卡"


def test_wuling_variant_keeps_only_level() -> None:
    variant = normalize_variant_text(
        "Wuling",
        "五菱荣光新卡",
        "LZW5028XXYEQU 国六B | AJBL | LV0 （2座，货柜车-单蒸空调-晴空银-单层货柜）",
    )

    assert variant == "LV0"


def test_farizon_sv_body_shape_without_sales_version_is_empty() -> None:
    assert normalize_variant_text("Farizon", "SV", "中轴低顶") is None
    assert normalize_variant_text("Farizon", "SV", "中轴高顶-行享版") == "中轴高顶-行享版"


def test_farizon_v_series_variant_focuses_on_passenger_or_cargo() -> None:
    assert normalize_variant_text("Farizon", "V6E", "V6E盲窗货版") == "货版"
    assert normalize_variant_text("Farizon", "V6E", "V6E明窗客版") == "客版"
    assert normalize_variant_text("Farizon", "V7E", "V7E盲窗") is None


def test_changan_variant_removes_model_prefix() -> None:
    assert normalize_variant_text("Changan", "Qiyuan A07", "Qiyuan A07 730旗舰型") == "730旗舰型"
    assert normalize_variant_text("Changan", "L06", "L06 560ULTRA Laser") == "560ULTRA Laser"


def test_variant_that_only_repeats_translated_model_is_empty() -> None:
    assert normalize_variant_text("Changan", "Q05", "启源Q05") is None
    assert normalize_variant_text("Changan", "Qiyuan Q07", "启源Q07") is None


def test_option_price_rows_are_not_vehicle_sources() -> None:
    candidate = convert(
        {
            "brand": "IM Motors",
            "model": "L6",
            "variant": "IM L6 选装-20英寸轮毂",
            "cost_exw_cny": 950,
            "supplier": "重庆鼎饶",
            "content_hash": "option-row-id",
            "source_file": "source.xlsx",
            "source_sheet": "Sheet1",
            "source_row": 2,
        }
    )

    assert candidate is None


def test_option_price_file_names_are_not_vehicle_sources() -> None:
    candidate = convert(
        {
            "brand": "SAIC",
            "model": "L6",
            "cost_exw_cny": 950,
            "supplier": "重庆鼎饶",
            "content_hash": "option-file-id",
            "source_file": "重庆鼎饶\\上海\\SAIC\\IM L6\\IM L6 选装-20英寸轮毂.xlsx",
            "source_sheet": "价格表",
            "source_row": 2,
        }
    )

    assert candidate is None


def test_path_brand_overrides_polluted_brand_cell_for_geely() -> None:
    candidate = convert(
        {
            "brand": "吉利牛仔",
            "model": "2026款观野版+纵情山野",
            "cost_fob_cny": 12200,
            "supplier": "北京华驰集团",
            "content_hash": "path-geely-id",
            "source_file": "北京华驰集团\\南沙\\Geely\\Cowboy\\2026款观野版+纵情山野.xlsx",
            "source_sheet": "配置明细",
            "source_row": 2,
        }
    )

    assert candidate is not None
    assert candidate["brand"] == "Geely"
    assert candidate["model"] == "Cowboy"
    assert candidate["variant"] == "2026款观野版+纵情山野"


def test_path_brand_overrides_saic_folder_to_im_motors() -> None:
    candidate = convert(
        {
            "brand": "SAIC",
            "model": "L6",
            "variant": "IM L6 MAX+",
            "cost_exw_cny": 210000,
            "supplier": "重庆鼎饶",
            "content_hash": "path-im-id",
            "source_file": "重庆鼎饶\\上海\\SAIC\\IM L6\\IM L6 MAX+.xlsx",
            "source_sheet": "价格表",
            "source_row": 2,
        }
    )

    assert candidate is not None
    assert candidate["brand"] == "IM Motors"
    assert candidate["model"] == "L6"
    assert candidate["variant"] == "MAX+"


def test_changan_eado_variant_drops_duplicate_chinese_model_alias() -> None:
    candidate = convert(
        {
            "brand": "Changan",
            "model": "Eado 460",
            "variant": "逸动460",
            "cost_fca_usd": 8500,
            "supplier": "重庆车智汇通",
            "content_hash": "eado-id",
            "source_file": "重庆车智汇通\\南沙\\Changan\\Eado 460\\逸动460.xlsx",
            "source_sheet": "Sheet1",
            "source_row": 2,
        }
    )

    assert candidate is not None
    assert candidate["model"] == "Eado 460"
    assert candidate["variant"] is None
