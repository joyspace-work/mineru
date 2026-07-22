const fs = require('fs');
const path = require('path');
const { test, expect } = require('bun:test');

test('Classifier accepts required source document categories', () => {
  const classifier = fs.readFileSync(path.join(__dirname, '../scripts/classify_inputs.js'), 'utf-8');

  for (const ext of ['.pptx', '.ppt', '.xlsx', '.xls', '.csv', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tiff', '.svg', '.pdf', '.docx', '.doc', '.rtf', '.txt', '.md']) {
    expect(classifier).toContain(`'${ext}'`);
  }
});

test('MinerU processor attempts every classified non-tabular document bucket', () => {
  const ocr = fs.readFileSync(path.join(__dirname, '../scripts/ocr_process.py'), 'utf-8');

  expect(ocr).toContain('"images"');
  expect(ocr).toContain('"pdfs"');
  expect(ocr).toContain('"presentations"');
  expect(ocr).toContain('"documents"');
  for (const ext of ['".gif"', '".svg"', '".rtf"']) {
    expect(ocr).toContain(ext);
  }
});

test('Pipeline handles Excel and text sources outside OCR', () => {
  const pipeline = fs.readFileSync(path.join(__dirname, '../scripts/run_pipeline.js'), 'utf-8');

  expect(pipeline).toContain('runExcelParsing');
  expect(pipeline).toContain("input/classified/excels");
  expect(pipeline).toContain('processTextFile');
  expect(pipeline).toContain("CLASSIFIED_DIR, 'texts'");
});
