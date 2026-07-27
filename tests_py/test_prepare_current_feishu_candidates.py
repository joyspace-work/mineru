from scripts.prepare_current_feishu_candidates import convert


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
