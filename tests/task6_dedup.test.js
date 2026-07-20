const { test, expect } = require('bun:test');
const { Database } = require('bun:sqlite');
const crypto = require('crypto');
const fs = require('fs');

test('SHA-256 hash generation', () => {
  const text = 'test content';
  const hash = crypto.createHash('sha256').update(text).digest('hex');
  expect(hash.length).toBe(64);
  expect(hash).toBe('6ae8a75555209fd6c44157c0aed8016e763ff435a19cf186f76863140143ff72');
});

test('processed_files table and duplicate check', () => {
  const dbPath = 'processed_files_test.db';
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  const db = new Database(dbPath);

  // Create table
  db.run(`
    CREATE TABLE IF NOT EXISTS processed_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT,
      content_hash TEXT UNIQUE,
      processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Helper functions for hash check / insert
  const hasHash = (hash) => {
    const row = db.prepare("SELECT 1 FROM processed_files WHERE content_hash = ?").get(hash);
    return !!row;
  };

  const insertHash = (filename, hash) => {
    db.prepare("INSERT INTO processed_files (filename, content_hash) VALUES (?, ?)").run(filename, hash);
  };

  const hash1 = crypto.createHash('sha256').update('file1').digest('hex');
  const hash2 = crypto.createHash('sha256').update('file2').digest('hex');

  // Verify hash doesn't exist
  expect(hasHash(hash1)).toBe(false);

  // Insert success
  insertHash('file1.xlsx', hash1);
  expect(hasHash(hash1)).toBe(true);

  // Duplicate insert should throw/fail
  expect(() => {
    insertHash('file1_dup.xlsx', hash1);
  }).toThrow();

  // Try insert second hash
  expect(hasHash(hash2)).toBe(false);
  insertHash('file2.xlsx', hash2);
  expect(hasHash(hash2)).toBe(true);

  db.close();
  fs.unlinkSync(dbPath);
});
