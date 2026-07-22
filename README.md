# MinerU 车源导入与结构化解析流水线

将供应商发来的图片、PDF、PPT、DOCX、Excel、TXT 等车源资料，按 MinerU-first 路线识别、结构化提取，输出 JSON/CSV，暂存本地 SQLite，并可同步到飞书多维表格。

## 架构

```text
input/
  -> python -m mineru_pipeline classify
  -> input/classified/
  -> MinerU 专业识别 output/recognized/mineru/
  -> Gemini Flash 文本结构化抽取
  -> output/final/candidates_YYYY-MM-DD.json
  -> output/final/candidates_YYYY-MM-DD.csv
  -> local_source.db
  -> 飞书多维表格
```

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

至少需要：

```text
AI_PROVIDER=gemini
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
MINERU_TIMEOUT_SECONDS=300
```

默认使用 `pipeline` 后端以减少启动和推理时间；遇到复杂图片表格或版面理解不足时，再临时设置 `MINERU_BACKEND=hybrid-engine` 重跑单文件。

Gemini 每次结构化响应会保存到 `output/final/gemini_raw/`；如果模型返回空 candidates，会按 `GEMINI_EMPTY_RETRIES` 自动重试。

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
