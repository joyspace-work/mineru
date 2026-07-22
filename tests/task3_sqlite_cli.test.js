const { test, expect } = require('bun:test');
const { Database } = require('bun:sqlite');
const fs = require('fs');

function removeIfPossible(filePath) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {
    if (err?.code !== 'EBUSY' && err?.code !== 'ENOENT') throw err;
  }
}

test('Local cache DB staging operations (create, insert, query, update, delete)', () => {
  const dbPath = `local_source_test_${process.pid}.db`;
  removeIfPossible(dbPath);
  const db = new Database(dbPath);

  // Table creation
  db.run(`
    CREATE TABLE IF NOT EXISTS source_candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      brand TEXT,
      model TEXT,
      trim_config TEXT,
      exterior_color TEXT,
      interior_color TEXT,
      stock_quantity INTEGER,
      cost_exw_usd REAL,
      status TEXT DEFAULT 'pending'
    )
  `);

  // Insert
  db.run("INSERT INTO source_candidates (brand, model, cost_exw_usd) VALUES ('BYD', 'Dolphin', 12000)");
  
  // Query
  let row = db.prepare("SELECT * FROM source_candidates WHERE brand = 'BYD'").get();
  expect(row.model).toBe('Dolphin');
  expect(row.status).toBe('pending');

  // Update
  db.prepare("UPDATE source_candidates SET status = ?, cost_exw_usd = ? WHERE id = ?").run('synced', 11500, row.id);
  row = db.prepare("SELECT * FROM source_candidates WHERE brand = 'BYD'").get();
  expect(row.status).toBe('synced');
  expect(row.cost_exw_usd).toBe(11500);

  // Delete
  db.prepare("DELETE FROM source_candidates WHERE id = ?").run(row.id);
  row = db.prepare("SELECT * FROM source_candidates WHERE brand = 'BYD'").get();
  expect(row).toBeNull();

  db.close();
  removeIfPossible(dbPath);
});
