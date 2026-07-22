const fs = require('fs');
const path = require('path');
const { test, expect } = require('bun:test');

test('Pipeline asks before using LLM vision fallback after MinerU failure', () => {
  const pipelinePath = path.join(__dirname, '../scripts/run_pipeline.js');
  const content = fs.readFileSync(pipelinePath, 'utf-8');

  expect(content).toContain("OUTPUT_DIR, 'recognized', 'mineru'");
  expect(content).toContain('--engine mineru');
  expect(content).toContain('promptForVisionFallback');
  expect(content).toContain('processVisionFallbackFile');
  expect(content).toContain('--vision-fallback');
  expect(content).not.toContain('正在启用 [Gemini 多模态直传 Vision 模式]');
});

test('MinerU processor writes manifest and errors under output/recognized/mineru', () => {
  const ocrPath = path.join(__dirname, '../scripts/ocr_process.py');
  const content = fs.readFileSync(ocrPath, 'utf-8');

  expect(content).toContain('"output" / "recognized" / "mineru"');
  expect(content).toContain('ERRORS_FILE');
  expect(content).toContain('--engine');
  expect(content).toContain('MinerU is not installed');
});

test('MinerU CLI options are configurable without code changes', () => {
  const ocrPath = path.join(__dirname, '../scripts/ocr_process.py');
  const content = fs.readFileSync(ocrPath, 'utf-8');

  expect(content).toContain('def build_mineru_command');
  expect(content).toContain('MINERU_METHOD');
  expect(content).toContain('MINERU_LANG');
  expect(content).toContain('MINERU_DEBUG');
  expect(content).toContain('MINERU_TIMEOUT_SECONDS');
  expect(content).toContain('--method');
  expect(content).toContain('--lang');
});

test('PaddleOCR engine is explicit and supports current PaddleOCR API', () => {
  const ocrPath = path.join(__dirname, '../scripts/ocr_process.py');
  const content = fs.readFileSync(ocrPath, 'utf-8');

  expect(content).toContain('create_paddleocr_reader');
  expect(content).toContain('parse_paddleocr_result');
  expect(content).toContain('ocr.predict');
  expect(content).toContain('engine == "paddleocr"');
  expect(content).not.toContain('use_angle_cls=True');
  expect(content).not.toContain('show_log=False');
  expect(content).not.toContain('cls=True');
});

test('Gemini vision fallback is explicit and separate from text extraction', () => {
  const extractorPath = path.join(__dirname, '../scripts/gemini_extract.js');
  const content = fs.readFileSync(extractorPath, 'utf-8');

  expect(content).toContain('requestJson');
  expect(content).toContain('safeErrorMessage');
  expect(content).not.toContain('await fetch(url');
  expect(content).toContain('核心文本请求方法');
  expect(content).toContain('用户确认后的视觉兜底请求方法');
  expect(content).toContain('processVisionFallbackFile');
  expect(content).not.toContain('processMultimodalFile');
});

test('Text extraction prompt accounts for MinerU table cell drift', () => {
  const { buildPrompt } = require('../scripts/gemini_extract.js');
  const prompt = buildPrompt('5/6/7/9座宁德50.2kwh', '新商筹');

  expect(prompt).toContain('MinerU table cell drift');
  expect(prompt).toContain('seat count');
  expect(prompt).toContain('battery');
});

test('Text extraction prompt strengthens Farizon V-series and EXW field mapping', () => {
  const { buildPrompt } = require('../scripts/gemini_extract.js');
  const prompt = buildPrompt('远程 V系列价格表 V6E盲窗货版 EXW工厂 70700 V7E V8E工厂在上饶 V6E工厂在南充', '新商筹');

  expect(prompt).toContain('远程 V6E / V7E / V8E');
  expect(prompt).toContain('Farizon');
  expect(prompt).toContain('EXW工厂');
  expect(prompt).toContain('priceExw');
  expect(prompt).toContain('priceExwCurrency');
  expect(prompt).toContain('CNY');
  expect(prompt).toContain('Do not infer Dongfeng');
});

test('Gemini text extraction defaults to the current stable Flash text model', () => {
  const { getApiConfig } = require('../scripts/gemini_extract.js');
  const previousProvider = process.env.AI_PROVIDER;
  const previousModel = process.env.GEMINI_SOURCE_IMPORT_MODEL;

  try {
    process.env.AI_PROVIDER = 'gemini';
    process.env.GEMINI_SOURCE_IMPORT_MODEL = '';

    expect(getApiConfig().model).toBe('gemini-3.5-flash');
  } finally {
    if (previousProvider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = previousProvider;
    if (previousModel === undefined) delete process.env.GEMINI_SOURCE_IMPORT_MODEL;
    else process.env.GEMINI_SOURCE_IMPORT_MODEL = previousModel;
  }
});
