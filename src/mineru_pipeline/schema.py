from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal, Sequence

@dataclass(frozen=True)
class FieldSpec:
    db_column: str          # SQLite DB column name (snake_case lowercase)
    feishu_name: str        # Feishu Bitable field name (strictly snake_case lowercase)
    pydantic_name: str      # Internal / Pydantic field name
    sql_type: str           # SQLite column data type (TEXT, INTEGER, REAL)
    excel_aliases: tuple[str, ...] # Excel header aliases that map to this field
    feishu_type: str        # Feishu field type (text, number, single_select, date)
    description: str        # Human readable description

# ==============================================================================
# SINGLE SOURCE OF TRUTH (SSOT) FIELD REGISTRY
# All vehicle source candidate fields are defined ONLY HERE.
# Strict Rules:
# 1. Field names must be lowercase snake_case (e.g., supplier_price_cny, ocr_raw, confidence).
# 2. Numeric price/qty fields are strictly INTEGER.
# 3. confidence is REAL (0.00-1.00 float).
# 4. Except brand & model (English/Pinyin), ALL values are strictly CHINESE.
# 5. steering_setup: "左舵" / "右舵"
# 6. version_type: "国内版" / "国际版"
# 7. status_vehicle: "现车" / "在途" / "无具体信息"
# ==============================================================================
VEHICLE_FIELDS: tuple[FieldSpec, ...] = (
    FieldSpec(
        db_column="supplier",
        feishu_name="supplier",
        pydantic_name="supplierName",
        sql_type="TEXT",
        excel_aliases=("供应商", "经销商", "报价方", "supplier", "suppliername"),
        feishu_type="text",
        description="一级供应商名称",
    ),
    FieldSpec(
        db_column="brand",
        feishu_name="brand",
        pydantic_name="brand",
        sql_type="TEXT",
        excel_aliases=("品牌", "车辆品牌", "厂商", "brand"),
        feishu_type="single_select",
        description="车辆品牌(英文/拼音规范化)",
    ),
    FieldSpec(
        db_column="model",
        feishu_name="model",
        pydantic_name="model",
        sql_type="TEXT",
        excel_aliases=("车型", "型号", "车款", "产品名称", "产品", "车辆名称", "车型名称", "系列", "车系", "子品牌", "项目名称", "model", "modelname", "series", "modelcode"),
        feishu_type="text",
        description="车型名称(英文/拼音规范化)",
    ),
    FieldSpec(
        db_column="model_id",
        feishu_name="model_id",
        pydantic_name="model_id",
        sql_type="TEXT",
        excel_aliases=("model_id", "modelid", "车型id"),
        feishu_type="text",
        description="对应车型表中的 model_id (如 MDL-002)",
    ),
    FieldSpec(
        db_column="trim_config",
        feishu_name="trim_config",
        pydantic_name="trimName",
        sql_type="TEXT",
        excel_aliases=("主要配置描述", "配置描述", "车辆配置", "配置版本", "款型", "细分车型", "配置", "版本", "variant", "trim", "trimname", "规格", "车型版本"),
        feishu_type="text",
        description="细分车型/配置版本(对应 vehicle_variants 中的 variant 字段)",
    ),
    FieldSpec(
        db_column="manufacture_year",
        feishu_name="manufacture_year",
        pydantic_name="manufactureYear",
        sql_type="INTEGER",
        excel_aliases=("生产年份", "制造年份", "出厂年份", "年份", "年款", "year", "manufacture_year", "manufactureyear"),
        feishu_type="number",
        description="生产年份(整数/可空)",
    ),
    FieldSpec(
        db_column="manufacture_month",
        feishu_name="manufacture_month",
        pydantic_name="manufactureMonth",
        sql_type="INTEGER",
        excel_aliases=("生产月份", "制造月份", "出厂月份", "月份", "month", "manufacture_month", "manufacturemonth"),
        feishu_type="number",
        description="生产月份(整数/可空)",
    ),
    FieldSpec(
        db_column="exterior_color",
        feishu_name="exterior_color",
        pydantic_name="exteriorColor",
        sql_type="TEXT",
        excel_aliases=("外观颜色", "车身颜色", "外观", "颜色", "color", "exteriorcolor"),
        feishu_type="text",
        description="外观颜色",
    ),
    FieldSpec(
        db_column="interior_color",
        feishu_name="interior_color",
        pydantic_name="interiorColor",
        sql_type="TEXT",
        excel_aliases=("内饰颜色", "内饰", "interiorcolor"),
        feishu_type="text",
        description="内饰颜色",
    ),
    FieldSpec(
        db_column="stock_quantity",
        feishu_name="stock_quantity",
        pydantic_name="stockQuantity",
        sql_type="INTEGER",
        excel_aliases=("库存", "数量", "台数", "可订数量", "qty", "在库数量", "现货", "stockquantity"),
        feishu_type="number",
        description="库存数量(整数)",
    ),
    FieldSpec(
        db_column="min_quantity",
        feishu_name="min_quantity",
        pydantic_name="minQuantity",
        sql_type="INTEGER",
        excel_aliases=("起订量", "最小起订量", "minquantity"),
        feishu_type="number",
        description="阶梯起订量下限(整数)",
    ),
    FieldSpec(
        db_column="max_quantity",
        feishu_name="max_quantity",
        pydantic_name="maxQuantity",
        sql_type="INTEGER",
        excel_aliases=("最大量", "上限", "maxquantity"),
        feishu_type="number",
        description="阶梯起订量上限(整数)",
    ),
    FieldSpec(
        db_column="lead_time",
        feishu_name="lead_time",
        pydantic_name="leadTime",
        sql_type="TEXT",
        excel_aliases=("货期", "交付月份", "交付时间", "leadtime"),
        feishu_type="date",
        description="具体交付日期 (YYYY-MM-DD)",
    ),
    FieldSpec(
        db_column="order_wait_days",
        feishu_name="order_wait_days",
        pydantic_name="orderWaitDays",
        sql_type="INTEGER",
        excel_aliases=("等待天数", "交期天数", "等待周期", "订车周期", "等待时间", "交期", "orderwaitdays", "orderwaitingperiod"),
        feishu_type="number",
        description="订单等待整数天数(整数)",
    ),
    FieldSpec(
        db_column="steering_setup",
        feishu_name="steering_setup",
        pydantic_name="steeringSetup",
        sql_type="TEXT",
        excel_aliases=("左右舵", "方向盘", "舵向", "steeringsetup"),
        feishu_type="single_select",
        description="舵向位置 (左舵/右舵单选)",
    ),
    FieldSpec(
        db_column="version_type",
        feishu_name="version_type",
        pydantic_name="marketRegion",
        sql_type="TEXT",
        excel_aliases=("版本分类", "规格版本", "市场版本", "versiontype"),
        feishu_type="single_select",
        description="国内外版本 (国内版/国际版单选)",
    ),
    FieldSpec(
        db_column="status_vehicle",
        feishu_name="status_vehicle",
        pydantic_name="statusVehicle",
        sql_type="TEXT",
        excel_aliases=("车辆状态", "状态", "status", "statusvehicle"),
        feishu_type="single_select",
        description="车辆状态 (现车/在途/无具体信息单选)",
    ),
    FieldSpec(
        db_column="supplier_price_cny",
        feishu_name="supplier_price_cny",
        pydantic_name="supplierPriceCny",
        sql_type="INTEGER",
        excel_aliases=("对标国内指导价", "国内指导价", "市场指导价", "官方指导价", "指导价", "建议零售价", "msrp", "supplierpricecny", "officialpricecny"),
        feishu_type="number",
        description="供应商指导价/报价(RMB/严格依源数据/无则留空)",
    ),
    FieldSpec(
        db_column="cost_exw_usd",
        feishu_name="cost_exw_usd",
        pydantic_name="costExwUsd",
        sql_type="INTEGER",
        excel_aliases=("出厂价", "exw", "exw价格", "出厂报价", "工厂价", "裸车价", "不含税价", "含税价", "国内价格", "单价", "价格", "costexwusd"),
        feishu_type="number",
        description="EXW 成本价(USD/取整整数)",
    ),
    FieldSpec(
        db_column="cost_fob_usd",
        feishu_name="cost_fob_usd",
        pydantic_name="costFobUsd",
        sql_type="INTEGER",
        excel_aliases=("fob", "fob价格", "fob价", "离岸价", "costfobusd"),
        feishu_type="number",
        description="FOB 成本价(USD/取整整数)",
    ),
    FieldSpec(
        db_column="cost_fca_usd",
        feishu_name="cost_fca_usd",
        pydantic_name="costFcaUsd",
        sql_type="INTEGER",
        excel_aliases=("fca", "fca价格", "costfcausd"),
        feishu_type="number",
        description="FCA 成本价(USD/取整整数)",
    ),
    FieldSpec(
        db_column="location",
        feishu_name="location",
        pydantic_name="location",
        sql_type="TEXT",
        excel_aliases=("提货地", "发货地", "仓库", "地点", "发运地", "出发港", "港口", "location"),
        feishu_type="text",
        description="提货地点/港口(保持中文地名)",
    ),
    FieldSpec(
        db_column="confidence",
        feishu_name="confidence",
        pydantic_name="confidence",
        sql_type="REAL",
        excel_aliases=("confidence", "ocr_confidence", "置信度", "识别置信度"),
        feishu_type="number",
        description="识别置信度 (0.00-1.00浮点数)",
    ),
    FieldSpec(
        db_column="notes",
        feishu_name="notes",
        pydantic_name="notes",
        sql_type="TEXT",
        excel_aliases=("备注", "说明", "notes", "remark"),
        feishu_type="text",
        description="人工/系统补充备注（保存车源原始文本描述、车源额外说明及未入列补充信息）",
    ),
)


# ==============================================================================
# DYNAMIC SCHEMA GENERATORS
# Derived directly from VEHICLE_FIELDS SSOT
# ==============================================================================

def get_create_table_sql(table_name: str = "source_candidates") -> str:
    """Generates the CREATE TABLE SQL query for SQLite based on SSOT fields."""
    cols_sql = [
        "id INTEGER PRIMARY KEY AUTOINCREMENT",
    ]
    for field in VEHICLE_FIELDS:
        cols_sql.append(f"  {field.db_column} {field.sql_type}")
    cols_sql.extend([
        "  status TEXT DEFAULT 'pending'",
        "  source_file TEXT",
        "  content_hash TEXT",
        "  created_at DATETIME DEFAULT CURRENT_TIMESTAMP",
    ])
    cols_str = ",\n".join(cols_sql)
    return f"CREATE TABLE IF NOT EXISTS {table_name} (\n{cols_str}\n)"


def get_feishu_field_map() -> dict[str, str]:
    """Returns DB column -> Feishu bitable column name mapping (all lowercase snake_case)."""
    return {field.db_column: field.feishu_name for field in VEHICLE_FIELDS}


def get_header_aliases() -> dict[str, str]:
    """Returns Excel header alias -> internal pydantic_name mapping."""
    aliases: dict[str, str] = {}
    for field in VEHICLE_FIELDS:
        for alias in field.excel_aliases:
            aliases[alias] = field.pydantic_name
    return aliases


def get_allowed_edit_keys() -> set[str]:
    """Returns allowed column names for CLI editing."""
    return {field.db_column for field in VEHICLE_FIELDS}


def get_pydantic_vehicle_schema():
    """Dynamically derives Pydantic VehicleCandidateSchema from SSOT VEHICLE_FIELDS with Chinese enum constraints."""
    try:
        from pydantic import create_model, Field
    except ImportError:
        return None

    field_definitions: dict[str, Any] = {}
    for field in VEHICLE_FIELDS:
        if field.pydantic_name == "steeringSetup":
            py_type = Literal["左舵", "右舵", "LHD", "RHD"] | None
        elif field.pydantic_name == "marketRegion":
            py_type = Literal["国内版", "国际版", "Domestic Version", "International Version"] | None
        elif field.pydantic_name == "statusVehicle":
            py_type = Literal["现车", "在途", "无具体信息", "In Stock", "In Transit", "No Info"] | None
        elif field.sql_type == "INTEGER":
            py_type = int | str | None
        elif field.sql_type == "REAL":
            py_type = float | int | str | None
        else:
            py_type = str | None
        field_definitions[field.pydantic_name] = (py_type, Field(default=None, description=field.description))

    field_definitions["year"] = (int | str | None, Field(default=None, description="年款"))
    field_definitions["priceExw"] = (int | str | None, Field(default=None, description="EXW价格"))
    field_definitions["priceFob"] = (int | str | None, Field(default=None, description="FOB价格"))
    field_definitions["priceFca"] = (int | str | None, Field(default=None, description="FCA价格"))

    return create_model("VehicleCandidateSchema", **field_definitions)
