const { test, expect } = require('bun:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  formatCandidatesForFeishu,
  getDb,
  recordToFeishuFields,
} = require('../scripts/run_pipeline.js');
const { normalizeHeaderCell } = require('../scripts/parse_excel.js');

test('formatCandidatesForFeishu normalizes manufacturing date aliases', () => {
  const [fromCamel, fromProduction, fromLegacyTime] = formatCandidatesForFeishu([
    { brand: 'BYD', modelName: 'Dolphin', manufactureDate: '2026-07-03' },
    { brand: 'BYD', modelName: 'Dolphin', production_date: '2026/07/04' },
    { brand: 'BYD', modelName: 'Dolphin', time: '2026.07.05' },
  ]);

  expect(fromCamel.manufacture_date).toBe('2026-07-03');
  expect(fromProduction.manufacture_date).toBe('2026-07-04');
  expect(fromLegacyTime.manufacture_date).toBe('2026-07-05');
});

test('recordToFeishuFields includes manufacture_date for Feishu sync', () => {
  const fields = recordToFeishuFields({
    brand: 'BYD',
    model: 'Dolphin',
    manufacture_date: '2026-07-03',
  });

  expect(fields.manufacture_date).toBe('2026-07-03');
  expect(fields.time).toBeUndefined();
});

test('Excel headers map table date names to manufactureDate', () => {
  expect(normalizeHeaderCell('manufacture_date')).toBe('manufactureDate');
  expect(normalizeHeaderCell('time')).toBe('manufactureDate');
  expect(normalizeHeaderCell('生产日期')).toBe('manufactureDate');
});

test('local staging database has manufacture_date column', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mineru-date-'));
  const dbPath = path.join(tmpDir, 'local_source.db');
  const db = getDb(dbPath);
  const columns = db.prepare('PRAGMA table_info(source_candidates)').all().map(c => c.name);
  db.close();

  expect(columns).toContain('manufacture_date');
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {}
});
