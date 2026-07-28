from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path
from typing import Any

import requests


BASE_URL = "https://open.feishu.cn/open-apis"
SKIP_FIELDS = {"display_price_low", "display_price_high", "_evidence", "_source_file"}
FIELD_ALIASES = {"trim_config_id": "variant_id"}
SELECT_ALIASES = {
    "brand": {
        "AVATR": "Avatr",
        "GAC Aion": "GAC",
        "山东小车工厂": "Shandong EV",
    }
}


def load_dotenv(path: Path = Path(".env")) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def request_json(method: str, url: str, *, token: str | None = None, **kwargs: Any) -> dict[str, Any]:
    headers = kwargs.pop("headers", {})
    if token:
        headers["Authorization"] = f"Bearer {token}"
    headers.setdefault("Content-Type", "application/json")
    for attempt in range(1, 4):
        response = requests.request(method, url, headers=headers, timeout=60, **kwargs)
        data = response.json() if response.text else {}
        if response.status_code < 500 and data.get("code", 0) == 0:
            return data
        if attempt == 3:
            raise RuntimeError(f"{method} {url} failed: status={response.status_code} body={data}")
        time.sleep(attempt)
    raise RuntimeError("unreachable")


def tenant_token() -> str:
    app_id = os.getenv("FEISHU_APP_ID") or os.getenv("LARK_APP_ID")
    app_secret = os.getenv("FEISHU_APP_SECRET") or os.getenv("LARK_APP_SECRET")
    if not app_id or not app_secret:
        raise RuntimeError("FEISHU_APP_ID/FEISHU_APP_SECRET are required")
    data = request_json(
        "POST",
        f"{BASE_URL}/auth/v3/tenant_access_token/internal",
        json={"app_id": app_id, "app_secret": app_secret},
    )
    return str(data["tenant_access_token"])


def list_fields(token: str, app_token: str, table_id: str) -> list[dict[str, Any]]:
    url = f"{BASE_URL}/bitable/v1/apps/{app_token}/tables/{table_id}/fields?page_size=100"
    fields: list[dict[str, Any]] = []
    page_token = ""
    while True:
        page_url = f"{url}&page_token={page_token}" if page_token else url
        data = request_json("GET", page_url, token=token)
        payload = data.get("data", {})
        fields.extend(payload.get("items") or [])
        if not payload.get("has_more"):
            return fields
        page_token = payload.get("page_token") or ""


def list_records(token: str, app_token: str, table_id: str) -> list[dict[str, Any]]:
    url = f"{BASE_URL}/bitable/v1/apps/{app_token}/tables/{table_id}/records?page_size=500"
    records: list[dict[str, Any]] = []
    page_token = ""
    while True:
        page_url = f"{url}&page_token={page_token}" if page_token else url
        data = request_json("GET", page_url, token=token)
        payload = data.get("data", {})
        records.extend(payload.get("items") or [])
        if not payload.get("has_more"):
            return records
        page_token = payload.get("page_token") or ""


def field_name(field: dict[str, Any]) -> str:
    return str(field.get("field_name") or field.get("name") or "")


def select_options(fields: list[dict[str, Any]]) -> dict[str, set[str]]:
    result: dict[str, set[str]] = {}
    for field in fields:
        name = field_name(field)
        property_value = field.get("property") or {}
        options = property_value.get("options") or field.get("options") or []
        names = {str(option.get("name")) for option in options if option.get("name")}
        if names:
            result[name] = names
    return result


def load_records(path: Path) -> list[dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict) and isinstance(data.get("records"), list):
        return data["records"]
    if isinstance(data, list):
        return data
    raise ValueError("candidate file must be a JSON list or an object with records[]")


def adapt_value(field: str, value: Any, option_names: dict[str, set[str]]) -> Any:
    if isinstance(value, list):
        return [SELECT_ALIASES.get(field, {}).get(item, item) for item in value]
    return SELECT_ALIASES.get(field, {}).get(value, value)


def adapt_records(records: list[dict[str, Any]], fields: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, list[str]], dict[str, int]]:
    table_fields = {field_name(field) for field in fields}
    option_names = select_options(fields)
    adapted: list[dict[str, Any]] = []
    missing_options: dict[str, set[str]] = {}
    skipped_missing_fields: dict[str, int] = {}
    for record in records:
        out: dict[str, Any] = {}
        for key, raw_value in record.items():
            if key in SKIP_FIELDS or raw_value in (None, "", []):
                continue
            target = FIELD_ALIASES.get(key, key)
            if target not in table_fields:
                skipped_missing_fields[target] = skipped_missing_fields.get(target, 0) + 1
                continue
            value = adapt_value(target, raw_value, option_names)
            if target in option_names:
                values = value if isinstance(value, list) else [value]
                for item in values:
                    if item not in option_names[target]:
                        missing_options.setdefault(target, set()).add(str(item))
            out[target] = value
        adapted.append({"fields": out})
    return adapted, {key: sorted(value) for key, value in missing_options.items()}, dict(sorted(skipped_missing_fields.items()))


def chunked(items: list[Any], size: int) -> list[list[Any]]:
    return [items[index:index + size] for index in range(0, len(items), size)]


def delete_records(token: str, app_token: str, table_id: str, record_ids: list[str]) -> int:
    url = f"{BASE_URL}/bitable/v1/apps/{app_token}/tables/{table_id}/records/batch_delete"
    deleted = 0
    for batch in chunked(record_ids, 500):
        request_json("POST", url, token=token, json={"records": batch})
        deleted += len(batch)
        time.sleep(0.2)
    return deleted


def create_records(token: str, app_token: str, table_id: str, records: list[dict[str, Any]]) -> int:
    url = f"{BASE_URL}/bitable/v1/apps/{app_token}/tables/{table_id}/records/batch_create"
    created = 0
    for batch in chunked(records, 200):
        request_json("POST", url, token=token, json={"records": batch})
        created += len(batch)
        time.sleep(0.2)
    return created


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--base-token", required=True)
    parser.add_argument("--table-id", required=True)
    parser.add_argument("--backup", default="output/final/feishu_table_backup.json")
    parser.add_argument("--prepared", default="output/final/feishu_table_prepared.json")
    parser.add_argument("--replace", action="store_true")
    parser.add_argument("--allow-new-select-options", action="store_true")
    args = parser.parse_args()

    load_dotenv()
    token = tenant_token()
    fields = list_fields(token, args.base_token, args.table_id)
    records = load_records(Path(args.input))
    prepared, missing_options, skipped_missing_fields = adapt_records(records, fields)
    Path(args.prepared).parent.mkdir(parents=True, exist_ok=True)
    Path(args.prepared).write_text(json.dumps({"records": prepared}, ensure_ascii=False, indent=2), encoding="utf-8")

    existing = list_records(token, args.base_token, args.table_id)
    Path(args.backup).parent.mkdir(parents=True, exist_ok=True)
    Path(args.backup).write_text(json.dumps({"records": existing}, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"source_records={len(records)}")
    print(f"prepared_records={len(prepared)}")
    print(f"existing_records={len(existing)}")
    print(f"backup={args.backup}")
    print(f"prepared={args.prepared}")
    if skipped_missing_fields:
        print("skipped_missing_target_fields=" + json.dumps(skipped_missing_fields, ensure_ascii=False))
    if missing_options:
        print("missing_select_options=" + json.dumps(missing_options, ensure_ascii=False))
        if not args.allow_new_select_options:
            print("Aborted before write. Re-run with --allow-new-select-options to let Feishu create missing select options.")
            return 2
    if not args.replace:
        print("Dry run only. Re-run with --replace to delete existing records and upload prepared records.")
        return 0

    deleted = delete_records(token, args.base_token, args.table_id, [record["record_id"] for record in existing])
    created = create_records(token, args.base_token, args.table_id, prepared)
    readback = list_records(token, args.base_token, args.table_id)
    print(f"deleted_records={deleted}")
    print(f"created_records={created}")
    print(f"readback_records={len(readback)}")
    return 0 if created == len(prepared) and len(readback) == len(prepared) else 1


if __name__ == "__main__":
    raise SystemExit(main())
