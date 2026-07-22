# MinerU — 车源导入与结构化解析全流水线

将供应商发来的各种格式（图片/PDF/PPT/DOCX/Excel/文本）车源资料，自动识别、结构化提取，暂存本地 SQLite 并可自动同步至飞书多维表格。

## 架构

```
input/classified/
  ├── images/          (png, jpg → MinerU/PaddleOCR)
  ├── pdfs/            (pdf → MinerU)
  ├── presentations/   (pptx → python-pptx → MinerU)
  ├── documents/       (docx → python-docx)
  ├── excels/          (xlsx → XLSX 库直接解析)
  ├── texts/           (txt → 直接读取)
  └── other/           (未知类型保留)
         │
         ▼
   MinerU 专业识别 → Markdown (output/recognized/mineru/)
         │
         ▼
   Gemini Flash 纯文本模式 → 结构化 JSON candidates
         │
         ▼
   自学习规则引擎 (data/rules.json) → 自动修正
         │
         ▼
   output/final/ → 飞书多维表格同步
```

## 快速开始

```bash
# 1. 安装依赖
bun install xlsx

# 2. 安装 OCR 引擎（二选一）
pip install magic-pdf[full]      # MinerU（推荐，内置 PaddleOCR）
# 或
pip install paddleocr paddlepaddle  # 纯 PaddleOCR

# 3. 可选：PPT/DOCX 支持
pip install python-pptx python-docx PyMuPDF

# 4. 配置
cp .env.example .env
# 编辑 .env 填入 GEMINI_API_KEY 和飞书配置

# 5. 运行完整流水线（会自动分类、识别、抽取、写入本地库并同步飞书）
bun scripts/run_pipeline.js

# 仅提取并生成 JSON/CSV，不写本地库、不上传飞书：
bun scripts/run_pipeline.js --dry-run

# 跳过 OCR（已处理过）：
bun scripts/run_pipeline.js --skip-ocr

# 跳过自动分类（确认 input/classified/ 已经准备好时使用）：
bun scripts/run_pipeline.js --skip-classify
```

## 脚本说明

| 脚本 | 作用 |
|------|------|
| `classify_inputs.js` | 清理+分类 input/ 中的文件到对应桶 |
| `ocr_process.py` | MinerU 批量专业识别（图片/PDF/PPT/DOCX → Markdown），不使用大模型 Vision 兜底 |
| `parse_excel.js` | Excel 解析 + 60 组中文表头别名映射 |
| `gemini_extract.js` | Gemini API 结构化提取（纯文本模式，不传图） |
| `learning_engine.js` | 自学习规则引擎（修正积累→自动规则） |
| `run_pipeline.js` | 端到端流水线编排器 |

## 自学习机制

系统会自动积累经验：

1. **AI 识别** → 输出候选数据
2. **人工审核修正** → `addCorrection()` 记录修正
3. **同一修正 ≥ 3 次** → 自动升级为正式规则
4. **下次识别** → `applyRules()` 自动修正，不再依赖 AI

```
data/
  ├── corrections.json   — 原始修正记录
  ├── rules.json         — 正式生效的规则
  └── rules_pending.json — 待确认的规则建议
```

## n8n 集成

n8n 工作流在 `n8n/workflows/ev_export_sync.json`，可导入 n8n 使用。
核心逻辑已封装为独立 Bun/Node.js 模块，n8n 通过 Execute Command 节点调用。

## MinerU 路线

本项目当前按 MinerU-first 路线处理非结构化文件：

- 图片/PDF/PPT/DOCX 先由 MinerU 识别为 Markdown，输出到 `output/recognized/mineru/`
- 识别 manifest 写到 `output/recognized/mineru/manifest.json`
- 识别失败清单写到 `output/recognized/mineru/errors.json`
- Gemini/OpenRouter 只读取 MinerU 产出的文本做结构化抽取
- MinerU 失败时会询问是否通过视觉大模型兜底识别图片/PDF；默认不启用

显式控制兜底行为：

```bash
# MinerU 失败时直接启用视觉大模型兜底
bun scripts/run_pipeline.js --vision-fallback

# MinerU 失败时直接跳过视觉大模型兜底
bun scripts/run_pipeline.js --no-vision-fallback
```

### 输入覆盖

当前输入包含但不限于以下类别：

| 类别 | 扩展名 | 处理路径 |
|---|---|---|
| PPT | `.pptx`, `.ppt` | MinerU / LibreOffice 转 PDF / python-pptx 文本提取 |
| Excel | `.xlsx`, `.xls`, `.csv` | `parse_excel.js` 结构化解析 |
| Images | `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.bmp`, `.tiff`, `.svg` | MinerU 专业识别；MinerU 失败时可确认启用视觉兜底 |
| PDF | `.pdf` | MinerU 专业识别；MinerU 失败时可确认启用视觉兜底 |
| Documents | `.docx`, `.doc`, `.rtf` | DOCX/RTF 文本提取或 MinerU |
| TXT | `.txt`, `.md` | 直接读取文本后进入结构化抽取 |

未知类型会进入 `input/classified/other/`，不会被删除。

## 第一轮图片测试

第一轮建议只测试“识别 + 结构化 + 本地暂存”，不要直接同步飞书。

```powershell
# 1. 复制环境变量模板
Copy-Item .env.example .env

# 2. 编辑 .env，至少填入一个 AI Key
# Gemini 路线：
$env:GEMINI_API_KEY = "你的 Gemini Key"
```

也可以直接把 key 写入 `.env`：

```text
AI_PROVIDER=gemini
GEMINI_API_KEY=你的 Gemini Key
GEMINI_SOURCE_IMPORT_MODEL=gemini-3.5-flash
MINERU_METHOD=auto
MINERU_LANG=ch
MINERU_TIMEOUT_SECONDS=300
```

MinerU 识别可通过 `.env` 微调：

```text
MINERU_METHOD=auto   # auto / ocr / txt，图片或扫描 PDF 可尝试 ocr
MINERU_LANG=ch       # 中文车源图建议 ch
MINERU_DEBUG=false
MINERU_START_PAGE=
MINERU_END_PAGE=
MINERU_TIMEOUT_SECONDS=300
```

然后把一张车源图片放到 `input/` 目录，例如：

```text
input/first-test.jpg
```

运行第一轮测试：

```powershell
bun scripts/run_pipeline.js --dry-run --force-ocr
```

这会自动完成：

```text
input/first-test.jpg
  -> input/classified/images/first-test.jpg
  -> output/recognized/mineru/manifest.json
  -> output/final/candidates_YYYY-MM-DD.json
  -> output/final/candidates_YYYY-MM-DD.csv
```

确认 JSON/CSV 没问题后，运行正式流程；正式流程会写入本地库并自动同步飞书：

```powershell
bun scripts/run_pipeline.js --force-ocr
```

如果飞书同步失败或未配置，记录会保留在本地 pending，可手动重试：

```powershell
bun scripts/run_pipeline.js --action list
bun scripts/run_pipeline.js --action sync
```
