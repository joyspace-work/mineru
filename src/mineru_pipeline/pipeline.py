from __future__ import annotations

from datetime import datetime
from pathlib import Path
import csv
import json
import os
import sqlite3
import time
from typing import Any

import requests
from dotenv import load_dotenv

from .codex_extract import (
    FIELD_SPECS,
    TARGET_BASE_TOKEN,
    TARGET_TABLE_ID,
    TARGET_VIEW_ID,
    WRITABLE_FIELDS,
    load_candidate_records,
    parse_number,
    validate_candidate_records,
    write_excel_evidence_bundle,
)


PROJECT_ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", PROJECT_ROOT / "output"))


def input_dir() -> Path:
    return Path(os.getenv("PIPELINE_INPUT_DIR", PROJECT_ROOT / "input"))


def init_environment() -> None:
    load_dotenv(PROJECT_ROOT / ".env", override=False)


def _local_columns() -> list[str]:
    return [*WRITABLE_FIELDS, "status", "source_file", "content_hash"]


def get_db(db_path: Path | None = None) -> sqlite3.Connection:
    configured_path = os.getenv("LOCAL_SOURCE_DB_PATH")
    target_path = db_path or (Path(configured_path) if configured_path else PROJECT_ROOT / "local_source.db")
    db = sqlite3.connect(target_path)
    db.row_factory = sqlite3.Row
    field_columns = ",\n          ".join(f"{field} TEXT" for field in WRITABLE_FIELDS)
    db.execute(f"""
        CREATE TABLE IF NOT EXISTS source_candidates (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          {field_columns},
          status TEXT DEFAULT 'pending',
          source_file TEXT,
          content_hash TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    existing = {row["name"] for row in db.execute("PRAGMA table_info(source_candidates)").fetchall()}
    for column in _local_columns():
        if column not in existing:
            db.execute(f"ALTER TABLE source_candidates ADD COLUMN {column} TEXT")
    db.commit()
    return db


def _json_value(value: Any) -> Any:
    if isinstance(value, list):
        return json.dumps(value, ensure_ascii=False)
    return value


def _read_json_value(value: Any) -> Any:
    if isinstance(value, str) and value.startswith("["):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value
    return value


def save_candidates_to_db(db: sqlite3.Connection, candidates: list[dict[str, Any]]) -> list[int]:
    columns = _local_columns()
    placeholders = ",".join("?" for _ in columns)
    ids: list[int] = []
    for row in candidates:
        values = [_json_value(row.get(col)) if col != "status" else "pending" for col in columns]
        cursor = db.execute(f"INSERT INTO source_candidates ({','.join(columns)}) VALUES ({placeholders})", values)
        ids.append(int(cursor.lastrowid))
    db.commit()
    return ids


def mark_candidates_synced(db: sqlite3.Connection, ids: list[int]) -> None:
    db.executemany("UPDATE source_candidates SET status = 'synced' WHERE id = ?", [(i,) for i in ids])
    db.commit()


def record_to_feishu_fields(record: dict[str, Any]) -> dict[str, Any]:
    fields: dict[str, Any] = {}
    for field in WRITABLE_FIELDS:
        value = _read_json_value(record.get(field))
        if value in (None, "", []):
            continue
        spec = FIELD_SPECS[field]
        if spec.field_type == "number":
            value = parse_number(value)
            if value is None:
                continue
        if spec.field_type == "select" and field == "market_region" and not isinstance(value, list):
            value = [value]
        fields[field] = value
    return fields


def adapt_fields_to_feishu_table(fields: dict[str, Any], table_field_names: set[str]) -> dict[str, Any]:
    return {
        key: value
        for key, value in fields.items()
        if key in table_field_names and FIELD_SPECS.get(key) and FIELD_SPECS[key].writable
    }


def save_final_output(candidates: list[dict[str, Any]]) -> tuple[Path, Path]:
    final_dir = OUTPUT_DIR / "final"
    final_dir.mkdir(parents=True, exist_ok=True)
    date = datetime.now().date().isoformat()
    json_path = final_dir / f"candidates_{date}.json"
    csv_path = final_dir / f"candidates_{date}.csv"
    json_path.write_text(json.dumps(candidates, ensure_ascii=False, indent=2), "utf-8")
    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(WRITABLE_FIELDS), extrasaction="ignore")
        writer.writeheader()
        for row in candidates:
            writer.writerow({field: _json_value(row.get(field)) for field in WRITABLE_FIELDS})
    return json_path, csv_path


def save_invalid_report(invalid: list[dict[str, Any]]) -> Path:
    final_dir = OUTPUT_DIR / "final"
    final_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = final_dir / f"invalid_candidates_{timestamp}.json"
    path.write_text(json.dumps(invalid, ensure_ascii=False, indent=2), "utf-8")
    return path


def fetch_with_retry(method: str, url: str, *, max_retries: int = 3, initial_delay: float = 1.0, **kwargs: Any) -> dict[str, Any]:
    delay = initial_delay
    last_error: Exception | None = None
    for attempt in range(1, max_retries + 1):
        try:
            response = requests.request(method, url, timeout=60, **kwargs)
            data = response.json() if response.text else {}
            msg = str(data.get("msg") or data.get("message") or "").lower()
            if response.status_code in (429,) or response.status_code >= 500:
                raise RuntimeError(f"HTTP status {response.status_code}")
            if data.get("code") not in (None, 0):
                code = int(data.get("code", -1))
                if code == 99991400 or any(token in msg for token in ("rate limit", "frequency", "too many", "throttled")) or code >= 500000:
                    raise RuntimeError(f"Feishu API Error {code}: {data.get('msg')}")
            return data
        except Exception as exc:
            last_error = exc
            if attempt == max_retries:
                break
            print(f"Fetch retry {attempt}/{max_retries} failed: {exc}. Retrying in {delay}s...")
            time.sleep(delay)
            delay *= 2
    raise RuntimeError(str(last_error))


def fetch_feishu_table_field_names(access_token: str, app_token: str, table_id: str) -> set[str]:
    url = f"https://open.feishu.cn/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/fields?page_size=100"
    data = fetch_with_retry("GET", url, headers={"Authorization": f"Bearer {access_token}"})
    if data.get("code") != 0:
        print(f"Feishu field list failed: {data.get('msg')}")
        return set()
    items = data.get("data", {}).get("items", [])
    return {str(item.get("field_name") or item.get("name")) for item in items if item.get("field_name") or item.get("name")}


def sync_to_feishu(candidates: list[dict[str, Any]], dry_run: bool = False) -> bool:
    if dry_run:
        print("Dry run - skipping Feishu upload")
        return True
    app_id = os.getenv("FEISHU_APP_ID") or os.getenv("LARK_APP_ID")
    app_secret = os.getenv("FEISHU_APP_SECRET") or os.getenv("LARK_APP_SECRET")
    app_token = os.getenv("FEISHU_BITABLE_APP_TOKEN", TARGET_BASE_TOKEN)
    table_id = os.getenv("FEISHU_BITABLE_TABLE_ID", TARGET_TABLE_ID)
    if not all([app_id, app_secret, app_token, table_id]):
        print("Feishu is not configured; records remain pending.")
        return False
    token_data = fetch_with_retry(
        "POST",
        "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
        json={"app_id": app_id, "app_secret": app_secret},
        headers={"Content-Type": "application/json"},
    )
    if token_data.get("code") != 0:
        print(f"Feishu auth failed: {token_data.get('msg')}")
        return False
    access_token = token_data["tenant_access_token"]
    table_field_names = fetch_feishu_table_field_names(access_token, app_token, table_id)
    if not table_field_names:
        print("Feishu table fields could not be loaded; upload aborted.")
        return False
    uploaded = 0
    url = f"https://open.feishu.cn/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/records/batch_create"
    for index in range(0, len(candidates), 200):
        batch = candidates[index:index + 200]
        records = [
            {"fields": adapt_fields_to_feishu_table(record_to_feishu_fields(record), table_field_names)}
            for record in batch
        ]
        data = fetch_with_retry(
            "POST",
            url,
            headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
            json={"records": records},
        )
        if data.get("code") == 0:
            uploaded += len(batch)
        else:
            print(f"Feishu batch failed: {data.get('msg')}")
    print(f"Feishu upload complete: {uploaded}/{len(candidates)}")
    return uploaded > 0


def build_evidence_bundle(args: Any) -> int:
    init_environment()
    source = getattr(args, "input", None) or input_dir()
    bundle_dir = write_excel_evidence_bundle(source, OUTPUT_DIR / "evidence")
    print(f"Codex evidence bundle: {bundle_dir}")
    print(f"Target Base: {TARGET_BASE_TOKEN}, table: {TARGET_TABLE_ID}, view: {TARGET_VIEW_ID}")
    print(f"Fill candidate_template.json after reading the evidence, then run aggregate --raw-candidates <file>.")
    return 0


def aggregate_candidates(args: Any, *, write_db: bool, sync: bool) -> int:
    init_environment()
    raw_candidates = getattr(args, "raw_candidates", None)
    if not raw_candidates:
        print("No candidate file provided. Use --raw-candidates <json>.")
        return 1
    records = load_candidate_records(raw_candidates)
    valid, invalid = validate_candidate_records(records, require_evidence=not getattr(args, "no_require_evidence", False))
    if invalid:
        report = save_invalid_report(invalid)
        print(f"Invalid candidates: {len(invalid)}. Report: {report}")
        return 1
    if not valid:
        print("No valid candidates found.")
        return 1
    json_path, csv_path = save_final_output(valid)
    ids: list[int] = []
    if write_db:
        db = get_db()
        try:
            ids = save_candidates_to_db(db, valid)
            if sync and sync_to_feishu(valid, False):
                mark_candidates_synced(db, ids)
        finally:
            db.close()
    print(f"Validated candidates: {len(valid)}")
    print(f"JSON: {json_path}")
    print(f"CSV: {csv_path}")
    return 0


def run_pipeline(args: Any) -> int:
    if getattr(args, "raw_candidates", None):
        return aggregate_candidates(args, write_db=not getattr(args, "dry_run", False), sync=not getattr(args, "dry_run", False))
    return build_evidence_bundle(args)


def action_extract(args: Any) -> int:
    return build_evidence_bundle(args)


def action_aggregate(args: Any) -> int:
    return aggregate_candidates(args, write_db=not getattr(args, "dry_run", False), sync=False)


def list_pending(db: sqlite3.Connection) -> list[sqlite3.Row]:
    return db.execute("SELECT id, brand, model, trim_config, stock_quantity, cost_fca_usd, status FROM source_candidates WHERE status = 'pending'").fetchall()


def action_list() -> int:
    init_environment()
    db = get_db()
    try:
        rows = list_pending(db)
        if not rows:
            print("No pending candidate records found in local_source.db.")
            return 0
        for row in rows:
            print(dict(row))
        return 0
    finally:
        db.close()


def action_edit(record_id: str, key: str, value: str) -> int:
    if key not in (*WRITABLE_FIELDS, "status"):
        print(f"Invalid column key: {key}")
        return 1
    init_environment()
    db = get_db()
    try:
        db.execute(f"UPDATE source_candidates SET {key} = ? WHERE id = ?", (value, record_id))
        db.commit()
        print(f"Updated record #{record_id}: {key} = {value}")
        return 0
    finally:
        db.close()


def action_delete(record_id: str) -> int:
    init_environment()
    db = get_db()
    try:
        db.execute("DELETE FROM source_candidates WHERE id = ?", (record_id,))
        db.commit()
        print(f"Deleted record #{record_id}")
        return 0
    finally:
        db.close()


def action_clean() -> int:
    init_environment()
    db = get_db()
    try:
        count = db.execute("DELETE FROM source_candidates").rowcount
        db.commit()
        print(f"Cleaned {count} records from local_source.db.")
        return 0
    finally:
        db.close()


def action_sync(dry_run: bool = False) -> int:
    init_environment()
    db = get_db()
    try:
        rows = [dict(row) for row in db.execute("SELECT * FROM source_candidates WHERE status = 'pending'").fetchall()]
        if not rows:
            print("No pending records to sync in local_source.db.")
            return 0
        if sync_to_feishu(rows, dry_run) and not dry_run:
            mark_candidates_synced(db, [int(row["id"]) for row in rows])
        return 0
    finally:
        db.close()
