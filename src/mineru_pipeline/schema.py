from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, Sequence

import re
from pydantic import BaseModel, Field

class VehicleCandidateModel(BaseModel):
    brand: str | None = None
    modelName: str | None = None
    variant: str | None = Field(default=None, alias="trimConfig")
    exteriorColor: str | None = None
    interiorColor: str | None = None
    priceExw: float | None = None
    priceFob: float | None = None
    priceFca: float | None = None
    priceCif: float | None = None
    supplierPriceCny: float | None = None
    officialSuggestedPriceCny: float | None = None
    stockQuantity: int | None = None
    location: str | None = None
    steering: str | None = None
    vinStatus: str | None = None
    notes: str | None = None

class VehicleBatchResponse(BaseModel):
    candidates: list[VehicleCandidateModel] = Field(default_factory=list)

logger = logging.getLogger(__name__)

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
        db_column="variant",
        feishu_name="variant",
        pydantic_name="variant",
        sql_type="TEXT",
        excel_aliases=("主要配置描述", "配置描述", "车辆配置", "配置版本", "款型", "细分车型", "配置", "版本", "variant", "trim", "trimname", "trim_config", "trimconfig", "规格", "车型版本"),
        feishu_type="text",
        description="细分车型/配置版本(对应 vehicle_variants 中的 variant 字段)",
    ),
    FieldSpec(
        db_column="variant_id",
        feishu_name="variant_id",
        pydantic_name="variant_id",
        sql_type="TEXT",
        excel_aliases=("variant_id", "variantid", "trim_config_id", "trimconfigid", "配置id", "版本id"),
        feishu_type="text",
        description="对应配置版本表中的 variant_id (如 MDL-004-6394-2)",
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
        excel_aliases=("等待天数", "交期天数", "等待周期", "订车周期", "等待时间", "交期", "货期", "orderwaitdays", "orderwaitingperiod"),
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


# ==============================================================================
# BRAND & MODEL OFFICIAL MAPPING DICTIONARY (SSOT)
# ==============================================================================
BRAND_MODEL_MAPPINGS: list[dict[str, str]] = [
    {"raw_brand": "Smart", "raw_model": "#1", "brand": "Smart", "model": "#1"},
    {"raw_brand": "Smart", "raw_model": "Smart #1", "brand": "Smart", "model": "#1"},
    {"raw_brand": "Smart", "raw_model": "#3", "brand": "Smart", "model": "#3"},
    {"raw_brand": "Smart", "raw_model": "Smart #3", "brand": "Smart", "model": "#3"},
    {"raw_brand": "Smart", "raw_model": "#5", "brand": "Smart", "model": "#5"},
    {"raw_brand": "Smart", "raw_model": "Smart #5", "brand": "Smart", "model": "#5"},
    {"raw_brand": "吉利", "raw_model": "A7", "brand": "Geely", "model": "Galaxy A7"},
    {"raw_brand": "吉利", "raw_model": "a7", "brand": "Geely", "model": "Galaxy A7"},
    {"raw_brand": "吉利", "raw_model": "A7 EM-i", "brand": "Geely", "model": "Galaxy A7"},
    {"raw_brand": "吉利", "raw_model": "银河A7", "brand": "Geely", "model": "Galaxy A7"},
    {"raw_brand": "吉利", "raw_model": "牛仔", "brand": "Geely", "model": "Cowboy"},
    {"raw_brand": "吉利", "raw_model": "吉利牛仔", "brand": "Geely", "model": "Cowboy"},
    {"raw_brand": "吉利", "raw_model": "全新牛仔", "brand": "Geely", "model": "Cowboy"},
    {"raw_brand": "吉利", "raw_model": "星耀6", "brand": "Geely", "model": "Starshine 6"},
    {"raw_brand": "奥迪", "raw_model": "A7", "brand": "Audi", "model": "A7"},
    {"raw_brand": "Audi", "raw_model": "A7", "brand": "Audi", "model": "A7"},
    {"raw_brand": "问界", "raw_model": "M9", "brand": "AITO", "model": "M9"},
    {"raw_brand": "比亚迪", "raw_model": "海豚", "brand": "BYD", "model": "Dolphin"},
    {"raw_brand": "比亚迪", "raw_model": "Dolphin", "brand": "BYD", "model": "Dolphin"},
    {"raw_brand": "比亚迪", "raw_model": "汉 EV", "brand": "BYD", "model": "Han EV"},
    {"raw_brand": "比亚迪", "raw_model": "Han EV", "brand": "BYD", "model": "Han EV"},
    {"raw_brand": "比亚迪", "raw_model": "秦 PLUS", "brand": "BYD", "model": "Qin PLUS EV"},
    {"raw_brand": "比亚迪", "raw_model": "Qin PLUS EV", "brand": "BYD", "model": "Qin PLUS EV"},
    {"raw_brand": "比亚迪", "raw_model": "海鸥", "brand": "BYD", "model": "Seagull"},
    {"raw_brand": "比亚迪", "raw_model": "Seagull", "brand": "BYD", "model": "Seagull"},
    {"raw_brand": "比亚迪", "raw_model": "海豹", "brand": "BYD", "model": "Seal"},
    {"raw_brand": "比亚迪", "raw_model": "Seal", "brand": "BYD", "model": "Seal"},
    {"raw_brand": "比亚迪", "raw_model": "海狮05EV", "brand": "BYD", "model": "Sealion 7"},
    {"raw_brand": "比亚迪", "raw_model": "海狮05 EV", "brand": "BYD", "model": "Sealion 7"},
    {"raw_brand": "比亚迪", "raw_model": "海狮05ev", "brand": "BYD", "model": "Sealion 7"},
    {"raw_brand": "比亚迪", "raw_model": "海狮 05", "brand": "BYD", "model": "Sealion 7"},
    {"raw_brand": "比亚迪", "raw_model": "海狮05", "brand": "BYD", "model": "Sealion 7"},
    {"raw_brand": "BYD", "raw_model": "海狮05EV", "brand": "BYD", "model": "Sealion 7"},
    {"raw_brand": "BYD", "raw_model": "海狮05 EV", "brand": "BYD", "model": "Sealion 7"},
    {"raw_brand": "BYD", "raw_model": "海狮05ev", "brand": "BYD", "model": "Sealion 7"},
    {"raw_brand": "BYD", "raw_model": "海狮 05", "brand": "BYD", "model": "Sealion 7"},
    {"raw_brand": "BYD", "raw_model": "海狮05", "brand": "BYD", "model": "Sealion 7"},
    {"raw_brand": "比亚迪", "raw_model": "海狮07EV", "brand": "BYD", "model": "Sealion 7"},
    {"raw_brand": "BYD", "raw_model": "海狮07EV", "brand": "BYD", "model": "Sealion 7"},
    {"raw_brand": "比亚迪", "raw_model": "海狮 7", "brand": "BYD", "model": "Sealion 7"},
    {"raw_brand": "BYD", "raw_model": "海狮 7", "brand": "BYD", "model": "Sealion 7"},
    {"raw_brand": "比亚迪", "raw_model": "Sealion 7", "brand": "BYD", "model": "Sealion 7"},
    {"raw_brand": "BYD", "raw_model": "Sealion 7", "brand": "BYD", "model": "Sealion 7"},
    {"raw_brand": "比亚迪", "raw_model": "鲨鱼", "brand": "BYD", "model": "Shark"},
    {"raw_brand": "比亚迪", "raw_model": "鲨鱼 6", "brand": "BYD", "model": "Shark"},
    {"raw_brand": "比亚迪", "raw_model": "Shark 6", "brand": "BYD", "model": "Shark"},
    {"raw_brand": "比亚迪", "raw_model": "唐 L EV", "brand": "BYD", "model": "Tang L EV"},
    {"raw_brand": "比亚迪", "raw_model": "Tang L EV", "brand": "BYD", "model": "Tang L EV"},
    {"raw_brand": "比亚迪", "raw_model": "元 UP", "brand": "BYD", "model": "Yuan UP"},
    {"raw_brand": "比亚迪", "raw_model": "Yuan UP", "brand": "BYD", "model": "Yuan UP"},
    {"raw_brand": "长安", "raw_model": "糯玉米", "brand": "Changan", "model": "Lumin"},
    {"raw_brand": "长安", "raw_model": "Lumin", "brand": "Changan", "model": "Lumin"},
    {"raw_brand": "长安", "raw_model": "Q05", "brand": "Changan", "model": "Q05"},
    {"raw_brand": "深蓝", "raw_model": "S05", "brand": "Deepal", "model": "S05"},
    {"raw_brand": "深蓝", "raw_model": "S07", "brand": "Deepal", "model": "S07"},
    {"raw_brand": "东风", "raw_model": "纳米01", "brand": "Dongfeng", "model": "Nammi 01"},
    {"raw_brand": "东风", "raw_model": "锐骐6 EV", "brand": "Dongfeng", "model": "Rich 6 EV"},
    {"raw_brand": "方程豹", "raw_model": "豹3", "brand": "Fangchengbao", "model": "Ti 3"},
    {"raw_brand": "方程豹", "raw_model": "铁3", "brand": "Fangchengbao", "model": "Ti 3"},
    {"raw_brand": "方程豹", "raw_model": "钛3", "brand": "Fangchengbao", "model": "Ti 3"},
    {"raw_brand": "方程豹", "raw_model": "Ti 3", "brand": "Fangchengbao", "model": "Ti 3"},
    {"raw_brand": "方程豹", "raw_model": "豹5", "brand": "Fangchengbao", "model": "Leopard 5"},
    {"raw_brand": "方程豹", "raw_model": "Leopard 5", "brand": "Fangchengbao", "model": "Leopard 5"},
    {"raw_brand": "方程豹", "raw_model": "豹7", "brand": "Fangchengbao", "model": "Ti 7"},
    {"raw_brand": "方程豹", "raw_model": "钛7", "brand": "Fangchengbao", "model": "Ti 7"},
    {"raw_brand": "方程豹", "raw_model": "TI7", "brand": "Fangchengbao", "model": "Ti 7"},
    {"raw_brand": "方程豹", "raw_model": "Ti 7", "brand": "Fangchengbao", "model": "Ti 7"},
    {"raw_brand": "方程豹", "raw_model": "豹8", "brand": "Fangchengbao", "model": "Leopard 8"},
    {"raw_brand": "方程豹", "raw_model": "Leopard 8", "brand": "Fangchengbao", "model": "Leopard 8"},
    {"raw_brand": "远程", "raw_model": "星享V", "brand": "Farizon", "model": "Xingxiang V"},
    {"raw_brand": "广汽埃安", "raw_model": "RT", "brand": "GAC Aion", "model": "RT"},
    {"raw_brand": "广汽埃安", "raw_model": "V", "brand": "GAC Aion", "model": "V"},
    {"raw_brand": "广汽埃安", "raw_model": "i60", "brand": "GAC Aion", "model": "i60"},
    {"raw_brand": "埃安", "raw_model": "Y Plus", "brand": "GAC Motor", "model": "Aion Y Plus"},
    {"raw_brand": "长城", "raw_model": "炮 EV", "brand": "GWM", "model": "Cannon EV"},
    {"raw_brand": "吉利", "raw_model": "银河 E5", "brand": "Geely", "model": "Galaxy E5"},
    {"raw_brand": "吉利", "raw_model": "银河 M9", "brand": "Geely", "model": "Galaxy M9"},
    {"raw_brand": "吉利", "raw_model": "几何", "brand": "Geely", "model": "Geome"},
    {"raw_brand": "吉利", "raw_model": "几何C", "brand": "Geely", "model": "Geometry C"},
    {"raw_brand": "红旗", "raw_model": "E-HS9", "brand": "Hongqi", "model": "E-HS9"},
    {"raw_brand": "零跑", "raw_model": "D19", "brand": "Leapmotor", "model": "D19"},
    {"raw_brand": "零跑", "raw_model": "Lafa 5", "brand": "Leapmotor", "model": "Lafa 5"},
    {"raw_brand": "零跑", "raw_model": "T03", "brand": "Leapmotor", "model": "T03"},
    {"raw_brand": "理想", "raw_model": "L6", "brand": "Li Auto", "model": "L6"},
    {"raw_brand": "领徽", "raw_model": "e7", "brand": "Linghui", "model": "e7"},
    {"raw_brand": "名爵", "raw_model": "MG4 EV", "brand": "MG", "model": "MG4 EV"},
    {"raw_brand": "雷达", "raw_model": "RD6", "brand": "Radar", "model": "RD6"},
    {"raw_brand": "享界", "raw_model": "S9", "brand": "Stelato", "model": "S9"},
    {"raw_brand": "坦克", "raw_model": "500", "brand": "Tank", "model": "500 Hi4-T"},
    {"raw_brand": "岚图", "raw_model": "泰山 X8", "brand": "Voyah", "model": "Taishan X8"},
    {"raw_brand": "五菱", "raw_model": "缤果 Plus", "brand": "Wuling", "model": "Bingo Plus"},
    {"raw_brand": "小鹏", "raw_model": "G9", "brand": "XPENG", "model": "G9"},
    {"raw_brand": "小米", "raw_model": "SU7 Ultra", "brand": "Xiaomi", "model": "SU7 Ultra"},
    {"raw_brand": "小米", "raw_model": "YU7", "brand": "Xiaomi", "model": "YU7"},
    {"raw_brand": "山东小车", "raw_model": "卡王", "brand": "Shandong EV", "model": "KW"},
    {"raw_brand": "山东小车", "raw_model": "卡王KW", "brand": "Shandong EV", "model": "KW"},
    {"raw_brand": "山东小车", "raw_model": "KW", "brand": "Shandong EV", "model": "KW"},
    {"raw_brand": "山东小车", "raw_model": "小钢炮", "brand": "Shandong EV", "model": "XGP"},
    {"raw_brand": "山东小车", "raw_model": "小钢炮XGP", "brand": "Shandong EV", "model": "XGP"},
    {"raw_brand": "山东小车", "raw_model": "XGP", "brand": "Shandong EV", "model": "XGP"},
    {"raw_brand": "极氪", "raw_model": "001", "brand": "Zeekr", "model": "001"},
    {"raw_brand": "极氪", "raw_model": "9X", "brand": "Zeekr", "model": "9X"},
    {"raw_brand": "智己", "raw_model": "L6", "brand": "IM Motors", "model": "L6"},
    {"raw_brand": "智己", "raw_model": "LS6", "brand": "IM Motors", "model": "LS6"},
    {"raw_brand": "上汽", "raw_model": "智己", "brand": "IM Motors", "model": "LS6"},
    {"raw_brand": "捷途", "raw_model": "DASHING", "brand": "Jetour", "model": "Dashing"},
    {"raw_brand": "捷途", "raw_model": "大圣", "brand": "Jetour", "model": "Dashing"},
    {"raw_brand": "捷途", "raw_model": "G700", "brand": "Jetour", "model": "T2"},
    {"raw_brand": "捷途", "raw_model": "T1", "brand": "Jetour", "model": "T2"},
    {"raw_brand": "捷途", "raw_model": "T2", "brand": "Jetour", "model": "T2"},
    {"raw_brand": "捷途", "raw_model": "X50", "brand": "Jetour", "model": "X50"},
    {"raw_brand": "捷途", "raw_model": "X70FL", "brand": "Jetour", "model": "X70"},
    {"raw_brand": "捷途", "raw_model": "X70PLUS", "brand": "Jetour", "model": "X70 Plus"},
    {"raw_brand": "丰田", "raw_model": "铂智3X", "brand": "Toyota", "model": "bZ3X"},
    {"raw_brand": "丰田", "raw_model": "铂智3x", "brand": "Toyota", "model": "bZ3X"},
    {"raw_brand": "奔腾小马", "raw_model": "小马", "brand": "Bestune", "model": "Xiaoma"},
    {"raw_brand": "奔腾", "raw_model": "小马", "brand": "Bestune", "model": "Xiaoma"},
    {"raw_brand": "吉利", "raw_model": "A7", "brand": "Geely", "model": "Galaxy A7"},
    {"raw_brand": "A7", "raw_model": "150", "brand": "Geely", "model": "Galaxy A7"},
    {"raw_brand": "A7", "raw_model": "探索", "brand": "Geely", "model": "Galaxy A7"},
    {"raw_brand": "吉利", "raw_model": "牛仔", "brand": "Geely", "model": "Cowboy"},
    {"raw_brand": "星耀6", "raw_model": "125KM", "brand": "Geely", "model": "Galaxy L6"},
    {"raw_brand": "福瑞通", "raw_model": "V6E", "brand": "Dongfeng", "model": "Rich 6 EV"},
    {"raw_brand": "福瑞通", "raw_model": "V8E", "brand": "Dongfeng", "model": "Rich 6 EV"},
    {"raw_brand": "福田", "raw_model": "奥铃", "brand": "Farizon", "model": "Xingxiang V"},
    {"raw_brand": "广汽", "raw_model": "i60", "brand": "GAC Aion", "model": "i60"},
    {"raw_brand": "阿维塔", "raw_model": "07", "brand": "Avatr", "model": "07"},
    {"raw_brand": "阿维塔", "raw_model": "11", "brand": "Avatr", "model": "11"},
    {"raw_brand": "阿维塔", "raw_model": "12", "brand": "Avatr", "model": "12"},
    {"raw_brand": "小米", "raw_model": "小米su7", "brand": "Xiaomi", "model": "SU7"},
    {"raw_brand": "零跑", "raw_model": "小马", "brand": "Leapmotor", "model": "T03"},
    {"raw_brand": "零跑", "raw_model": "小马奔腾", "brand": "Leapmotor", "model": "T03"},
]


def get_brand_model_mapping() -> dict[tuple[str, str], tuple[str, str]]:
    """Returns (raw_brand.lower(), raw_model.lower()) -> (official_brand, official_model) dictionary.
    Dynamically loads from config/brand_model_mapping.json if present, falling back to BRAND_MODEL_MAPPINGS.
    """
    import json
    from pathlib import Path

    mapping: dict[tuple[str, str], tuple[str, str]] = {}

    # 1. Base built-in fallback mappings
    for item in BRAND_MODEL_MAPPINGS:
        mapping[(item["raw_brand"].lower(), item["raw_model"].lower())] = (item["brand"], item["model"])

    # 2. Dynamic config override (supports team / Codex additions)
    config_file = Path(__file__).resolve().parents[2] / "config" / "brand_model_mapping.json"
    if config_file.exists():
        try:
            data = json.loads(config_file.read_text("utf-8"))
            for item in data.get("mappings", []):
                raw_b = str(item.get("raw_brand", "")).strip().lower()
                raw_m = str(item.get("raw_model", "")).strip().lower()
                b = str(item.get("brand", "")).strip()
                m = str(item.get("model", "")).strip()
                if raw_b and b and m:
                    mapping[(raw_b, raw_m)] = (b, m)
        except Exception:
            pass
    return mapping


# ==============================================================================
# Rule Engine & Knowledge Persistence (Schema Intelligence Platform)
# ==============================================================================
import copy
import json

CONFIG_DIR = Path(__file__).resolve().parent.parent.parent / "config"
KNOWLEDGE_BASE_PATH = CONFIG_DIR / "rules_knowledge_base.json"

DEFAULT_KNOWLEDGE_BASE = {
    "version": "1.0.0",
    "header_aliases": {
        "brand": ["品牌", "车辆品牌", "厂商", "brand"],
        "modelName": ["车型", "型号", "车系", "项目名称", "车辆名称", "子品牌", "车型描述"],
        "variant": ["配置", "版型", "版本"],
        "exteriorColor": ["外观颜色", "外观色", "车色", "颜色", "外观"],
        "interiorColor": ["内饰颜色", "内饰色", "内饰"],
        "priceExw": ["EXW", "EXW报价", "工厂交货价", "出厂价", "裸车价"],
        "priceFob": ["FOB", "FOB报价", "离岸价"],
        "priceFca": ["FCA", "FCA报价", "货运承运人价"],
        "priceCif": ["CIF", "到岸价"],
        "supplierPriceCny": ["采购价", "批价", "底价", "优惠价", "全款裸车价", "供货价", "单价"],
        "officialSuggestedPriceCny": ["指导价", "官方指导价", " MSRP", "厂方指导价"],
        "stockQuantity": ["现车数量", "台数", "数量", "库存", "数量（台）", "配额"],
        "location": ["提货地", "提货地点", "港口", "发货地", "仓库", "存放地", "交付地点", "交货地点", "FOB地点", "EXW地点", "FCA地点", "FOB港口", "FCA港口", "EXW港口", "exw地点", "fob地点", "fca地点"],
        "steering": ["舵向", "方向盘位置", "驱动方向"],
        "manufactureYear": ["manufacture_year", "manufactureyear", "生产年份", "年款"],
        "manufactureMonth": ["manufacture_month", "manufacturemonth", "生产月份"],
        "manufactureYearMonth": ["生产日期", "出厂日期"],
        "orderWaitDays": ["等待天数", "货期", "交货期", "等待时间", "等待周数"],
        "vinStatus": ["车架号状态", "VIN码状态", "随车手续"],
        "notes": ["备注", "说明", "促销送充电桩", "条款"]
    },
    "trade_location_cleaners": [
        "^FCA\\s*", "^EXW\\s*", "^FOB\\s*", "^CIF\\s*"
    ],
    "location_canonical_map": {
        "广州南沙": "南沙",
        "南沙": "南沙",
        "霍尔果斯": "霍尔果斯",
        "喀什": "喀什",
        "上海": "上海",
        "涓婃捣": "上海",
        "天津": "天津",
        "广州": "广州",
        "深圳": "深圳",
        "宁波": "宁波",
        "青岛": "青岛",
        "厦门": "厦门",
        "盐城": "盐城",
        "咸阳": "咸阳",
        "芜湖": "芜湖",
        "武汉": "武汉",
        "成都": "成都",
        "重庆": "重庆",
        "西安": "西安",
        "太原": "太原",
        "郑州": "郑州",
        "合肥": "合肥",
        "南京": "南京",
        "杭州": "杭州",
        "福州": "福州",
        "大连": "大连",
        "连云港": "连云港",
        "钦州": "钦州",
        "防城港": "防城港",
        "凭祥": "凭祥",
        "满洲里": "满洲里",
        "二连浩特": "二连浩特",
        "瑞丽": "瑞丽",
        "黑河": "黑河",
        "绥芬河": "绥芬河"
    },
    "invalid_location_words": [
        "小马奔腾", "奔腾小马", "奔腾", "小马", "T03", "BYD", "长安", "阿维塔", "智己", "丰田", "东风",
        "五菱", "吉利", "Smart", "广汽", "上汽", "埃安", "启源", "深蓝", "问界", "捷途", "红旗", "零跑",
        "理想", "小鹏", "小米", "极氪", "福田", "远程", "奇瑞", "长城", "坦克", "岚图"
    ],
    "chinese_to_english_brands": {
        "比亚迪": "BYD",
        "吉利": "Geely",
        "全新牛仔": "Geely",
        "吉利牛仔": "Geely",
        "长安": "Changan",
        "五菱": "Wuling",
        "东风": "Dongfeng",
        "丰田": "Toyota",
        "捷途": "Jetour",
        "方程豹": "Fangchengbao",
        "深蓝": "Deepal",
        "启源": "Changan",
        "长安启源": "Changan",
        "阿维塔": "Avatr",
        "红旗": "Hongqi",
        "零跑": "Leapmotor",
        "理想": "Li Auto",
        "小鹏": "XPENG",
        "小米": "Xiaomi",
        "智己": "IM Motors",
        "极氪": "Zeekr",
        "福田": "Foton",
        "远程": "Farizon",
        "奇瑞": "Chery",
        "长城": "GWM",
        "坦克": "Tank",
        "岚图": "Voyah",
        "问界": "AITO",
        "享界": "Stelato",
        "尊界": "Maextro",
        "尚界": "Shangjie",
        "山东小车": "Shandong EV",
        "奔腾": "Bestune",
        "广汽": "GAC",
        "广汽埃安": "GAC",
        "埃安": "GAC",
        "Smart": "Smart",
        "smart": "Smart"
    },
    "wuling_model_code_mappings": {
        "G31A": "Rongguang",
        "LZW6394": "Wuling Sunshine",
        "LZW6400": "Wuling Rongguang",
        "LZW6430": "Wuling Hongguang",
        "LZW7000": "Wuling Hongguang MINI EV",
        "LZW7001": "Wuling Bingo",
        "LZW7002": "Wuling Starlight"
    },
    "user_learned_rules": [],
    "telemetry": {
        "total_runs": 0,
        "deterministic_hits": 0,
        "ai_fallbacks": 0
    }
}


class RuleEngine:
    """
    Continuous Learning Rule Engine.
    Loads, applies, and distills deterministic normalization rules.
    """

    def __init__(self, kb_path: Path | str | None = None):
        self.kb_path = Path(kb_path) if kb_path else KNOWLEDGE_BASE_PATH
        self.kb_data: dict[str, Any] = {}
        self.load_rules()

    def load_rules(self) -> None:
        """Load knowledge base rules from JSON or initialize default."""
        if self.kb_path.exists():
            try:
                self.kb_data = json.loads(self.kb_path.read_text(encoding="utf-8"))
            except Exception as e:
                logger.warning(f"Failed to read knowledge base at {self.kb_path}: {e}. Initializing default.")
                self.kb_data = copy.deepcopy(DEFAULT_KNOWLEDGE_BASE)
                self.save_rules()
        else:
            self.kb_data = copy.deepcopy(DEFAULT_KNOWLEDGE_BASE)
            self.save_rules()

    def save_rules(self) -> None:
        """Persist knowledge base rules to JSON file."""
        self.kb_path.parent.mkdir(parents=True, exist_ok=True)
        self.kb_path.write_text(json.dumps(self.kb_data, ensure_ascii=False, indent=2), encoding="utf-8")

    def normalize_header_cell(self, cell_value: Any) -> str | None:
        """Map raw header cell string to standardized SSOT schema field name."""
        if cell_value is None:
            return None
        cleaned = str(cell_value).strip().lower()
        if not cleaned:
            return None

        # Ignore generic column numbers / indexes and summary headers
        if cleaned in ("行号", "源文件", "转换方式", "序号", "id", "index", "no", "no.") or any(kw in cleaned for kw in ("小计", "合计", "总计", "小结", "subtotal", "total")):
            return None

        # Direct SSOT field name match (case-insensitive)
        for field_name in self.kb_data.get("header_aliases", {}):
            if cleaned == field_name.lower():
                return field_name

        # Check explicit user-learned header rules first
        for rule in self.kb_data.get("user_learned_rules", []):
            if rule.get("type") == "header_alias" and rule.get("pattern") in cleaned:
                return rule.get("target_field")

        # Check standard header aliases
        header_aliases = self.kb_data.get("header_aliases", {})
        for field_name, aliases in header_aliases.items():
            for alias in aliases:
                if alias.lower() in cleaned:
                    return field_name

        # SSOT fallback from VEHICLE_FIELDS definitions
        ssot_aliases = get_header_aliases()
        for alias, pydantic_name in ssot_aliases.items():
            if alias.lower() in cleaned:
                return pydantic_name

        return None

    def distill_rule_from_edit(self, field_name: str, raw_value: Any, new_value: Any, context: str | None = None) -> dict[str, Any] | None:
        """
        Distill a deterministic rule when a user manually edits a candidate via CLI 'edit'.
        Persists rule into user_learned_rules and auto-saves to knowledge base.
        """
        if not field_name or new_value is None:
            return None

        rule_entry = {
            "type": "field_override",
            "field": field_name,
            "raw_pattern": str(raw_value).strip() if raw_value else "",
            "target_value": new_value,
            "context": context or "cli_edit",
        }

        learned = self.kb_data.setdefault("user_learned_rules", [])
        for r in learned:
            if r.get("type") == "field_override" and r.get("field") == field_name and r.get("raw_pattern") == rule_entry["raw_pattern"]:
                r["target_value"] = new_value
                self.save_rules()
                return r

        learned.append(rule_entry)
        self.save_rules()
        logger.info(f"Distilled and persisted rule: {field_name} ('{raw_value}' -> '{new_value}')")
        return rule_entry

    def record_run_telemetry(self, deterministic_count: int, ai_count: int) -> dict[str, Any]:
        """Record telemetry for deterministic vs AI fallback execution."""
        telem = self.kb_data.setdefault("telemetry", {"total_runs": 0, "deterministic_hits": 0, "ai_fallbacks": 0})
        telem["total_runs"] += 1
        telem["deterministic_hits"] += deterministic_count
        telem["ai_fallbacks"] += ai_count
        self.save_rules()
        return telem

    def get_telemetry_summary(self) -> str:
        """Generate human-readable Telemetry Dashboard report."""
        telem = self.kb_data.get("telemetry", {"total_runs": 0, "deterministic_hits": 0, "ai_fallbacks": 0})
        det = telem.get("deterministic_hits", 0)
        ai = telem.get("ai_fallbacks", 0)
        total = det + ai
        det_pct = (det / total * 100.0) if total > 0 else 100.0
        ai_pct = (ai / total * 100.0) if total > 0 else 0.0
        rule_count = len(self.kb_data.get("user_learned_rules", []))

        return f"""
==================================================
📊 Schema Intelligence Telemetry Report
--------------------------------------------------
Total Candidates Processed: {total}
Deterministic Rule Fast-Path: {det} ({det_pct:.1f}%)
AI Fallback Invoked: {ai} ({ai_pct:.1f}%)
Active User-Learned Rules: {rule_count}
AI Dependency Ratio: {ai_pct:.1f}% (Target: <5.0%)
==================================================
"""

    def normalize_location(self, val: Any) -> str | None:
        """Normalize and canonicalize physical location using RuleEngine rules."""
        if not val:
            return None
        raw = str(val).strip()
        cleaned = re.sub(r"^(FCA|FOB|EXW|CIF)\s*", "", raw, flags=re.IGNORECASE).strip()
        if not cleaned:
            return None

        invalid_words = self.kb_data.get("invalid_location_words", [])
        if cleaned in invalid_words or any(w.lower() == cleaned.lower() for w in invalid_words):
            return None

        canonical_map = self.kb_data.get("location_canonical_map", {})
        # Sort keys by length descending so specific compounds like "广州南沙" match before "广州"
        sorted_keys = sorted(canonical_map.keys(), key=lambda k: len(k), reverse=True)
        for key_city in sorted_keys:
            if key_city in cleaned:
                return canonical_map[key_city]

        return cleaned or None

    def validate_trade_term_prices(
        self, exw_usd: float | int | None, fca_usd: float | int | None, fob_usd: float | int | None
    ) -> list[str]:
        """Validate foreign trade term USD price differentials against benchmark rules.
        
        Rules:
        - EXW -> FCA: Baseline +$500 USD, float ±$400 USD (Range: $100 ~ $900 USD)
        - FCA -> FOB: Baseline +$500 USD, float ±$400 USD (Range: $100 ~ $900 USD)
        - EXW -> FOB: Baseline +$1000 USD, float ±$400 USD (Range: $600 ~ $1400 USD)
        If difference is outside range or price is inverted (FOB <= FCA <= EXW), flag warning.
        """
        warnings: list[str] = []
        benchmarks = self.kb_data.get("trade_term_price_benchmarks", {})
        exw_to_fca_base = benchmarks.get("exw_to_fca_usd", 500)
        fca_to_fob_base = benchmarks.get("fca_to_fob_usd", 500)
        exw_to_fob_base = benchmarks.get("exw_to_fob_usd", 1000)
        tol = benchmarks.get("tolerance_usd", 400)

        # Convert to float safely
        exw = float(exw_usd) if exw_usd is not None else None
        fca = float(fca_usd) if fca_usd is not None else None
        fob = float(fob_usd) if fob_usd is not None else None

        # 1. EXW -> FCA
        if exw is not None and fca is not None:
            diff = fca - exw
            min_diff = exw_to_fca_base - tol
            max_diff = exw_to_fca_base + tol
            if diff < min_diff or diff > max_diff:
                warnings.append(
                    f"外贸价格异常(EXW->FCA差价${diff:.0f}, 需在${min_diff:.0f}~${max_diff:.0f}区间)"
                )

        # 2. FCA -> FOB
        if fca is not None and fob is not None:
            diff = fob - fca
            min_diff = fca_to_fob_base - tol
            max_diff = fca_to_fob_base + tol
            if diff < min_diff or diff > max_diff:
                warnings.append(
                    f"外贸价格异常(FCA->FOB差价${diff:.0f}, 需在${min_diff:.0f}~${max_diff:.0f}区间)"
                )

        # 3. EXW -> FOB
        if exw is not None and fob is not None:
            diff = fob - exw
            min_diff = exw_to_fob_base - tol
            max_diff = exw_to_fob_base + tol
            if diff < min_diff or diff > max_diff:
                warnings.append(
                    f"外贸价格异常(EXW->FOB差价${diff:.0f}, 需在${min_diff:.0f}~${max_diff:.0f}区间)"
                )

        return warnings


_rule_engine_instance: RuleEngine | None = None


def get_rule_engine() -> RuleEngine:
    global _rule_engine_instance
    if _rule_engine_instance is None:
        _rule_engine_instance = RuleEngine()
    return _rule_engine_instance

