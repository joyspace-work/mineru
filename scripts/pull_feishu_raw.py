import json
import urllib.request
import urllib.parse
import os
import sys
import ssl

ssl._create_default_https_context = ssl._create_unverified_context

def load_env():
    if os.path.exists(".env"):
        with open(".env", "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ[k.strip()] = v.strip()

def get_tenant_access_token(app_id, app_secret):
    url = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal"
    headers = {"Content-Type": "application/json"}
    data = json.dumps({"app_id": app_id, "app_secret": app_secret}).encode("utf-8")
    
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req) as r:
            res = json.loads(r.read().decode("utf-8"))
            if res.get("code") == 0:
                return res.get("tenant_access_token")
            else:
                print(f"❌ Failed to get tenant_access_token: {res.get('msg')}")
    except Exception as e:
        print(f"❌ Error fetching tenant token: {e}")
    return None

def fetch_tables(token, app_token):
    url = f"https://open.feishu.cn/open-apis/bitable/v1/apps/{app_token}/tables?page_size=100"
    headers = {"Authorization": f"Bearer {token}"}
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req) as r:
            res = json.loads(r.read().decode("utf-8"))
            if res.get("code") == 0:
                return res.get("data", {}).get("items", [])
            else:
                print(f"❌ Failed to fetch tables: {res.get('msg')}")
    except Exception as e:
        print(f"❌ Error fetching tables: {e}")
    return []

def fetch_table_fields(token, app_token, table_id):
    fields = []
    page_token = None
    headers = {"Authorization": f"Bearer {token}"}
    
    while True:
        url = f"https://open.feishu.cn/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/fields?page_size=100"
        if page_token:
            url += f"&page_token={page_token}"
            
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req) as r:
                res = json.loads(r.read().decode("utf-8"))
                if res.get("code") == 0:
                    data = res.get("data", {})
                    fields.extend(data.get("items") or [])
                    page_token = data.get("page_token")
                    has_more = data.get("has_more", False)
                    if not has_more or not page_token:
                        break
                else:
                    print(f"❌ Failed to fetch fields for table {table_id}: {res.get('msg')}")
                    break
        except Exception as e:
            print(f"❌ Error fetching fields for table {table_id}: {e}")
            break
    return fields

def fetch_table_records(token, app_token, table_id):
    records = []
    page_token = None
    headers = {"Authorization": f"Bearer {token}"}
    
    while True:
        url = f"https://open.feishu.cn/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/records?page_size=500"
        if page_token:
            url += f"&page_token={page_token}"
            
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req) as r:
                res = json.loads(r.read().decode("utf-8"))
                if res.get("code") == 0:
                    data = res.get("data", {})
                    records.extend(data.get("items") or [])
                    page_token = data.get("page_token")
                    has_more = data.get("has_more", False)
                    if not has_more or not page_token:
                        break
                else:
                    print(f"❌ Failed to fetch records for table {table_id}: {res.get('msg')}")
                    break
        except Exception as e:
            print(f"❌ Error fetching records for table {table_id}: {e}")
            break
    return records

def sanitize_filename(name):
    # Keep alphanumeric characters and common Chinese characters, replace others
    import re
    return re.sub(r'[\\/*?:"<>|]', "_", name)

def main():
    load_env()
    
    app_id = os.getenv("FEISHU_APP_ID")
    app_secret = os.getenv("FEISHU_APP_SECRET")
    
    # Target app token provided by the user
    target_app_token = "Is6Xb3btbazhFhsDXgFcqFG1nRc"
    
    if not app_id or not app_secret:
        print("❌ Error: FEISHU_APP_ID or FEISHU_APP_SECRET environment variable is missing.")
        sys.exit(1)
        
    print("⌛ Retrieving Feishu tenant access token...")
    token = get_tenant_access_token(app_id, app_secret)
    if not token:
        print("❌ Failed to authenticate with Feishu API.")
        sys.exit(1)
        
    # Create the output directory for Feishu tables
    out_dir = "feishu_tables"
    os.makedirs(out_dir, exist_ok=True)
    print(f"📁 Created folder: '{out_dir}/'")
    
    print(f"⌛ Fetching tables list for App Token: {target_app_token}...")
    tables = fetch_tables(token, target_app_token)
    if not tables:
        print("❌ No tables metadata retrieved.")
        sys.exit(1)
        
    print(f"✅ Found {len(tables)} tables.")
    
    # Save global tables metadata verbatim
    tables_meta_path = os.path.join(out_dir, "tables_metadata.json")
    with open(tables_meta_path, "w", encoding="utf-8") as f:
        json.dump(tables, f, ensure_ascii=False, indent=2)
    print(f"📝 Saved tables list metadata to {tables_meta_path}")
    
    # Clean up any obsolete separate files from previous runs to prevent clutter
    for file_name in os.listdir(out_dir):
        if file_name.endswith("_fields.json") or file_name.endswith("_records.json"):
            try:
                os.remove(os.path.join(out_dir, file_name))
            except Exception:
                pass

    for t in tables:
        table_id = t.get("table_id")
        table_name = t.get("name", "Untitled")
        safe_name = sanitize_filename(table_name)
        
        print(f"\n⌛ Pulling Table: '{table_name}' ({table_id})...")
        
        # 1. Fetch raw field definitions (schema metadata)
        fields = fetch_table_fields(token, target_app_token, table_id)
        
        # 2. Fetch raw records
        raw_records = fetch_table_records(token, target_app_token, table_id)
        
        # 3. Flatten records: bubble fields key-values to top level along with metadata for high usability
        flattened_records = []
        for r in raw_records:
            flattened = {
                "record_id": r.get("record_id"),
                "created_time": r.get("created_time"),
                "last_modified_time": r.get("last_modified_time"),
                "created_by": r.get("created_by"),
                "last_modified_by": r.get("last_modified_by")
            }
            # Unpack all verbatim fields into the top level of the record object
            fields_data = r.get("fields", {})
            for key, val in fields_data.items():
                flattened[key] = val
            flattened_records.append(flattened)
            
        # 4. Save fields and flattened records together into a unified structure
        unified_table_data = {
            "table_id": table_id,
            "table_name": table_name,
            "fields_definition": fields,
            "records": flattened_records
        }
        
        unified_path = os.path.join(out_dir, f"{safe_name}.json")
        with open(unified_path, "w", encoding="utf-8") as f:
            json.dump(unified_table_data, f, ensure_ascii=False, indent=2)
        print(f"  └─ Merged and saved unified table data to {unified_path} (Pulled {len(fields)} fields, {len(flattened_records)} records).")

    print(f"\n🎉 Success! All Bitable raw details and metadata exported verbatim to '{out_dir}/' directory.")

if __name__ == "__main__":
    main()
