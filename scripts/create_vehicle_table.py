"""
创建新的飞书 Bitable 车源表（含 harvest 闭环所需字段）。
运行: python scripts/create_vehicle_table.py
"""

import json
import os
import sys
import ssl
import urllib.request

ssl._create_default_https_context = ssl._create_unverified_context


def load_env():
    if os.path.exists(".env"):
        with open(".env", "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ[k.strip()] = v.strip()


def api_request(method, url, token, body=None):
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    data = json.dumps(body).encode("utf-8") if body else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req) as r:
        res = json.loads(r.read().decode("utf-8"))
    if res.get("code") != 0:
        print(f"❌ API Error: {res.get('msg')} (code={res.get('code')})")
        print(f"   URL: {url}")
        if body:
            print(f"   Body: {json.dumps(body, ensure_ascii=False)[:300]}")
        sys.exit(1)
    return res


def get_tenant_access_token(app_id, app_secret):
    url = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal"
    data = json.dumps({"app_id": app_id, "app_secret": app_secret}).encode("utf-8")
    req = urllib.request.Request(
        url, data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req) as r:
        res = json.loads(r.read().decode("utf-8"))
    if res.get("code") != 0:
        print(f"❌ Auth failed: {res.get('msg')}")
        sys.exit(1)
    return res["tenant_access_token"]


# ──────────────────────────────────────────────
# 新表字段定义 (严格匹配 schema.py VEHICLE_FIELDS + harvest 需求)
# ──────────────────────────────────────────────
# Feishu field type codes:
#   1=Text, 2=Number, 3=SingleSelect, 4=MultiSelect, 5=DateTime
#
# 注意: 飞书建表 API 第一列（主索引列）在 create table 时指定，
# 后续列通过 add_field API 逐个添加。

TABLE_NAME = "vehicle_sources"

# 第一列（主索引） — 用自增整数 record_id 做唯一标识，给 harvest snapshot 匹配用
PRIMARY_FIELD = {
    "field_name": "record_id",
    "type": 1,  # Text
}

# 后续列 — 严格按 VEHICLE_FIELDS 顺序 + 额外 harvest/业务字段
ADDITIONAL_FIELDS = [
    # ── 核心车源字段 (from VEHICLE_FIELDS) ──
    {"field_name": "supplier",           "type": 1},   # Text
    {"field_name": "brand",              "type": 3,    # SingleSelect
     "property": {"options": []}},
    {"field_name": "model",              "type": 1},   # Text
    {"field_name": "model_id",           "type": 1},   # Text
    {"field_name": "variant",            "type": 1},   # Text
    {"field_name": "variant_id",         "type": 1},   # Text
    {"field_name": "manufacture_year",   "type": 2,    # Number
     "property": {"formatter": "0"}},
    {"field_name": "manufacture_month",  "type": 2,
     "property": {"formatter": "0"}},
    {"field_name": "exterior_color",     "type": 1},   # Text
    {"field_name": "interior_color",     "type": 1},   # Text
    {"field_name": "stock_quantity",     "type": 2,
     "property": {"formatter": "0"}},
    {"field_name": "min_quantity",       "type": 2,
     "property": {"formatter": "0"}},
    {"field_name": "max_quantity",       "type": 2,
     "property": {"formatter": "0"}},
    {"field_name": "lead_time",          "type": 5,    # DateTime
     "property": {"date_formatter": "yyyy/MM/dd", "auto_fill": False}},
    {"field_name": "order_wait_days",    "type": 2,
     "property": {"formatter": "0"}},
    {"field_name": "steering_setup",     "type": 3,    # SingleSelect
     "property": {"options": [
         {"name": "左舵"},
         {"name": "右舵"},
     ]}},
    {"field_name": "version_type",       "type": 3,    # SingleSelect (旧表是 MultiSelect 不合理，改回)
     "property": {"options": [
         {"name": "国内版"},
         {"name": "国际版"},
     ]}},
    {"field_name": "status_vehicle",     "type": 3,    # SingleSelect (新增)
     "property": {"options": [
         {"name": "现车"},
         {"name": "在途"},
         {"name": "无具体信息"},
     ]}},
    {"field_name": "supplier_price_cny", "type": 2,
     "property": {"formatter": "0"}},
    {"field_name": "cost_exw_usd",       "type": 2,
     "property": {"formatter": "0"}},
    {"field_name": "cost_fob_usd",       "type": 2,
     "property": {"formatter": "0"}},
    {"field_name": "cost_fca_usd",       "type": 2,
     "property": {"formatter": "0"}},
    {"field_name": "location",           "type": 1},   # Text
    {"field_name": "confidence",         "type": 2,    # Number (0.00-1.00)
     "property": {"formatter": "0.00"}},
    {"field_name": "notes",              "type": 1},   # Text

    # ── 业务管控字段 (从旧表保留) ──
    {"field_name": "display_price_low",  "type": 2,
     "property": {"formatter": "0"}},
    {"field_name": "display_price_high", "type": 2,
     "property": {"formatter": "0"}},
    {"field_name": "source_file",        "type": 1},   # Text — 标记数据来源文件名

    # ── Harvest 闭环专用字段 ──
    {"field_name": "sync_batch_id",      "type": 1},   # Text — 标记是哪批 sync 写入的 (时间戳)
]


def main():
    load_env()

    app_id = os.getenv("FEISHU_APP_ID")
    app_secret = os.getenv("FEISHU_APP_SECRET")
    app_token = os.getenv("FEISHU_BITABLE_APP_TOKEN")

    if not all([app_id, app_secret, app_token]):
        print("❌ Missing FEISHU_APP_ID, FEISHU_APP_SECRET, or FEISHU_BITABLE_APP_TOKEN in .env")
        sys.exit(1)

    print("⌛ Authenticating with Feishu...")
    token = get_tenant_access_token(app_id, app_secret)
    print("✅ Authenticated.\n")

    # Step 1: Create table with primary field
    print(f'⌛ Creating table "{TABLE_NAME}" ...')
    create_url = f"https://open.feishu.cn/open-apis/bitable/v1/apps/{app_token}/tables"
    res = api_request("POST", create_url, token, {
        "table": {
            "name": TABLE_NAME,
            "default_view_name": "全部车源",
            "fields": [PRIMARY_FIELD],
        }
    })
    table_id = res["data"]["table_id"]
    print(f"✅ Table created: {table_id}\n")

    # Step 2: Add all additional fields
    add_field_url = f"https://open.feishu.cn/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/fields"
    total = len(ADDITIONAL_FIELDS)
    for i, field_def in enumerate(ADDITIONAL_FIELDS, 1):
        name = field_def["field_name"]
        print(f"  [{i:2d}/{total}] Adding field: {name} ... ", end="", flush=True)
        api_request("POST", add_field_url, token, field_def)
        print("✅")

    print(f"\n{'='*60}")
    print(f"🎉 新表创建完成！")
    print(f"   表名: {TABLE_NAME}")
    print(f"   Table ID: {table_id}")
    print(f"   字段数: {total + 1} (含主索引)")
    print(f"\n💡 请更新 .env 文件:")
    print(f"   FEISHU_BITABLE_TABLE_ID={table_id}")
    print(f"   FEISHU_TABLE_VEHICLES={table_id}")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
