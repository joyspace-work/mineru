from __future__ import annotations

import asyncio
import os
from pathlib import Path
import json
import logging
from typing import Any
from concurrent.futures import ThreadPoolExecutor

from .ocr_engine import process_file_with_sdk, calculate_confidence, OCRResult
from .llm_extractor import (
    call_ai,
    call_ai_with_pydantic_retry,
    post_process_candidate,
    validate_with_pydantic,
    HAS_PYDANTIC,
    ExtractionPayloadSchema,
    PROJECT_ROOT,
)

logger = logging.getLogger("mineru_pipeline.async")


class AsyncMinerUPipeline:
    """
    异步解耦流水线架构 (Async Producer-Consumer Pipeline)

    队列设计:
      ocr_queue -> [OCR Workers] -> llm_queue -> [LLM Workers] -> validation_queue -> [Validation Workers] -> db_queue
    """

    def __init__(self, concurrency: int = 4, output_dir: Path | None = None):
        self.concurrency = concurrency
        self.output_dir = output_dir or (PROJECT_ROOT / "output" / "recognized" / "mineru")
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.ocr_queue: asyncio.Queue[tuple[Path, str]] = asyncio.Queue()
        self.llm_queue: asyncio.Queue[tuple[str, str, float | None]] = asyncio.Queue()
        self.validation_queue: asyncio.Queue[tuple[dict[str, Any], float | None]] = asyncio.Queue()
        self.db_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()

        self.extracted_candidates: list[dict[str, Any]] = []
        self.executor = ThreadPoolExecutor(max_workers=concurrency)

    async def ocr_worker(self, worker_id: int):
        while True:
            item = await self.ocr_queue.get()
            if item is None:
                self.ocr_queue.task_done()
                break

            file_path, source_name = item
            logger.info(f"[OCR Worker {worker_id}] Processing file: {file_path.name}")
            try:
                loop = asyncio.get_running_loop()
                if file_path.suffix.lower() in (".pdf", ".png", ".jpg", ".jpeg", ".webp"):
                    ocr_res: OCRResult = await loop.run_in_executor(
                        self.executor, process_file_with_sdk, file_path, self.output_dir
                    )
                    content = ocr_res.markdown_content
                    confidence = ocr_res.avg_confidence
                else:
                    content = await loop.run_in_executor(
                        self.executor, file_path.read_text, "utf-8"
                    )
                    middle_file = file_path.with_name(f"{file_path.stem}_middle.json")
                    confidence = await loop.run_in_executor(
                        self.executor, calculate_confidence, middle_file
                    )

                if content and content.strip():
                    await self.llm_queue.put((content, source_name, confidence))
            except Exception as e:
                logger.error(f"[OCR Worker {worker_id}] Failed to process file {file_path}: {e}")
            finally:
                self.ocr_queue.task_done()

    async def llm_worker(self, worker_id: int):
        while True:
            item = await self.llm_queue.get()
            if item is None:
                self.llm_queue.task_done()
                break

            content, source_name, confidence = item
            logger.info(f"[LLM Worker {worker_id}] Calling AI extraction for source: {source_name}")
            try:
                loop = asyncio.get_running_loop()
                result = await loop.run_in_executor(
                    self.executor, call_ai_with_pydantic_retry, content, source_name
                )
                candidates = (result or {}).get("candidates", [])
                for cand in candidates:
                    processed = post_process_candidate(cand, source_name, "", confidence)
                    await self.validation_queue.put((processed, confidence))
            except Exception as e:
                logger.error(f"[LLM Worker {worker_id}] LLM extraction failed for {source_name}: {e}")
            finally:
                self.llm_queue.task_done()

    async def validation_worker(self, worker_id: int):
        while True:
            item = await self.validation_queue.get()
            if item is None:
                self.validation_queue.task_done()
                break

            candidate, confidence = item
            logger.info(
                f"[Validation Worker {worker_id}] Validating candidate: "
                f"{candidate.get('brand')} {candidate.get('modelName')}"
            )
            try:
                # Pydantic Schema Validation Check
                is_valid, err_msg = validate_with_pydantic({"candidates": [candidate]})
                if not is_valid:
                    candidate["_validation_warning"] = f"Pydantic schema warning: {err_msg}"
                    candidate["_needs_human_review"] = True

                # OCR Confidence Check
                threshold = float(os.getenv("MINERU_CONFIDENCE_THRESHOLD", "0.6"))
                if confidence is not None and confidence < threshold:
                    candidate["_needs_human_review"] = True
                    candidate["_review_reason"] = f"MinerU OCR 低置信度警告 (avg: {confidence:.2f} < threshold: {threshold})"

                await self.db_queue.put(candidate)
            except Exception as e:
                logger.error(f"[Validation Worker {worker_id}] Validation failed: {e}")
            finally:
                self.validation_queue.task_done()

    async def db_worker(self, worker_id: int):
        while True:
            candidate = await self.db_queue.get()
            if candidate is None:
                self.db_queue.task_done()
                break

            try:
                self.extracted_candidates.append(candidate)
            except Exception as e:
                logger.error(f"[DB Worker {worker_id}] DB processing failed: {e}")
            finally:
                self.db_queue.task_done()

    async def run(self, ocr_files: list[tuple[Path, str]]) -> list[dict[str, Any]]:
        # Enqueue all OCR input files
        for item in ocr_files:
            await self.ocr_queue.put(item)

        # Spawn workers
        ocr_tasks = [asyncio.create_task(self.ocr_worker(i)) for i in range(self.concurrency)]
        llm_tasks = [asyncio.create_task(self.llm_worker(i)) for i in range(self.concurrency)]
        val_tasks = [asyncio.create_task(self.validation_worker(i)) for i in range(self.concurrency)]
        db_tasks = [asyncio.create_task(self.db_worker(1))]

        # Wait for OCR Queue to drain
        await self.ocr_queue.join()
        for _ in range(self.concurrency):
            await self.ocr_queue.put(None)  # type: ignore
        await asyncio.gather(*ocr_tasks)

        # Wait for LLM Queue to drain
        await self.llm_queue.join()
        for _ in range(self.concurrency):
            await self.llm_queue.put(None)  # type: ignore
        await asyncio.gather(*llm_tasks)

        # Wait for Validation Queue to drain
        await self.validation_queue.join()
        for _ in range(self.concurrency):
            await self.validation_queue.put(None)  # type: ignore
        await asyncio.gather(*val_tasks)

        # Wait for DB Queue to drain
        await self.db_queue.join()
        await self.db_queue.put(None)  # type: ignore
        await asyncio.gather(*db_tasks)

        self.executor.shutdown(wait=False)
        return self.extracted_candidates


def run_async_pipeline(
    ocr_files: list[tuple[Path, str]], concurrency: int = 4, output_dir: Path | None = None
) -> list[dict[str, Any]]:
    """Synchronous wrapper for executing the AsyncMinerUPipeline."""
    pipeline = AsyncMinerUPipeline(concurrency=concurrency, output_dir=output_dir)
    return asyncio.run(pipeline.run(ocr_files))
