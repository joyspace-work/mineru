# MinerU 车源导入与结构化解析流水线

将供应商发来的图片、PDF、PPT、DOCX、Excel、TXT 等车源资料，按 MinerU-first 路线识别、结构化提取，输出 JSON/CSV，暂存本地 SQLite，并可同步到飞书多维表格。

## 架构

```text
input/
  -> python -m mineru_pipeline classify
  -> input/classified/
  -> 识别层: MinerU Python SDK 生成 output/recognized/mineru/
  -> 转化层: LLM 对 MinerU Markdown/HTML table 做事实提取
  -> 汇总层: Python 规则规范化、JSON/CSV、SQLite 暂存、飞书同步
  -> output/final/candidates_YYYY-MM-DD.json
  -> output/final/candidates_YYYY-MM-DD.csv
  -> local_source.db
  -> 飞书多维表格
```

## 三层边界

| 层 | 职责 | 产物 |
|---|---|---|
| 识别 Recognition | 只负责文件读取、OCR/版面分析、表格结构还原。默认直接调用 MinerU Python SDK，不走 CLI 子进程。 | `output/recognized/mineru/manifest.json` 与 MinerU Markdown/JSON |
| 转化 Transformation | 只负责把 MinerU 的 Markdown/HTML table 按事实抽取为候选 JSON。长文档按 table/段落语义切片，不硬截断。 | LLM raw response 与 raw candidates |
| 汇总 Aggregation | 只负责业务规则规范化、车型 ID 匹配、本地 SQLite 暂存、人工审核、飞书同步。 | `output/final/candidates_*.json/csv`、`local_source.db`、飞书记录 |

业务映射不放在 LLM Prompt 里。LLM 只做事实提取，品牌/车型规范化和字段修正由汇总层 Python 规则处理。

## 安装

```powershell
python -m pip install -U pip
python -m pip install -e .[dev]
```

`pyproject.toml` 已固定当前查询到的最新关键依赖版本，包括：

```text
mineru==3.4.4
paddleocr==3.7.0
openpyxl==3.1.5
python-dotenv==1.2.2
requests==2.34.2
python-docx==1.2.0
python-pptx==1.0.2
accelerate==1.14.0
pytest==9.1.1
```

## 配置

复制模板并填写 `.env`：

```powershell
Copy-Item .env.example .env
```

至少需要。当前默认优先走 OpenRouter/NVIDIA；Gemini 保留为可切换备选：

```text
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=你的 OpenRouter Key
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_SOURCE_IMPORT_MODEL=nvidia/nemotron-3-ultra-550b-a55b:free

GEMINI_API_KEY=你的 Gemini Key
GEMINI_SOURCE_IMPORT_MODEL=gemini-3.5-flash
GEMINI_EMPTY_RETRIES=2
GEMINI_RAW_OUTPUT_DIR=

FEISHU_APP_ID=你的飞书 app id
FEISHU_APP_SECRET=你的飞书 app secret
FEISHU_BITABLE_APP_TOKEN=Is6Xb3btbazhFhsDXgFcqFG1nRc
FEISHU_BITABLE_TABLE_ID=tblAfMQdjhSV4Wd4
```

MinerU 可调参数：

```text
MINERU_METHOD=auto
MINERU_BACKEND=pipeline
MINERU_EFFORT=medium
MINERU_LANG=ch
MINERU_TABLE=true
MINERU_FORMULA=true
MINERU_IMAGE_ANALYSIS=false
MINERU_CLI_FALLBACK=false
MINERU_TIMEOUT_SECONDS=300
```

默认使用 `pipeline` 后端以减少启动和推理时间；遇到复杂图片表格或版面理解不足时，再临时设置 `MINERU_BACKEND=hybrid-engine` 重跑单文件。识别层默认通过 MinerU Python SDK 调用；只有显式设置 `MINERU_CLI_FALLBACK=true` 时才允许 SDK 失败后回退到 CLI。

Gemini 每次结构化响应会保存到 `output/final/gemini_raw/`；如果模型返回空 candidates，会按 `GEMINI_EMPTY_RETRIES` 自动重试。

LLM 抽取层只负责从 MinerU Markdown/HTML table 中做事实提取，不在 Prompt 中硬编码品牌/车型业务映射。品牌别名、车型库匹配、日期/币种等规范化由 Python 后处理完成。

长文档不会再直接 `text[:18000]` 硬截断；进入 LLM 前会按 MinerU `<table>...</table>`、Markdown 段落等语义块切片，避免在表格中间截断。

## 常用命令

第一轮建议只跑 dry-run，不写本地库、不上传飞书：

```powershell
python -m mineru_pipeline --dry-run --force-ocr
```

正式完整流程：

```powershell
python -m mineru_pipeline --force-ocr
```

临时覆盖 MinerU 后端，不需要修改 `.env`：

```powershell
python -m mineru_pipeline --dry-run --force-ocr --backend hybrid-engine --effort medium --method ocr
```

跳过已完成的 OCR：

```powershell
python -m mineru_pipeline --skip-ocr
```

只查看本地待同步记录：

```powershell
python -m mineru_pipeline --action list
```

编辑或删除本地暂存记录：

```powershell
python -m mineru_pipeline --action edit --id 3 --key cost_exw_cny --val 70700
python -m mineru_pipeline --action delete --id 3
```

手动同步本地 pending 记录到飞书：

```powershell
python -m mineru_pipeline --action sync
```

清空本地暂存：

```powershell
python -m mineru_pipeline --action clean
```

## 输入覆盖

| 类别 | 扩展名 | 处理路径 |
|---|---|---|
| 图片 | `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.bmp`, `.tiff`, `.svg` | MinerU 专业识别，失败后可显式启用视觉兜底 |
| PDF | `.pdf` | MinerU 专业识别 |
| PPT | `.pptx`, `.ppt` | MinerU / 文本提取 |
| Documents | `.docx`, `.doc`, `.rtf` | 文本提取或 MinerU |
| Excel | `.xlsx`, `.xls`, `.csv` | Python `openpyxl` / CSV 直接解析 |
| TXT | `.txt`, `.md` | 直接读取文本后进入结构化抽取 |

未知类型会进入 `input/classified/other/`，不会被删除。

## 输出位置

```text
output/recognized/mineru/manifest.json
output/recognized/mineru/errors.json
output/final/candidates_YYYY-MM-DD.json
output/final/candidates_YYYY-MM-DD.csv
local_source.db
```

## 测试

```powershell
python -m pytest
python -m py_compile scripts\ocr_process.py scripts\parse_document.py
```
