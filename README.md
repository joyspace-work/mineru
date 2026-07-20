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
   OCR → Markdown (output/ocr/)
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

# 5. 分类输入文件
node scripts/classify_inputs.js

# 6. 运行完整流水线
node scripts/run_pipeline.js

# 仅提取不上传飞书：
node scripts/run_pipeline.js --dry-run

# 跳过 OCR（已处理过）：
node scripts/run_pipeline.js --skip-ocr
```

## 脚本说明

| 脚本 | 作用 |
|------|------|
| `classify_inputs.js` | 清理+分类 input/ 中的文件到对应桶 |
| `ocr_process.py` | MinerU/PaddleOCR 批量 OCR（图片/PDF/PPT/DOCX → Markdown） |
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
核心逻辑已封装为独立 Node.js 模块，n8n 通过 Execute Command 节点调用。
