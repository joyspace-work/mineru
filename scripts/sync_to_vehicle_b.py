from __future__ import annotations

import json
import logging
import time
from pathlib import Path
import requests

import os
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("sync_to_vehicle_b")

APP_ID = os.getenv("FEISHU_APP_ID") or os.getenv("LARK_APP_ID") or "cli_aab1f0eeb0fa9cc0"
APP_SECRET = os.getenv("FEISHU_APP_SECRET") or os.getenv("LARK_APP_SECRET") or ""
APP_TOKEN = os.getenv("FEISHU_APP_TOKEN") or os.getenv("FEISHU_BASE_TOKEN") or "Is6Xb3btbazhFhsDXgFcqFG1nRc"
TABLE_ID = os.getenv("FEISHU_TABLE_ID") or "tblbihrupDmLn6RH"  # vehicle_b table ID


def get_tenant_access_token() -> str:
    res = requests.post(
        "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
        json={"app_id": APP_ID, "app_secret": APP_SECRET},
        headers={"Content-Type": "application/json"},
        timeout=15,
    )
    res_data = res.json()
    if res_data.get("code") != 0:
        raise RuntimeError(f"Auth failed: {res_data}")
    return res_data["tenant_access_token"]


def clear_existing_records(access_token: str) -> None:
    headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}
    logger.info("Fetching existing record IDs from table 'vehicle_b'...")
    
    record_ids: list[str] = []
    page_token = None

    while True:
        url = f"https://open.feishu.cn/open-apis/bitable/v1/apps/{APP_TOKEN}/tables/{TABLE_ID}/records?page_size=500"
        if page_token:
            url += f"&page_token={page_token}"
        resp = requests.get(url, headers=headers, timeout=30)
        data = resp.json()
        if data.get("code") != 0:
            logger.error(f"Failed to list records: {data.get('msg')}")
            break
        items = data.get("data", {}).get("items", [])
        for item in items:
            record_ids.append(item["id"])
        
        has_more = data.get("data", {}).get("has_more", False)
        page_token = data.get("data", {}).get("page_token")
        if not has_more or not page_token:
            break

    logger.info(f"Found {len(record_ids)} existing records in 'vehicle_b' to clear.")
    if not record_ids:
        return

    delete_url = f"https://open.feishu.cn/open-apis/bitable/v1/apps/{APP_TOKEN}/tables/{TABLE_ID}/records/batch_delete"
    batch_size = 100
    deleted_count = 0

    for i in range(0, len(record_ids), batch_size):
        batch = record_ids[i:i + batch_size]
        del_resp = requests.post(delete_url, headers=headers, json={"records": batch}, timeout=30)
        del_data = del_resp.json()
        if del_data.get("code") == 0:
            deleted_count += len(batch)
            logger.info(f"Deleted batch {i//batch_size + 1}: {len(batch)} records (Total deleted: {deleted_count}/{len(record_ids)})")
        else:
            logger.error(f"Delete batch failed: {del_data.get('msg')}")

    logger.info(f"Finished clearing existing records in 'vehicle_b'.")


def candidate_to_feishu_fields(r: dict) -> dict:
    fields = {}
    supplier = r.get("supplier") or ""
    brand = r.get("brand") or ""
    model = r.get("model") or ""
    trim = r.get("trim_config") or ""

    composite = f"{supplier} {brand} {model} {trim}".strip()
    
    # Store composite string in notes (record_id left for Feishu to auto-generate)
    raw_notes = r.get("notes")
    if raw_notes:
        fields["notes"] = f"{composite} | {raw_notes}" if composite else raw_notes
    elif composite:
        fields["notes"] = composite

    if brand:
        fields["brand"] = brand
    if model:
        fields["model"] = model
    if r.get("model_id"):
        fields["model_id"] = r["model_id"]
    if trim:
        fields["trim_config"] = trim
    if r.get("manufacture_year") is not None:
        fields["manufacture_year"] = r["manufacture_year"]
    if r.get("manufacture_month") is not None:
        fields["manufacture_month"] = r["manufacture_month"]
    if r.get("exterior_color"):
        fields["exterior_color"] = r["exterior_color"]
    if r.get("interior_color"):
        fields["interior_color"] = r["interior_color"]
    if r.get("stock_quantity") is not None:
        fields["stock_quantity"] = r["stock_quantity"]
    if r.get("min_quantity") is not None:
        fields["min_quantity"] = r["min_quantity"]
    if r.get("max_quantity") is not None:
        fields["max_quantity"] = r["max_quantity"]
    if supplier:
        fields["supplier"] = supplier
    if r.get("location"):
        fields["location"] = r["location"]
    if r.get("supplier_price_cny") is not None:
        fields["supplier_price_cny"] = r["supplier_price_cny"]
    if r.get("cost_exw_usd") is not None:
        fields["cost_exw_usd"] = r["cost_exw_usd"]
    if r.get("cost_fob_usd") is not None:
        fields["cost_fob_usd"] = r["cost_fob_usd"]
    if r.get("cost_fca_usd") is not None:
        fields["cost_fca_usd"] = r["cost_fca_usd"]
    if r.get("steering_setup"):
        fields["steering_setup"] = r["steering_setup"]
    if r.get("version_type"):
        fields["market_region"] = [r["version_type"]]
    if r.get("order_wait_days") is not None:
        fields["order_wait_days"] = r["order_wait_days"]
    if r.get("confidence") is not None:
        fields["confidence"] = r["confidence"]

    return fields


def main():
    json_file = Path("output/final/candidates_2026-07-24_backend-hybrid.json")
    if not json_file.exists():
        logger.error(f"JSON file not found: {json_file}")
        return

    candidates = json.loads(json_file.read_text("utf-8"))
    logger.info(f"Loaded {len(candidates)} candidate records from {json_file.name}")

    access_token = get_tenant_access_token()
    
    # 1. Clear existing records first
    clear_existing_records(access_token)

    headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}
    url = f"https://open.feishu.cn/open-apis/bitable/v1/apps/{APP_TOKEN}/tables/{TABLE_ID}/records/batch_create"

    # 2. Upload candidates with notes containing composite string and record_id omitted
    total_uploaded = 0
    batch_size = 100

    for i in range(0, len(candidates), batch_size):
        batch = candidates[i:i + batch_size]
        payload = {"records": [{"fields": candidate_to_feishu_fields(r)} for r in batch]}

        resp = requests.post(url, headers=headers, json=payload, timeout=30)
        data = resp.json()
        if data.get("code") == 0:
            count = len(data.get("data", {}).get("records", []))
            total_uploaded += count
            logger.info(f"Uploaded batch {i//batch_size + 1}/{(len(candidates)+batch_size-1)//batch_size}: {count} records (Total: {total_uploaded}/{len(candidates)})")
        else:
            logger.error(f"Batch {i//batch_size + 1} failed: {data.get('msg')}")

    logger.info(f"🎉 Feishu re-upload to table 'vehicle_b' complete! Total: {total_uploaded}/{len(candidates)} records synced with composite strings in 'notes'.")


if __name__ == "__main__":
    main()
