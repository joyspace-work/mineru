# n8n EV Export Sync Workflow

本目录包含标准 n8n 工作流配置，用于从 `input/classified/` 目录读取已分类的车源素材，通过 Gemini AI 识别提取信息，并上传至飞书多维表格。

## 工作流架构

```
Manual Trigger
    ├── Read Images → Gemini Vision → Unified Mapper → Feishu Auth → Upload to Bitable
    ├── Read Excels → Spreadsheet Parser ↗
    └── Read PDFs  → Gemini PDF Parser ↗
```

### 节点说明

| 节点 | 功能 |
|------|------|
| **Manual Trigger** | 手动触发工作流 |
| **Read Classified Images** | 读取 `input/classified/images/` 下所有图片 |
| **Read Classified Excels** | 读取 `input/classified/excels/` 下所有 Excel 表格 |
| **Read Classified PDFs** | 读取 `input/classified/pdfs/` 下所有 PDF 文件 |
| **Gemini Image Recognition** | 使用 gemini-3.5-flash 识别图片中的车型信息 |
| **Gemini PDF Recognition** | 使用 gemini-3.5-flash 解析 PDF 中的车型信息 |
| **Parse Spreadsheet** | 解析 Excel 表格数据 |
| **Unified Data Mapper** | 统一映射所有来源的数据为飞书 Bitable 字段格式 |
| **Get Feishu Token** | 获取飞书 tenant_access_token |
| **Upload to Feishu Bitable** | 创建 Bitable 记录 |

## 快速开始

### 1. 启动 n8n

```bash
bunx n8n start
```

或使用 Docker：

```bash
docker run -it --rm -p 5678:5678 n8nio/n8n
```

### 2. 导入工作流

1. 打开浏览器访问 `http://localhost:5678`
2. 新建工作流 → 右上角菜单 → **Import from File**
3. 选择 `workflows/ev_export_sync.json`

### 3. 配置凭据

- **Google Gemini**: 在 Gemini 节点中配置你的 Google AI API Key
- **飞书**: 已内置 app_id/app_secret（如需更换，修改 Get Feishu Token 节点）

### 4. 运行前准备

确保已运行输入文件分类脚本：

```bash
node scripts/classify_inputs.js
```

这会将 `input/` 下的原始素材清理并分类到：
- `input/classified/images/` — 图片（.png, .jpg, .jpeg）
- `input/classified/pdfs/` — PDF 文档
- `input/classified/excels/` — Excel 表格（.xlsx, .xls, .csv）
- `input/classified/texts/` — 文本备注

### 5. 执行工作流

在 n8n 界面点击 **Execute Workflow** 按钮即可。

## 飞书 Bitable 字段映射

| Bitable 字段 | 数据来源 |
|---|---|
| 品牌 | brand |
| 车型 | modelName |
| 配置/版本 | trimName |
| 外观颜色 | exteriorColor |
| 内饰颜色 | interiorColor |
| 库存数量 | stockQuantity |
| 出厂价(EXW) | priceExw |
| 货币 | priceExwCurrency |
| 供应商 | supplier |
| 备注 | notes |

## 关键原则

- **零格式转换**：原始数据什么样就保留什么样，不做翻译或结构修改
- **宁可多写不可少写**：AI 提取时优先保留更多细节
- **文件名保留来源**：分类后的文件名包含品牌/供应商路径（用 `__` 分隔）
