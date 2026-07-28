# 车源 Excel 导入项目交接文档

本文面向接手本项目的测试人员或运营同事。当前项目已经从 OCR/LLM 流程转为本地 Excel 解析流程：输入是一批不同供应商、不同表头结构的 Excel 文件，输出是可写入飞书多维表格的结构化车源记录。

## 当前定位

- 不再使用 MinerU 识别层。
- 不再使用 DeepSeek、Gemini、OpenRouter 或其他外部大模型 API。
- 核心任务是从 Excel/CSV 中抽取车源字段，并写入飞书 Base。
- 字段归一、车型/版本切分、地点/基地边界、价格字段归属全部由本项目 Python 规则处理。

## 关键原则

- 源 Excel、文件名、文件夹路径都是证据来源。
- 供应商、基地、出货地点、品牌、车型可能出现在行内容、合并单元格、表头、sheet 名、文件名或路径中。
- `brand` 和 `model` 是单选字段，必须写规范主名称。
- `variant` 只写销售版本/配置名，不写车型重复、价格、电池、地点、公告代码或长配置清单。
- `vehicle_supply_base` 只写基地，`location` 只写出货地点/港口，不跨字段复制。
- `display_price_low` 和 `display_price_high` 是网站前台展示价，车源导入系统不得写入。
- 源表中的人民币建议零售价、人民币报价、非明确 USD 外贸价写入 `supplier_price_cny`。
- `notes` 只写供应商原始业务备注；程序来源、sheet、row、价格证据保存在 `_evidence`。
- `选装-*` 文件或行是选配价格，不是独立车源，必须跳过。

## 常用文件

- `scripts/manual_excel_summary.py`：读取文件夹下 Excel，生成中间候选和每个源文件产出数量。
- `scripts/prepare_current_feishu_candidates.py`：把中间候选转换为目标飞书表字段，并生成质量报告。
- `scripts/audit_candidate_semantics.py`：检查 `model/variant` 是否混入价格、地点、电池、公告代码、车型重复等。
- `scripts/import_quality_report.py`：对已有候选重新生成质量报告。
- `scripts/replace_feishu_table_from_candidates.py`：读取目标表字段，备份现有记录，批量删除并写入新候选。
- `src/mineru_pipeline/field_semantics.py`：字段语义规则和车型/版本清洗规则。
- `src/mineru_pipeline/import_quality.py`：质量报告统计规则。

## 标准全流程

在 PowerShell 中运行，路径按实际输入目录修改：

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

只有语义审计无错误、`aggregate --dry-run` 通过后，才允许写入飞书。

## 写入飞书

写入前确认目标 URL 中的 Base Token 和 Table ID。示例：

```powershell
python scripts\replace_feishu_table_from_candidates.py `
  --input output\final\current_feishu_candidates_$tag.json `
  --base-token Is6Xb3btbazhFhsDXgFcqFG1nRc `
  --table-id tblt1FgQacffCYbK `
  --backup output\final\tblt1FgQacffCYbK_backup_before_$tag.json `
  --prepared output\final\tblt1FgQacffCYbK_prepared_$tag.json
```

这一步是 dry-run，会输出：

- 源候选数量。
- 已适配飞书字段后的记录数量。
- 目标表当前已有记录数量。
- 缺失字段或缺失单选项。

如果 dry-run 只提示缺少合法的新车型单选项，且确认这些车型确实应该进入本测试表，可以允许飞书创建新单选项并替换写入：

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

脚本会先备份目标表已有记录，再删除旧记录，按 200 条一批写入新记录，最后读回目标表数量。`created_records` 和 `readback_records` 必须等于 `prepared_records`。

## 质量报告怎么看

转换脚本会生成以下文件：

- `*_quality_report.json/.md`：总览报告。
- `*_zero_row_sources.json`：0 产出源文件列表。
- `*_duplicate_candidates.json`：重复业务键候选。
- `*_variant_audit.json`：版本字段清洗原因。

常见结果解释：

- `zero_sources` 高不一定是程序错误。当前输入集常见“每个配置单独拆成文件”，很多文件没有价格/库存行，会被记录为 0 产出。
- `notes_overload` 必须为 0。否则说明内部来源或价格证据漏进了用户可见备注。
- `duplicate_business_keys` 需要人工判断是重复报价还是同配置多来源。
- `color_stock_issues` 说明颜色和库存组合可能没有完整拆开。

## 最近一次完整测试

最近一次完整测试输入：

```text
C:\Users\HP\Downloads\车源汇总26.7.28\车源汇总26.7.28
```

目标表：

```text
Base Token: Is6Xb3btbazhFhsDXgFcqFG1nRc
Table ID: tblt1FgQacffCYbK
```

结果：

- 源文件：509 个。
- 中间候选：290 条。
- 最终候选：285 条。
- 跳过 `选装-*` 选配价格行：5 条。
- 飞书写入：285 条。
- 飞书读回：285 条。
- `python -m pytest`：63 passed。

## 敏感信息

不要提交 `.env`、飞书 app secret、用户 token 或任何模型 API key。README 和本文只保留 Base Token/Table ID 这类业务定位信息，不保留密钥。
