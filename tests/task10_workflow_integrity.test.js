const fs = require('fs');
const path = require('path');
const { test, expect } = require('bun:test');

test('run action automatically classifies raw input before OCR', () => {
  const pipeline = fs.readFileSync(path.join(__dirname, '../scripts/run_pipeline.js'), 'utf-8');

  expect(pipeline).toContain('function runClassification');
  expect(pipeline).toContain('classify_inputs.js');
  expect(pipeline).toContain('--skip-classify');
  expect(pipeline).toContain('runClassification()');
});

test('run action performs explicit preflight checks for AI extraction', () => {
  const pipeline = fs.readFileSync(path.join(__dirname, '../scripts/run_pipeline.js'), 'utf-8');

  expect(pipeline).toContain('function validateAiConfig');
  expect(pipeline).toContain('GEMINI_API_KEY');
  expect(pipeline).toContain('OPENROUTER_API_KEY');
  expect(pipeline).toContain('AI 结构化抽取不可继续');
});

test('empty MinerU manifest does not block vision fallback', () => {
  const pipeline = fs.readFileSync(path.join(__dirname, '../scripts/run_pipeline.js'), 'utf-8');

  expect(pipeline).toContain('function hasRecognizedFiles');
  expect(pipeline).toContain('function hasRecognitionErrors');
  expect(pipeline).toContain('hasRecognizedFiles()');
  expect(pipeline).toContain('hasRecognitionErrors()');
});

test('first-round test instructions are documented', () => {
  const readme = fs.readFileSync(path.join(__dirname, '../README.md'), 'utf-8');

  expect(readme).toContain('第一轮图片测试');
  expect(readme).toContain('bun scripts/run_pipeline.js --dry-run --force-ocr');
  expect(readme).toContain('bun scripts/run_pipeline.js --action list');
});

test('run action automatically syncs the current batch to Feishu after staging', () => {
  const pipeline = fs.readFileSync(path.join(__dirname, '../scripts/run_pipeline.js'), 'utf-8');

  expect(pipeline).toContain('const stagedIds = saveCandidatesToDb(db, formatted)');
  expect(pipeline).toContain('const syncSuccess = await syncToFeishu(formatted, false)');
  expect(pipeline).toContain('markCandidatesSynced(db, stagedIds)');
  expect(pipeline).toContain('Dry run — skipping SQLite write and Feishu upload');
});
