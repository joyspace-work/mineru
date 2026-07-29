# MinerU 纯 Python SDK 生产级车源解析流水线设计文档 (Design Spec)

- **日期**: 2026-07-23
- **状态**: Approved (已批准)
- **目标**: 打造基于 MinerU 原生 Python SDK (UNIPipe)、Pydantic 自自我纠错闭环、异步 Queue 解耦的高可靠工业级车源解析流水线。

---

## 1. 架构概述与解耦设计

系统划分为 **5 大完全解耦、高内聚的独立模块**，模块间仅通过标准数据传输对象 (DTO / Pydantic Models) 通信。

```
┌───────────────────┐    OCRResult     ┌───────────────────┐  ExtractionPayload  ┌───────────────────┐
│   SDKOCREngine    │ ───────────────> │   LLMExtractor    │ ─────────────────> │    RuleEngine     │
│ (纯 MinerU SDK)   │  (Path, Md, Conf)│ (Pydantic 闭环)   │    (Candidates)    │ (主数据/规则映射) │
└───────────────────┘                  └───────────────────┘                     └─────────┬─────────┘
          ▲                                                                                │ Clean Candidates
          │                                                                                ▼
┌─────────┴─────────┐                                                            ┌───────────────────┐
│ AsyncPipelineMgr  │ <───────────────────────────────────────────────────────── │     StagingDB     │
│ (纯编排/队列调度)  │                    (SQLite 写库 & 飞书 Sync)               │  (SQLite & 飞书)  │
└───────────────────┘                                                            └───────────────────┘
```

---

## 2. 模块细化与接口定义

### 2.1 SDKOCREngine (`src/mineru_pipeline/sdk_engine.py`)
- **职责**: 封装 MinerU 官方 Python SDK (`magic_pdf.pipe.UNIPipe`)，在内存中完成 PDF/图片/文档版面分析与表格提取。**严禁调用 subprocess CLI 进程**。
- **中间产物**: 将 Markdown 写盘至 `output/recognized/mineru/{stem}.md`，关联图片写盘至 `output/recognized/mineru/images/`，写盘 `middle.json` 包含位置与置信度。
- **哈希缓存**: 比对文件 SHA-256。如已包含在 `output/recognized/.mineru_cache.json` 且哈希未变，直接读取磁盘 `.md` 文本跳过 SDK 推理。
- **数据结构**:
  ```python
  @dataclass
  class OCRResult:
      source_path: Path
      markdown_path: Path
      markdown_content: str
      avg_confidence: float | None
      is_cached: bool
  ```

### 2.2 LLMExtractor (`src/mineru_pipeline/gemini_extract.py`)
- **职责**: 负责将纯 Markdown 文本提取为 29 个标准车源字段 JSON。
- **Pydantic 校验模型**:
  ```python
  class VehicleCandidateSchema(BaseModel):
      brand: Optional[str] = Field(None, description="品牌名称，如 BYD, Zeekr")
      modelName: Optional[str] = Field(None, description="车型名称，如 Seagull, 001")
      trimName: Optional[str] = Field(None, description="配置版本/细分车型")
      year: Optional[int] = Field(None, description="生产年份 (4位数字)")
      manufactureDate: Optional[str] = Field(None, description="生产日期 YYYY-MM-DD")
      priceExw: Optional[float] = Field(None, description="EXW 出厂价")
      priceExwCurrency: Optional[str] = Field("CNY", description="货币: CNY 或 USD")
      priceFca: Optional[float] = Field(None, description="FCA 价格")
      priceFcaCurrency: Optional[str] = Field("CNY")
      priceFob: Optional[float] = Field(None, description="FOB 价格")
      priceFobCurrency: Optional[str] = Field("USD")
      officialPrice: Optional[float] = Field(None, description="官方指导价")
      location: Optional[str] = Field(None, description="提货地点/港口")
      stockQuantity: Optional[int] = Field(None, description="库存数量")
      notes: Optional[str] = Field(None, description="备注说明")

  class ExtractionPayloadSchema(BaseModel):
      rawText: Optional[str] = ""
      parserNotes: Optional[str] = ""
      candidates: List[VehicleCandidateSchema] = Field(default_factory=list)
  ```
- **原生 Structured Output & 重试闭环**:
  1. 调用 Gemini / OpenRouter API，透传 `generationConfig.responseSchema = ExtractionPayloadSchema.model_json_schema()`。
  2. 捕获 Pydantic `ValidationError`。若校验失败，将 `e.json()` 作为 Error Feedback 嵌入下一次 Prompt 重试（最多 3 次）。
  3. 若 3 次重试仍未通过，降级保留 Raw 输出，并标记 `_needs_human_review = True`。

### 2.3 RuleEngine (`src/mineru_pipeline/learning_engine.py`)
- **职责**: 对 Candidates 做确定性数据清洗与标准化。
- **核心动作**:
  1. 映射官方中英文品牌/车型对照字典 `BRAND_MODEL_MAP` (如 `远程 V6E` -> `Farizon V6E`)。
  2. 读取并应用 `data/rules.json` 中的历史人工纠错积累规则。

### 2.4 StagingDB (`src/mineru_pipeline/staging_db.py`)
- **职责**: 管理 `local_source.db` 的 SQLite 暂存与飞书 Bitable 同步。
- **自动迁移**: 保证数据库列补齐（支持 `trim_config`/`variant`，`status_vehicle`/`status`，`production_year` 等兼容）。
- **字段标记**: 记录 `_needs_human_review` 与 `_review_reason`（如 OCR 置信度低于 0.6 或 Pydantic 重试失败警告）。

### 2.5 AsyncPipelineManager (`src/mineru_pipeline/async_pipeline.py`)
- **职责**: 使用 `asyncio.Queue` 串联解耦上述 4 大组件。
- **队列分配**:
  - `ingest_queue` -> `sdk_ocr_queue` -> `llm_queue` -> `validation_queue` -> `db_queue`
- **并发控制**: 可配置 Worker 数量 (默认 concurrency=4)。

---

## 3. 异常处理与置信度门控

1. **OCR 置信度检测**:
   - `SDKOCREngine` 计算平均字符/行置信度。
   - 若 `avg_confidence < 0.6`，为候选对象打上标志：`candidate["_needs_human_review"] = True`，并在 `manifest.json` 中记录警报。
2. **Pydantic 校验重试**:
   - 最多 3 次 LLM 自自我纠错重试；失败降级写日志至 `output/final/gemini_raw/` 并标记审核。
3. **断点续跑**:
   - `output/recognized/.mineru_cache.json` 保证不重复调用 SDK 推理相同的无变化文件。

---

## 4. 目录规范与命令接口

```text
input/classified/
output/recognized/mineru/          (.md, _middle.json, images/)
output/final/candidates_YYYY-MM-DD.json
output/final/candidates_YYYY-MM-DD.csv
output/final/gemini_raw/
local_source.db
```

### 命令接口 (`python -m mineru_pipeline`)
- `python -m mineru_pipeline --dry-run`
- `python -m mineru_pipeline --force-ocr`
- `python -m mineru_pipeline --skip-ocr`
- `python -m mineru_pipeline --action list/edit/delete/sync/clean`
