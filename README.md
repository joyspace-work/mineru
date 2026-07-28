# Codex 车源 Excel 汇总与飞书写入工具

当前项目不再调用 DeepSeek、Gemini、OpenRouter 或任何外部大模型 API。项目的核心执行者是 Codex：由 Codex 读取大批量不同规格、不同表头的 Excel/CSV 车源表，抽取候选 JSON，再由本项目做严格字段校验、本地暂存和飞书写入。

目标飞书表：

```text
Base Token: Is6Xb3btbazhFhsDXgFcqFG1nRc
Table ID: tblyd52cT70XrFf1
View ID: vewReBQXrZ
```

接手项目请先读：[车源 Excel 导入项目交接文档](docs/USER_HANDOFF.md)。

最近一次完整测试写入的测试表：

```text
Base Token: Is6Xb3btbazhFhsDXgFcqFG1nRc
Table ID: tblt1FgQacffCYbK
View ID: vewReBQXrZ
```

测试结果：`C:\Users\HP\Downloads\车源汇总26.7.28\车源汇总26.7.28` -> 285 条候选 -> 飞书读回 285 条。

## 快速上手

```powershell
$env:PYTHONIOENCODING = "utf-8"
$root = "C:\Users\HP\Downloads\车源汇总26.7.28\车源汇总26.7.28"
$tag = "26728_20260729"

python scripts\manual_excel_summary.py `
  --root $root `
  --out output\final\manual_feishu_ready_$tag.json `
  --summary output\final\manual_feishu_ready_$tag`_summary.json

python scripts\prepare_current_feishu_candidates.py `
  --root $root `
  --input output\final\manual_feishu_ready_$tag.json `
  --source-summary output\final\manual_feishu_ready_$tag`_summary.json `
  --output output\final\current_feishu_candidates_$tag.json `
  --quality-prefix output\final\current_feishu_candidates_$tag

python scripts\audit_candidate_semantics.py output\final\current_feishu_candidates_$tag.json

python -m mineru_pipeline `
  --action aggregate `
  --raw-candidates output\final\current_feishu_candidates_$tag.json `
  --dry-run
```

写入飞书前先 dry-run：

```powershell
python scripts\replace_feishu_table_from_candidates.py `
  --input output\final\current_feishu_candidates_$tag.json `
  --base-token Is6Xb3btbazhFhsDXgFcqFG1nRc `
  --table-id tblt1FgQacffCYbK `
  --backup output\final\tblt1FgQacffCYbK_backup_before_$tag.json `
  --prepared output\final\tblt1FgQacffCYbK_prepared_$tag.json
```

确认 dry-run 无字段错误后替换写入：

```powershell
python scripts\replace_feishu_table_from_candidates.py `
  --input output\final\current_feishu_candidates_$tag.json `
  --base-token Is6Xb3btbazhFhsDXgFcqFG1nRc `
  --table-id tblt1FgQacffCYbK `
  --backup output\final\tblt1FgQacffCYbK_backup_before_$tag.json `
  --prepared output\final\tblt1FgQacffCYbK_prepared_$tag.json `
  --allow-new-select-options `
  --replace
```

## 流程

```text
Excel/CSV 输入
  -> evidence: Excel 文本化证据包
  -> Codex: 根据证据人工级抽取 candidate JSON
  -> validate: 字段类型、选项、证据、价格币种/贸易术语校验
  -> confidence: 按源证据完整度和字段风险评分
  -> final: JSON/CSV
  -> local_source.db
  -> 飞书多维表格 tblyd52cT70XrFf1
```

## 原则

- 只处理 Excel/CSV，不处理图片、PDF、OCR 或 UI。
- 不使用外部 LLM API；`.env` 不需要任何模型 API Key。
- 只有源表证据明确支持某个字段时才写入该字段。
- 供应商、基地、出货地点/港口可能出现在 Excel 单元格、合并单元格、表头上方标题/说明行、备注列、价格列名、Sheet 名称、文件名或文件夹路径中。
- 字段来源优先级以表内联想为主：行级单元格/合并单元格优先，其次标题/说明行、表头/价格列名、备注列、Sheet 名称；文件夹路径和文件名只在表内没有明确字段时作为补充证据。
- 文件路径和文件名也是有效证据源；供应商、基地、地点、品牌、车型等信息如果编码在目录名或文件名中，必须读取并在 `_evidence` 中引用对应 `# Path` 或 `# Path parts`。
- 不能因为内容“格式像数字/地点/价格”就写入字段。
- `brand` 和 `model` 对应飞书单选字段，必须使用稳定、规范的选项名；不要把供应商、地点、版本、价格、公告代码写进这两个字段。
- `model` 只能写车型主名称，例如 `Galaxy M9`、`海狮05EV`、`海狮06Dmi`、`驱逐舰`、`海狮07`；不能把地点、颜色库存、版本、价格或多个车型列表塞进 `model`。
- `variant` 写配置/版本/款型，例如 `210km AWD Black Gold Smart Shine Edition`；旧字段名 `trim_config` 只作为历史输入兼容别名，新输出统一写 `variant`。
- `vehicle_supply_base` 只写供应基地，例如 `霍尔果斯基地`；`location` 只写出货地点/港口，例如 `南沙`、`宁波`、`上海`、`深圳`。两者不能跨字段联想或互相复制。
- 地点必须按 Excel 行或合并单元格覆盖范围写入；霍尔果斯行不能写成南沙，南沙行也不能写成霍尔果斯。
- 颜色库存组合必须拆成独立记录：`3暖阳白/黑` 表示 `stock_quantity=3`、`exterior_color=暖阳白`、`interior_color=黑`。
- 温州迈卡类表格中的 `霍尔果斯-海狮05EV-13海域白/灰` 必须拆为 `location=霍尔果斯`、`model=海狮05EV`、`stock_quantity=13`、`exterior_color=海域白`、`interior_color=灰`。
- 价格必须严格区分贸易术语和币种，例如 `cost_fca_usd` 必须有 FCA + USD 证据。
- 价格列名中如果出现 `FCA南沙`、`FOB深圳`、`EXW上海`，贸易术语用于判断价格字段，去掉 `FCA/FOB/EXW` 前缀后的地点写入 `location`。
- 同一源行同时存在 EXW 和 FOB 时，`cost_fob_usd` 不得低于 `cost_exw_usd`；出现反常关系应判为无效候选而不是直接写入。
- `display_price_low` 和 `display_price_high` 是网站前台展示价，和车源数据源没有直接逻辑关系；车源导入系统必须保留这两个字段但不得从源 Excel 抓取或写入。
- 源表中的建议零售价、人民币报价、非明确 FOB/FCA/EXW/CIF USD 外贸价格，都应写入 `supplier_price_cny`；不得写入 `display_price_low/high`。
- `confidence` 是工程置信度，不是模型概率。它反映字段是否被源 Excel 行、表头、路径、币种、贸易术语和拆分规则直接支撑。
- 用户字段和不支持字段不作为普通记录写入。

## 导入规则成长机制

项目的可成长部分不再依赖某个供应商或某个品牌的专项补丁，而是把源文本先判断成字段语义角色，再决定能否写入目标字段。

当前内置语义角色包括：

```text
model_family       车型主名称
sales_variant      销售版本/配置名
body_structure     轴距/顶高/客货结构等车身结构
power_battery      电池、电量、续航等动力电池信息
price              价格或疑似价格数字
location           出货地点/港口
stock_color        库存数量+颜色组合
spec_blob          长配置清单/配置说明
announcement_code  公告代码/底盘代码
duplicate_model    variant 中重复出现 model 或其别名
```

导入规则的执行顺序：

```text
Excel/path/header 原始证据
  -> 字段候选抽取
  -> model_family 归一化
  -> variant 语义清洗
  -> candidate 语义审计
  -> 类型/证据/币种/地点范围校验
  -> 飞书写入
```

核心约束：

- `model` 只保留车型主名称，不写品牌重复、价格、地点、颜色库存、版本名、公告代码或配置清单。
- `variant` 只保留销售版本/配置名；如果只剩车型重复、车身结构、价格、电池、地点、颜色库存、公告代码或长配置清单，则留空。
- `body_structure` 不是天然的 `variant`。例如 `中轴低顶` 这类只有结构没有销售版本词时留空；`中轴高顶-行动派`、`短轴低顶-行镖版` 这类带明确版本名时可保留。
- `vehicle_supply_base` 与 `location` 不跨字段推断。基地只写基地，出货地点/港口只写 `location`。
- 后续新错误应优先沉淀为“语义角色/字段边界”规则；只有在车型库别名缺失时，才补充别名表。

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
      "variant": "520旗智航版-国际版国内车型",
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
        "variant": "row 2 B=海狮05EV 520旗智航版-国际版国内车型",
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

## 3. 批量 Excel 汇总脚本

如果输入是一个包含大量 Excel 的文件夹，可以先用本项目的本地解析脚本生成 Codex 候选底稿，再转换为目标飞书表候选。

```powershell
$root = "C:\Users\HP\Downloads\车源汇总纯净 (2)\车源汇总纯净"

# 读取文件夹下所有 xlsx，生成可追溯的中间候选。
python scripts\manual_excel_summary.py `
  --root $root `
  --out output\final\manual_feishu_ready_update.json `
  --summary output\final\manual_feishu_ready_update_summary.json

# 转换为当前目标表字段，并按证据规则计算 confidence。
python scripts\prepare_current_feishu_candidates.py `
  --root $root `
  --input output\final\manual_feishu_ready_update.json `
  --source-summary output\final\manual_feishu_ready_update_summary.json `
  --output output\final\current_feishu_candidates_update.json `
  --quality-prefix output\final\current_feishu_candidates_update

# 导入前审计 model/variant 是否有价格、地点、电池、公告代码、车型重复等字段错位。
python scripts\audit_candidate_semantics.py output\final\current_feishu_candidates_update.json

# 已有候选文件时，可单独重新生成导入质量报告。
python scripts\import_quality_report.py `
  --candidates output\final\current_feishu_candidates_update.json `
  --summary output\final\manual_feishu_ready_update_summary.json `
  --raw output\final\manual_feishu_ready_update.json `
  --output-prefix output\final\current_feishu_candidates_update
```

说明：

- `manual_excel_summary.py` 会读取源 Excel 的 sheet、row、文件路径，并保留 `source_file/source_sheet/source_row/content_hash`。
- `prepare_current_feishu_candidates.py` 会把中间候选转换为当前飞书表字段，切分 `model/variant`，拆分颜色库存，补 `_evidence`，并生成 `confidence`。该脚本兼容读取旧中间字段 `trim_config`，但最终输出 `variant`；不会从车源表填充 `display_price_low/high`。
- `notes` 只保留源 Excel 中真实的业务备注；`source_file/source_sheet/source_row`、价格来源等内部追踪信息保存在 `_evidence`，不得写入用户可见备注。
- 转换脚本会同时生成导入质量报告：`*_quality_report.json/.md`、`*_zero_row_sources.json`、`*_duplicate_candidates.json`、`*_variant_audit.json`。这些文件用于检查零产出源文件、重复业务键、字段覆盖、地点/基地缺失、颜色库存异常、variant 清洗原因和备注污染。
- `content_hash` 会写入 `record_id`，用于后续读回和批量更新。

## 4. 校验并生成最终文件

只校验和生成 JSON/CSV，不写 SQLite：

```powershell
python -m mineru_pipeline --action aggregate --raw-candidates output\final\current_feishu_candidates_20260727.json --dry-run
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

## 5. 写入本地暂存并同步飞书

校验通过后有两种写入方式。

方式 A：替换写入指定测试表或目标表，适合批量重跑全表。先 dry-run，再加 `--replace` 真写，命令见“快速上手”。

方式 B：写入 `local_source.db` 暂存，并在飞书配置完整时同步目标表：

```powershell
$env:FEISHU_BITABLE_APP_TOKEN="Is6Xb3btbazhFhsDXgFcqFG1nRc"
$env:FEISHU_BITABLE_TABLE_ID="tblyd52cT70XrFf1"
python -m mineru_pipeline --raw-candidates output\final\current_feishu_candidates_20260727.json
```

本地暂存记录管理：

```powershell
python -m mineru_pipeline --action list
python -m mineru_pipeline --action edit --id 3 --key cost_fca_usd --val 9250
python -m mineru_pipeline --action delete --id 3
python -m mineru_pipeline --action sync
python -m mineru_pipeline --action clean
```

## 6. 置信度规则

`confidence` 的定义：当前自动抽取结果被源 Excel 证据直接支撑、字段语义未错位的工程置信度，取值 `0-1`。

基础分为 `0.50`。加分项：

- `+0.10`：品牌来自单元格或路径，并能和车型语义匹配。
- `+0.15`：车型来自明确车型/车系列，且已从配置、价格、地点中正确切分。
- `+0.10`：至少有一个价格字段来自明确表头或源行。
- `+0.10`：价格币种和贸易术语明确，没有汇率换算。
- `+0.10`：供应商来自路径或表内明确字段。
- `+0.05`：地点/基地来自明确单元格、文件名或路径。
- `+0.05`：颜色/库存拆分来自明确格式。
- `+0.05`：生产年月、舵向、市场版本等辅助字段有直接证据。

扣分项：

- `-0.10`：供应商仅由路径推断，表内没有重复支持。
- `-0.10`：车型经过规则修正、切分或中英转译后才成立。
- `-0.15`：价格表头不完整，只能根据数值区间或上下文判断。
- `-0.15`：地点来自路径/文件名推断，而不是行级单元格。
- `-0.15`：颜色/库存从混合文本拆分，格式存在风险。
- `-0.20`：原行存在合并单元格、跨行继承、空白继承或 `row None`。
- `-0.30`：源证据存在地点冲突，例如同一证据同时出现霍尔果斯和南沙。
- `-0.30`：车型原始文本含公告代码、配置长文本或大数字，存在切分风险。

建议分级：

- `0.90-1.00`：高置信，可自动入库。
- `0.75-0.89`：可用，适合自动入库但建议抽样复核。
- `0.60-0.74`：需关注，表结构或字段推断较多。
- `<0.60`：不建议自动入库，应人工检查。

## 7. 更新已写入记录的 confidence

如果已经写入飞书，但需要根据新规则刷新 `confidence`，先读取当前候选中的 `record_id -> confidence`，生成按分值分组的批量更新 payload，再调用飞书批量更新。

当前项目使用 `record_id` 作为外部记录 ID，不是飞书 `_record_id`。更新时必须先从飞书读回 `_record_id`，再调用：

```powershell
lark-cli base +record-batch-update `
  --base-token Is6Xb3btbazhFhsDXgFcqFG1nRc `
  --table-id tblyd52cT70XrFf1 `
  --json "@output/final/confidence_updates_YYYYMMDD/confidence_0_85_1.json" `
  --as user
```

`lark-cli` 的 `@file` 参数必须使用当前工作目录下的相对路径，不能传绝对路径。

## 字段校验

项目内置目标表字段 schema。可写字段包括：

```text
model_id, confidence, brand, supplier, max_quantity, exterior_color, model,
variant, supplier_price_cny, cost_fca_usd, trim_config_id, cost_fob_usd,
notes, order_wait_days, manufacture_year, min_quantity, record_id,
interior_color, location, steering_setup, market_region, cost_exw_usd,
manufacture_month, display_price_low, stock_quantity, vehicle_supply_base,
display_price_high
```

其中 `display_price_low`、`display_price_high` 虽是目标表字段，但车源导入流程不得写入；它们由网站展示层或后续运营规则维护。

跳过字段：

```text
developer, reviewer, ai_importer, review_progress
```

## 测试

```powershell
python -m pytest
python -m compileall -q src tests_py
```
