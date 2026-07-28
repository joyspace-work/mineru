from mineru_pipeline.import_quality import build_quality_report


def test_quality_report_surfaces_zero_rows_duplicates_and_missing_place() -> None:
    records = [
        {
            "record_id": "a",
            "supplier": "S1",
            "brand": "BYD",
            "model": "Sealion 06 EV",
            "variant": "520旗舰版",
            "supplier_price_cny": 100000,
            "_source_file": "S1\\BYD\\a.xlsx",
        },
        {
            "record_id": "b",
            "supplier": "S1",
            "brand": "BYD",
            "model": "Sealion 06 EV",
            "variant": "520旗舰版",
            "supplier_price_cny": 100000,
            "_source_file": "S1\\BYD\\a.xlsx",
        },
        {
            "record_id": "c",
            "supplier": "S2",
            "brand": "Geely",
            "model": "Galaxy M9",
            "variant": None,
            "location": "南沙",
            "supplier_price_cny": 200000,
            "_source_file": "S2\\Geely\\b.xlsx",
        },
    ]
    summary = {
        "source_file_count": 2,
        "candidate_count": 3,
        "per_file": [
            {"file": "S1\\BYD\\a.xlsx", "rows": 2},
            {"file": "S3\\empty.xlsx", "rows": 0},
        ],
    }

    report = build_quality_report(records, summary=summary)

    assert report["zero_row_sources"]["count"] == 1
    assert report["zero_row_sources"]["by_supplier"] == {"S3": 1}
    assert report["duplicate_business_keys"]["group_count"] == 1
    assert report["duplicate_business_keys"]["record_count"] == 2
    assert report["missing_counts"]["location_and_base"] == 2
    assert report["missing_counts"]["variant"] == 1


def test_quality_report_records_variant_cleaning_reasons_from_raw_rows() -> None:
    records = [
        {
            "record_id": "a",
            "supplier": "S1",
            "brand": "Changan",
            "model": "Qiyuan A07",
            "variant": "730旗舰型",
            "_source_file": "S1\\a.xlsx",
        },
        {
            "record_id": "b",
            "supplier": "S1",
            "brand": "Farizon",
            "model": "SV",
            "variant": None,
            "_source_file": "S1\\b.xlsx",
        },
    ]
    raw_rows = [
        {"content_hash": "a", "trim_config": "Qiyuan A07 730旗舰型"},
        {"content_hash": "b", "trim_config": "中轴低顶"},
    ]

    report = build_quality_report(records, raw_records=raw_rows)

    reasons = {item["record_id"]: item["reason"] for item in report["variant_audit"]["items"]}
    assert reasons["a"] == "changed"
    assert reasons["b"] == "cleaned_to_empty"
