const { test, expect } = require('bun:test');
const { formatCandidatesForFeishu } = require('../scripts/run_pipeline.js');

test('Sync validator rules', () => {
  const raw = [
    { brand: null, modelName: 'Dolphin', priceExw: 10000 }, // Missing brand
    { brand: 'BYD', modelName: null, priceExw: 10000 }, // Missing model
    { brand: 'BYD', modelName: 'Dolphin', priceExw: 70000, priceExwCurrency: 'CNY' }, // CNY into EXW
    { brand: 'BYD', modelName: 'Dolphin', priceExw: 12000, priceExwCurrency: 'USD' }, // Valid USD EXW
    { brand: 'BYD', modelName: 'Dolphin', priceExw: 35000 }, // Unspecified currency >= 30000 (CNY candidate)
    { brand: 'BYD', modelName: 'Dolphin', priceExw: 15000 }  // Unspecified currency < 30000 (USD candidate)
  ];

  const result = formatCandidatesForFeishu(raw);
  
  // Dolphin records with missing brand/model should be excluded or marked invalid
  const validRecords = result.filter(r => r.brand && r.model);
  expect(validRecords.length).toBe(4);

  // CNY priceExw should NOT go into cost_exw_usd
  const cnyExwRecord = validRecords.find(r => r.cost_exw_usd === 70000);
  expect(cnyExwRecord).toBeUndefined(); // Filtered/cleaned to null

  // Unspecified >= 30000 should NOT go into cost_exw_usd
  const unspecifiedCnyExwRecord = validRecords.find(r => r.cost_exw_usd === 35000);
  expect(unspecifiedCnyExwRecord).toBeUndefined();

  // Valid USD should go into cost_exw_usd
  const usdRecord = validRecords.find(r => r.cost_exw_usd === 12000);
  expect(usdRecord).toBeDefined();

  // Unspecified < 30000 should go into cost_exw_usd
  const unspecifiedUsdRecord = validRecords.find(r => r.cost_exw_usd === 15000);
  expect(unspecifiedUsdRecord).toBeDefined();
});
