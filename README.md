# Codex 车源 Excel 汇总与飞书写入工具

当前项目不再调用 DeepSeek、Gemini、OpenRouter 或任何外部大模型 API。项目的核心执行者是 Codex：由 Codex 读取大批量不同规格、不同表头的 Excel/CSV 车源表，抽取候选 JSON，再由本项目做严格字段校验、本地暂存和飞书写入。

目标飞书表：

```text
Base Token: Is6Xb3btbazhFhsDXgFcqFG1nRc
Table ID: tblyd52cT70XrFf1
View ID: vewReBQXrZ
```

## 流程

```text
Excel/CSV 输入
  -> evidence: Excel 文本化证据包
  -> Codex: 根据证据人工级抽取 candidate JSON
  -> validate: 字段类型、选项、证据、价格币种/贸易术语校验
  -> final: JSON/CSV
  -> local_source.db
  -> 飞书多维表格 tblyd52cT70XrFf1
```

## 原则

- 只处理 Excel/CSV，不处理图片、PDF、OCR 或 UI。
- 不使用外部 LLM API；`.env` 不需要任何模型 API Key。
- 只有源表证据明确支持某个字段时才写入该字段。
- 文件路径和文件名也是有效证据源；供应商、基地、地点、品牌、车型等信息如果编码在目录名或文件名中，必须读取并在 `_evidence` 中引用对应 `# Path` 或 `# Path parts`。
- 不能因为内容“格式像数字/地点/价格”就写入字段。
- `model` 只能写车型主名称，例如 `海狮05EV`、`海狮06Dmi`、`驱逐舰`、`海狮07`；不能把地点、颜色库存、配置、价格或多个车型列表塞进 `model`。
- 地点必须按 Excel 行或合并单元格覆盖范围写入；霍尔果斯行不能写成南沙，南沙行也不能写成霍尔果斯。
- 颜色库存组合必须拆成独立记录：`3暖阳白/黑` 表示 `stock_quantity=3`、`exterior_color=暖阳白`、`interior_color=黑`。
- 温州迈卡类表格中的 `霍尔果斯-海狮05EV-13海域白/灰` 必须拆为 `location=霍尔果斯`、`model=海狮05EV`、`stock_quantity=13`、`exterior_color=海域白`、`interior_color=灰`。
- 价格必须严格区分贸易术语和币种，例如 `cost_fca_usd` 必须有 FCA + USD 证据。
- 用户字段和不支持字段不作为普通记录写入。

## 安装

```powershell
python -m pip install -U pip
python -m pip install -e .[dev]
```

## 配置

复制模板并填写飞书应用凭证：

```powershell
Copy-Item .env.example .env
```

```text
PIPELINE_INPUT_DIR=input
FEISHU_APP_ID=你的飞书 app id
FEISHU_APP_SECRET=你的飞书 app secret
FEISHU_BITABLE_APP_TOKEN=Is6Xb3btbazhFhsDXgFcqFG1nRc
FEISHU_BITABLE_TABLE_ID=tblyd52cT70XrFf1
FEISHU_BITABLE_VIEW_ID=vewReBQXrZ
```

## 1. 生成 Codex 证据包

默认读取 `input/`：

```powershell
python -m mineru_pipeline --action extract
```

指定一个 Excel 文件或文件夹：

```powershell
python -m mineru_pipeline --action extract --input "C:\path\to\车源表.xlsx"
python -m mineru_pipeline --action extract --input "C:\path\to\车源文件夹"
```

输出目录示例：

```text
output/evidence/codex_evidence_YYYYMMDD_HHMMSS/
  manifest.json
  candidate_template.json
  supplier_报价表.txt
```

证据文本会保留：

```text
# Source: supplier.xlsx
# Path: 温州迈卡新能源\霍尔果斯基地\supplier.xlsx
# Path parts: 1=温州迈卡新能源 | 2=霍尔果斯基地 | 3=supplier.xlsx
## Sheet: 报价表
merged: A2:A10=霍尔果斯基地
row 1: A=地点 | B=车型 | C=指导价 | D=颜色库存 | E=FCA提货价 usd
row 2: B=车型A | C=¥79,800 | D=20白/灰+10灰/灰 | E=9250
```

## 2. Codex 产出候选 JSON

候选文件必须是 JSON list，或包含 `records` 数组的对象。每个非空字段必须在 `_evidence` 中提供对应证据。

```json
{
  "records": [
    {
      "brand": "BYD",
      "model": "Sealion 7",
      "trim_config": "520旗智航版-国际版国内车型",
      "exterior_color": "暖阳白",
      "interior_color": "黑",
      "stock_quantity": 3,
      "cost_fca_usd": 9250,
      "location": "霍尔果斯基地",
      "market_region": ["国际版"],
      "confidence": 0.9,
      "notes": "7月交付",
      "_source_file": "supplier.xlsx",
      "_evidence": {
        "brand": "source filename or row evidence",
        "model": "row 2 B=海狮05EV 520旗智航版-国际版国内车型",
        "trim_config": "row 2 B=海狮05EV 520旗智航版-国际版国内车型",
        "exterior_color": "row 2 D=3暖阳白/黑",
        "interior_color": "row 2 D=3暖阳白/黑",
        "stock_quantity": "row 2 D=3暖阳白/黑",
        "cost_fca_usd": "row 1 E=FCA提货价 usd; row 2 E=9250",
        "location": "merged A2:A10=霍尔果斯基地",
        "market_region": "row 2 B=国际版国内车型",
        "confidence": "Codex confidence",
        "notes": "row 2 notes or delivery column"
      }
    }
  ]
}
```

## 3. 校验并生成最终文件

只校验和生成 JSON/CSV，不写 SQLite：

```powershell
python -m mineru_pipeline --action aggregate --raw-candidates output\candidates_by_codex.json --dry-run
```

校验通过后会输出：

```text
output/final/candidates_YYYY-MM-DD.json
output/final/candidates_YYYY-MM-DD.csv
```

校验失败会输出：

```text
output/final/invalid_candidates_YYYYMMDD_HHMMSS.json
```

## 4. 写入本地暂存并同步飞书

校验通过后写入 `local_source.db`，并在飞书配置完整时同步目标表：

```powershell
python -m mineru_pipeline --raw-candidates output\candidates_by_codex.json
```

本地暂存记录管理：

```powershell
python -m mineru_pipeline --action list
python -m mineru_pipeline --action edit --id 3 --key cost_fca_usd --val 9250
python -m mineru_pipeline --action delete --id 3
python -m mineru_pipeline --action sync
python -m mineru_pipeline --action clean
```

## 字段校验

项目内置目标表字段 schema。可写字段包括：

```text
model_id, confidence, brand, supplier, max_quantity, exterior_color, model,
trim_config, supplier_price_cny, cost_fca_usd, trim_config_id, cost_fob_usd,
notes, order_wait_days, manufacture_year, min_quantity, record_id,
interior_color, location, steering_setup, market_region, cost_exw_usd,
manufacture_month, display_price_low, stock_quantity, vehicle_supply_base,
display_price_high
```

跳过字段：

```text
developer, reviewer, ai_importer, review_progress
```

## 测试

```powershell
python -m pytest
python -m compileall -q src tests_py
```
