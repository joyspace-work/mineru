/**
 * migrations.js — Versioned schema migration runner
 *
 * Each migration entry has:
 *   id    — unique integer, never reused, strictly increasing
 *   name  — human-readable description (for logging)
 *   up    — function(db) that applies the migration
 *
 * Migrations are applied exactly once per database.
 * Completed migrations are recorded in the `schema_versions` table.
 *
 * NAMING CONVENTIONS (for new developers):
 *   - vehicles table  : uses `cost_exw` / `cost_fca` / `cost_fob` — these are supplier acquisition costs
 *   - supplier_sources: uses `price_exw` / `price_fca` / `price_fob` — these are raw supplier quoted prices
 *   - candidates table: uses `price_exw` / `price_fca` / `price_fob` — parsed from import files, pre-approval
 *
 *   The difference between `cost_*` and `price_*` is intentional:
 *     cost_*  = the price we actually pay (used in margin calculations)
 *     price_* = the supplier's stated price (may still need negotiation or conversion)
 */

// ─── Migration definitions ────────────────────────────────────────────────────

const MIGRATIONS = [
  {
    id: 1,
    name: 'vehicles: add stock_quantity column',
    up(db) {
      const existing = db.prepare('PRAGMA table_info(vehicles)').all().map((c) => c.name)
      if (!existing.includes('stock_quantity')) {
        db.exec('ALTER TABLE vehicles ADD COLUMN stock_quantity INTEGER NOT NULL DEFAULT 1')
      }
    },
  },
  {
    id: 2,
    name: 'vehicles: add preorder, color, spec, listing columns',
    up(db) {
      const cols = [
        ['profile_id', 'INTEGER'],
        ['preorder_min_days', 'INTEGER NOT NULL DEFAULT 7'],
        ['preorder_max_days', 'INTEGER NOT NULL DEFAULT 14'],
        ['available_colors', "TEXT NOT NULL DEFAULT '[]'"],
        ['stock_colors', "TEXT NOT NULL DEFAULT '[]'"],
        ['battery_capacity', "TEXT NOT NULL DEFAULT ''"],
        ['range_km', 'INTEGER NOT NULL DEFAULT 0'],
        ['drivetrain', "TEXT NOT NULL DEFAULT ''"],
        ['energy_type', "TEXT NOT NULL DEFAULT '纯电'"],
        ['image_url', "TEXT NOT NULL DEFAULT ''"],
        ['public_notes', "TEXT NOT NULL DEFAULT ''"],
        ['price_updated_at', 'TEXT'],
        ['price_valid_until', 'TEXT'],
        ['is_listed', 'INTEGER NOT NULL DEFAULT 1'],
      ]
      const existing = db.prepare('PRAGMA table_info(vehicles)').all().map((c) => c.name)
      for (const [name, def] of cols) {
        if (!existing.includes(name)) {
          db.exec(`ALTER TABLE vehicles ADD COLUMN ${name} ${def}`)
        }
      }
    },
  },
  {
    id: 3,
    name: 'quote_requests: add assigned_to column',
    up(db) {
      const existing = db.prepare('PRAGMA table_info(quote_requests)').all().map((c) => c.name)
      if (!existing.includes('assigned_to')) {
        db.exec('ALTER TABLE quote_requests ADD COLUMN assigned_to TEXT')
      }
    },
  },
  {
    id: 4,
    name: 'notifications: add recipient_username column',
    up(db) {
      const existing = db.prepare('PRAGMA table_info(notifications)').all().map((c) => c.name)
      if (!existing.includes('recipient_username')) {
        db.exec('ALTER TABLE notifications ADD COLUMN recipient_username TEXT')
      }
    },
  },
  {
    id: 5,
    name: 'vehicles: add dual cost price columns (cost_exw, cost_fob, partner/customer price variants)',
    up(db) {
      // cost_exw / cost_fob = supplier acquisition cost on EXW / FOB basis (used in margin calc)
      // partner_price_exw/fob / customer_price_exw/fob = selling prices on each trade-term basis
      const cols = [
        ['cost_exw', 'REAL'],
        ['cost_exw_currency', "TEXT DEFAULT 'USD'"],
        ['cost_fob', 'REAL'],
        ['cost_fob_currency', "TEXT DEFAULT 'USD'"],
        ['partner_price_exw', 'REAL'],
        ['partner_price_fob', 'REAL'],
        ['customer_price_exw', 'REAL'],
        ['customer_price_fob', 'REAL'],
      ]
      const existing = db.prepare('PRAGMA table_info(vehicles)').all().map((c) => c.name)
      for (const [name, def] of cols) {
        if (!existing.includes(name)) {
          db.exec(`ALTER TABLE vehicles ADD COLUMN ${name} ${def}`)
        }
      }
    },
  },
  {
    id: 6,
    name: 'supplier_sources: add dual price columns (price_exw, price_fob)',
    up(db) {
      // price_exw / price_fob = supplier quoted price (pre-negotiation, may differ from vehicles.cost_*)
      const cols = [
        ['price_exw', 'REAL'],
        ['price_exw_currency', "TEXT DEFAULT 'USD'"],
        ['price_fob', 'REAL'],
        ['price_fob_currency', "TEXT DEFAULT 'USD'"],
      ]
      const existing = db.prepare('PRAGMA table_info(supplier_sources)').all().map((c) => c.name)
      for (const [name, def] of cols) {
        if (!existing.includes(name)) {
          db.exec(`ALTER TABLE supplier_sources ADD COLUMN ${name} ${def}`)
        }
      }
    },
  },
  {
    id: 7,
    name: 'supplier_sources: back-fill price_exw from legacy supplier_price',
    up(db) {
      // All existing supplier_sources records had a single supplier_price with no trade term recorded.
      // We default them to EXW basis (most common for Chinese EV exports at factory gate).
      db.prepare(`
        UPDATE supplier_sources
        SET price_exw = supplier_price,
            price_exw_currency = 'USD'
        WHERE price_exw IS NULL AND price_fob IS NULL AND supplier_price > 0
      `).run()
    },
  },
  {
    id: 8,
    name: 'vehicles: back-fill cost_exw from legacy cost column',
    up(db) {
      db.prepare(`
        UPDATE vehicles
        SET cost_exw = cost,
            cost_exw_currency = 'USD',
            partner_price_exw = partner_price,
            customer_price_exw = customer_price
        WHERE cost_exw IS NULL AND cost_fob IS NULL AND cost > 0
      `).run()
    },
  },
  {
    id: 9,
    name: 'vehicle_source_candidates: add dual price columns (price_exw, price_fob)',
    up(db) {
      // price_exw / price_fob on candidates = raw supplier quoted price from import file
      // Trade-term context: any non-FOB term (EXW, FCA, DAP, CIF, empty) is mapped to price_exw
      // as a conservative default. FOB-explicit records go to price_fob.
      const cols = [
        ['price_exw', 'REAL'],
        ['price_exw_currency', 'TEXT'],
        ['price_fob', 'REAL'],
        ['price_fob_currency', 'TEXT'],
      ]
      const existing = db
        .prepare('PRAGMA table_info(vehicle_source_candidates)')
        .all()
        .map((c) => c.name)
      for (const [name, def] of cols) {
        if (!existing.includes(name)) {
          db.exec(`ALTER TABLE vehicle_source_candidates ADD COLUMN ${name} ${def}`)
        }
      }
    },
  },
  {
    id: 10,
    name: 'vehicle_source_candidates: back-fill price_exw/fob from legacy supplier_price',
    up(db) {
      // FOB-explicit records → price_fob; everything else → price_exw
      // This covers trade_term values: EXW, FCA, DAP, CIF, '' (empty), NULL
      // Reasoning: if a supplier gives a price without specifying FOB, the price is
      // typically at or near factory-gate (EXW/FCA), so defaulting to price_exw is safe.
      db.prepare(`
        UPDATE vehicle_source_candidates
        SET price_exw = supplier_price,
            price_exw_currency = COALESCE(NULLIF(currency, ''), 'USD')
        WHERE price_exw IS NULL AND price_fob IS NULL
          AND supplier_price > 0
          AND trade_term != 'FOB'
      `).run()

      db.prepare(`
        UPDATE vehicle_source_candidates
        SET price_fob = supplier_price,
            price_fob_currency = COALESCE(NULLIF(currency, ''), 'USD')
        WHERE price_exw IS NULL AND price_fob IS NULL
          AND supplier_price > 0
          AND trade_term = 'FOB'
      `).run()
    },
  },
  {
    id: 11,
    name: 'system_settings: seed default exchange rate',
    up(db) {
      db.prepare(
        "INSERT OR IGNORE INTO system_settings (key, value) VALUES ('exchange_rate', '7.2')",
      ).run()
    },
  },
  {
    id: 12,
    name: 'add FCA price columns and candidate official price reference',
    up(db) {
      const vehicleCols = [
        ['cost_fca', 'REAL'],
        ['cost_fca_currency', "TEXT DEFAULT 'USD'"],
        ['partner_price_fca', 'REAL'],
        ['customer_price_fca', 'REAL'],
      ]
      const vehicleExisting = db.prepare('PRAGMA table_info(vehicles)').all().map((c) => c.name)
      for (const [name, def] of vehicleCols) {
        if (!vehicleExisting.includes(name)) {
          db.exec(`ALTER TABLE vehicles ADD COLUMN ${name} ${def}`)
        }
      }

      const sourceCols = [
        ['price_fca', 'REAL'],
        ['price_fca_currency', "TEXT DEFAULT 'USD'"],
      ]
      const sourceExisting = db.prepare('PRAGMA table_info(supplier_sources)').all().map((c) => c.name)
      for (const [name, def] of sourceCols) {
        if (!sourceExisting.includes(name)) {
          db.exec(`ALTER TABLE supplier_sources ADD COLUMN ${name} ${def}`)
        }
      }

      const candidateCols = [
        ['price_fca', 'REAL'],
        ['price_fca_currency', 'TEXT'],
        ['official_price', 'TEXT'],
      ]
      const candidateExisting = db.prepare('PRAGMA table_info(vehicle_source_candidates)').all().map((c) => c.name)
      for (const [name, def] of candidateCols) {
        if (!candidateExisting.includes(name)) {
          db.exec(`ALTER TABLE vehicle_source_candidates ADD COLUMN ${name} ${def}`)
        }
      }

      db.prepare(`
        UPDATE vehicle_source_candidates
        SET price_fca = price_exw,
            price_fca_currency = price_exw_currency,
            price_exw = NULL,
            price_exw_currency = NULL
        WHERE trade_term = 'FCA'
          AND price_fca IS NULL
          AND price_exw IS NOT NULL
      `).run()

      db.prepare(`
        UPDATE supplier_sources
        SET price_fca = price_exw,
            price_fca_currency = price_exw_currency,
            price_exw = NULL,
            price_exw_currency = NULL
        WHERE UPPER(COALESCE(notes, '')) LIKE '%FCA%'
          AND price_fca IS NULL
          AND price_exw IS NOT NULL
      `).run()
    },
  },
]

// ─── Migration runner ─────────────────────────────────────────────────────────

/**
 * Initialises the schema_versions table and runs any pending migrations.
 * Safe to call on every server startup — already-applied migrations are skipped.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 */
export function runMigrations(db) {
  // Create the versions tracking table if it doesn't exist yet
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_versions (
      id          INTEGER PRIMARY KEY,
      name        TEXT    NOT NULL,
      applied_at  TEXT    NOT NULL
    )
  `)

  const applied = new Set(
    db.prepare('SELECT id FROM schema_versions').all().map((r) => Number(r.id)),
  )

  let ran = 0
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue

    console.log(`[Migration] Applying #${migration.id}: ${migration.name}`)
    db.exec('BEGIN')
    try {
      migration.up(db)
      db.prepare('INSERT INTO schema_versions (id, name, applied_at) VALUES (?, ?, ?)').run(
        migration.id,
        migration.name,
        new Date().toISOString(),
      )
      db.exec('COMMIT')
      ran++
    } catch (err) {
      db.exec('ROLLBACK')
      console.error(`[Migration] FAILED #${migration.id}: ${migration.name}`, err)
      throw err // Halt startup — do not run a broken database
    }
  }

  if (ran > 0) {
    console.log(`[Migration] Applied ${ran} migration(s) successfully.`)
  } else {
    console.log('[Migration] Schema is up to date.')
  }
}
