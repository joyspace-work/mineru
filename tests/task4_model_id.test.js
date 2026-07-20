const { test, expect } = require('bun:test');
const path = require('path');
const fs = require('fs');
const { formatCandidatesForFeishu } = require('../scripts/run_pipeline.js');

test('Model ID mapping resolver from vehicle_models.json', () => {
  const modelDbPath = path.join(__dirname, '../feishu_tables/vehicle_models.json');
  expect(fs.existsSync(modelDbPath)).toBe(true);

  const data = JSON.parse(fs.readFileSync(modelDbPath, 'utf-8'));
  const records = data.records || [];

  // Create resolver map
  const map = new Map();
  for (const r of records) {
    if (!r.brand || !r.model || !r.model_id) continue;
    const key = `${r.brand.toLowerCase()}|${r.model.toLowerCase()}`;
    map.set(key, r.model_id);
  }

  // Test a known record like BYD Dolphin
  const dolphinId = map.get('byd|dolphin');
  expect(dolphinId).toBeDefined();
  expect(dolphinId.startsWith('MDL-')).toBe(true);
});

test('formatCandidatesForFeishu resolves model_id property', () => {
  const rawCandidates = [
    { brand: 'BYD', modelName: 'Dolphin' },
    { brand: '比亚迪', modelName: '海鸥' }
  ];

  const formatted = formatCandidatesForFeishu(rawCandidates);
  expect(formatted.length).toBe(2);

  const dolphinRecord = formatted.find(r => r.model === 'Dolphin');
  expect(dolphinRecord).toBeDefined();
  expect(dolphinRecord.model_id).toBeDefined();
  expect(dolphinRecord.model_id.startsWith('MDL-')).toBe(true);

  const seagullRecord = formatted.find(r => r.model === 'Seagull');
  expect(seagullRecord).toBeDefined();
  expect(seagullRecord.model_id).toBeDefined();
  expect(seagullRecord.model_id.startsWith('MDL-')).toBe(true);
});
