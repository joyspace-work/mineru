# Excel 车源导入与结构化解析流水线

当前项目只处理供应商 Excel/CSV 车源表，不再包含 MinerU OCR 识别层，也不再提供 GUI。

## 架构

```text
Excel/CSV 输入
  -> Excel 文本化: 保留 Source、Sheet、row 行号、A/B/C 列坐标、merged 合并单元格
  -> 转化层: LLM 按事实抽取 raw candidates JSON
  -> 汇总层: Python 字段规范化、车型 ID 匹配、JSON/CSV、SQLite 暂存、飞书同步
  -> output/final/candidates_YYYY-MM-DD.json
  -> output/final/candidates_YYYY-MM-DD.csv
  -> local_source.db
  -> 飞书多维表格
```

LLM 只负责事实提取，不做车型库匹配、品牌别名修正、汇率换算或外部资料补全。业务规范化由 Python 汇总层完成。

## 安装

```powershell
python -m pip install -U pip
python -m pip install -e .[dev]
```

关键依赖：

```text
openpyxl==3.1.5
python-dotenv==1.2.2
requests==2.34.2
pytest==9.1.1
```

## 配置

复制模板并填写 `.env`：

```powershell
Copy-Item .env.example .env
```

默认使用 DeepSeek 官方 API；Gemini 和 OpenRouter 仍可作为备选：

```text
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=你的 DeepSeek Key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_SOURCE_IMPORT_MODEL=deepseek-v4-pro
LLM_EMPTY_RETRIES=2
LLM_CHUNK_CHARS=18000

FEISHU_APP_ID=你的飞书 app id
FEISHU_APP_SECRET=你的飞书 app secret
FEISHU_BITABLE_APP_TOKEN=Is6Xb3btbazhFhsDXgFcqFG1nRc
FEISHU_BITABLE_TABLE_ID=tblAfMQdjhSV4Wd4
```

## 常用命令

默认读取 `input/` 下所有 `.xlsx/.xlsm/.csv`：

```powershell
python -m mineru_pipeline --dry-run
```

指定一个 Excel 文件或文件夹：

```powershell
python -m mineru_pipeline --input "C:\path\to\车源表.xlsx" --dry-run
python -m mineru_pipeline --input "C:\path\to\车源文件夹" --dry-run
```

正式完整流程会写入 `local_source.db`，并在飞书配置完整时同步飞书：

```powershell
python -m mineru_pipeline --input "C:\path\to\车源文件夹"
```

单独执行转化层，生成 `output/final/raw_candidates_*.json`：

```powershell
python -m mineru_pipeline --action extract --input "C:\path\to\车源表.xlsx"
```

单独执行汇总层，从已有 raw candidates 继续生成最终 JSON/CSV：

```powershell
python -m mineru_pipeline --action aggregate --raw-candidates output\final\raw_candidates_20260727_120000.json --dry-run
```

本地暂存记录管理：

```powershell
python -m mineru_pipeline --action list
python -m mineru_pipeline --action edit --id 3 --key cost_exw_cny --val 70700
python -m mineru_pipeline --action delete --id 3
python -m mineru_pipeline --action sync
python -m mineru_pipeline --action clean
```

## Excel 文本化策略

转化层不会把 Excel 简单拼成普通文本，而是保留可被 LLM 理解的表格证据：

```text
# Source: supplier.xlsx
## Sheet: 报价表
merged: A2:A10=霍尔果斯基地
row 1: A=地点 | B=车型 | C=指导价 | D=颜色库存 | E=FCA提货价 usd
row 2: B=车型A | C=¥79,800 | D=20白/灰+10灰/灰 | E=9250
```

这样 DeepSeek 能看到 sheet、行号、列坐标和合并单元格覆盖关系，减少地点、价格、颜色库存错位。

## 输出位置

```text
output/parsed/excels/manifest.json
output/final/llm_raw/*.json
output/final/raw_candidates_*.json
output/final/candidates_YYYY-MM-DD.json
output/final/candidates_YYYY-MM-DD.csv
local_source.db
```

## 测试

```powershell
python -m pytest
python -m compileall -q src tests_py
```
