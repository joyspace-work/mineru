const fs = require('fs');
const path = require('path');
const { test, expect } = require('bun:test');

test('No hardcoded absolute paths in scripts', () => {
  const scripts = ['run_pipeline.js', 'gemini_extract.js', 'parse_document.py'].map(f =>
    path.join(__dirname, '../scripts', f)
  );
  for (const file of scripts) {
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, 'utf-8');
    expect(content).not.toContain('/Users/');
  }
});
