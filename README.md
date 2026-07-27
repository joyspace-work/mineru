# 新流程
                 用户上传文件

                       │

              文件类型识别 Router

                       │

        ┌──────────────┼──────────────┐
        │              │              │

      PDF等            excel等        markdown/Text等
        │              │              │

        │              │              │

    MinerU SDK      结构化精准提取    转化为结构化
        │              │              │

        └──────────────┼──────────────┘

                       │

              统一中间格式层

        Markdown + Table + Metadata

                       │

          文档结构分析 / Semantic Chunking

        （按表格、章节、段落切，不硬截断）

                       │

              LLM Structured Extraction

        JSON Schema / Function Calling

                       │

              Pydantic 数据校验

        ┌──────────────┴──────────────┐
        │                             │

      成功                          失败

        │                             │

        │                       自动修复/重试

        │

              Business Rule Engine

        （业务规则，不放 Prompt）

        ├─ 品牌标准化
        ├─ 车型映射
        ├─ 单位转换
        ├─ 字段补全
        └─ 去重合并


                       │

              Data Quality Check

        ├─ 必填字段检查
        ├─ 异常价格检查
        ├─ 重复车型检查
        └─ 人工审核（可选）


                       │

              最终业务数据库

              🚗 结构化车辆表





```mermaid
flowchart TD
    subgraph Ingestion["1. 文件摄取与分类 (Ingestion & Classification)"]
        A["📁 原始车源文件 input/"] --> B["python -m mineru_pipeline run"]
        B --> C["按类型自动分桶 input/classified/<br/>(pdfs / images / xlsxs / txts / docxs)"]
    end

    subgraph Mining["2. MinerU 专业版面识别与置信度检测 (MinerU Layout & OCR)"]
        C -->|"PDF / 图片 / DOCX"| D["MinerU Layout Analysis & OCR<br/>(Hybrid / High Precision Mode)"]
        D -->|"SHA-256 哈希校验"| E["生成 Markdown 文本与 middle.json"]
        E --> F{"MinerU 平均置信度<br/>Confidence < 0.6?"}
        F -->|"低置信度"| G["标记 _needs_human_review = True"]
        F -->|"高置信度"| H["传递 Markdown 文本"]
        G --> H
    end

    subgraph DirectExtract["特殊分流: 表格与纯文本"]
        C -->|"Excel / CSV"| X["openpyxl / csv 提取结构化数据"]
        C -->|"TXT / MD"| Y["直接读取纯文本"]
    end

    subgraph LLM_Pydantic["3. 原生结构化抽取与 Pydantic 校验闭环 (LLM & Validation)"]
        H --> I["LLM (Ollama / Gemini / OpenRouter)"]
        Y --> I
        I -->|"原生 response_schema 约束"| J["生成 Raw JSON Payload"]
        J --> K{"Pydantic 模型校验<br/>ExtractionPayloadSchema"}
        K -->|"校验失败 ValidationError"| L["捕获具体错误字段<br/>构造 Error Feedback Prompt"]
        L -->|"自我纠错重试 Loop (Max 3次)"| I
        K -->|"校验通过"| M["输出 Validated Candidates"]
    end

    subgraph Cleaning["4. 规则引擎与品牌/车型对齐 (Rule Engine)"]
        X --> N["确定性规则引擎"]
        M --> N
        N --> O["读取 schema.py (SSOT)<br/>自动标准化中英文品牌与车型"]
        O --> P["阶梯报价拆分与多配色方案拆分"]
    end

    subgraph Staging["5. SQLite 暂存与飞书同步 (Staging & Sync)"]
        P --> Q["保存至 local_source.db<br/>(status: pending)"]
        Q --> R{"人工核对与操作"}
        R -->|"python -m mineru_pipeline list"| S["查看待核对列表"]
        R -->|"python -m mineru_pipeline edit"| T["人工微调字段"]
        R -->|"python -m mineru_pipeline sync"| U["批量上传飞书 Bitable 表格<br/>(status -> synced)"]
        R -->|"导出最终文件"| V["输出 final/candidates_YYYY-MM-DD.json / .csv"]
    end

    style Ingestion fill:#f0f4f8,stroke:#1e88e5,stroke-width:1px
    style Mining fill:#e1f5fe,stroke:#0288d1,stroke-width:1px
    style LLM_Pydantic fill:#fff3e0,stroke:#f57c00,stroke-width:1px
    style Cleaning fill:#f3e5f5,stroke:#7b1fa2,stroke-width:1px
    style Staging fill:#e8f5e9,stroke:#388e3c,stroke-width:1px
```

## 核心演进亮点

1. **原生的结构化输出 (`response_schema`)**：
   透传 Pydantic 生成的 JSON Schema 给 Gemini API，在 Token 解码阶段直接锁定语法树，实现 100% 格式确定性。
2. **Pydantic 校验与智能重试闭环 (Self-Correction Loop)**：
   如果 LLM 输出的 JSON 未通过 Pydantic 类型或范围校验，系统会自动捕获 `ValidationError` 详细报错，反向注入下一次 Prompt 进行自我修复，而非直接写入数据库。
3. **MinerU OCR 置信度感知 (Confidence Thresholding)**：
   自动读取 MinerU 导出的 `middle.json`，若文字/表格平均置信度低于 0.6，自动标记 `_needs_human_review = True`，防止隐形脏数据污染。
4. **断点续跑与缓存复用 (SHA-256 Checkpoint)**：
   利用文件 SHA-256 哈希比对，已处理的文件自动跳过，支持海量文档大批次解析时的断点续跑。

## 安装与使用

```bash
pip install -e .
export MINERU_BACKEND=pipeline
python -m mineru_pipeline
```

