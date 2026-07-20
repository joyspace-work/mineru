# EV Export Management Pipeline Improvement Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the EV export management pipeline to consolidate n8n branches, introduce local SQLite candidate review storage, automate model_id mapping using local Feishu mirrors, enforce strict validation before Feishu sync (reject missing brand/model, prevent CNY values entering USD fields), and implement robust deduplication and retries.

**Architecture:** 
1. **Single Entry Execution**: Consolidate n8n to call a single script `scripts/run_pipeline.js` via command line.
2. **Local SQLite Cache**: Candidates are parsed and cached into a local SQLite database (`local_source.db`), allowing command-line review (`--action list/edit/delete/sync/export`) instead of straight Feishu pushes.
3. **Double-Guarded Validation & Enrichment**: Ensure exact matching of `model_id` using local `vehicle_models.json` tables, block records lacking valid brand/model, filter CNY numbers from USD fields, and deduplicate files using SHA-256 hashes.
4. **Resilient Network Syncing**: Implement batch uploads with exponential backoff retries (handling rate limits & timeouts).

**Tech Stack:** Node.js, SQLite3 (via `bun:sqlite`), Gemini API, n8n, Python 3.

## Global Constraints
- **Absolute Paths Limit**: Do not use hardcoded absolute paths `/Users/a12/...` in any JS/Python scripts. Use `path.join(__dirname, ...)` relative paths or load from environment variables.
- **Strict Data Verification**: Records missing brand or model must be rejected. Cost values in CNY must NOT populate `*_usd` fields.
- **Database Segregation**: All staging candidate data must go into `local_source.db`. The `feishu.db` is purely a read-only mirror.

---

### Task 1: Environment Variables and Path Decoupling

**Files:**
- Create: `tests/task1_path_env.test.js`
- Modify: `scripts/run_pipeline.js:10-45`
- Modify: `scripts/gemini_extract.js:10-35`
- Modify: `scripts/parse_document.py:10-50`

**Interfaces:**
- Consumes: `.env` file variables (`CLASSIFIED_DIR`, `OUTPUT_DIR`, etc.)
- Produces: Normalized directories independent of absolute user paths.

- [ ] **Step 1: Write a test verifying that no absolute path string like "/Users/" exists in codebase scripts**
  
  Create `tests/task1_path_env.test.js` to search code files for absolute paths:
  ```javascript
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
      expect(content).not.toContain('/Users/a12/');
    }
  });
  ```

- [ ] **Step 2: Run test to verify it fails (if absolute paths exist)**
  
  Run: `bun test tests/task1_path_env.test.js`
  Expected: FAIL or verify if any paths leak.

- [ ] **Step 3: Modify scripts to use relative paths & environment variables**
  
  Update `scripts/run_pipeline.js`, `scripts/gemini_extract.js`, and `scripts/parse_document.py` to calculate paths dynamically based on `__dirname` or relative project directories:
  ```javascript
  const PROJECT_ROOT = path.resolve(__dirname, '..');
  const INPUT_DIR = process.env.CLASSIFIED_DIR || path.join(PROJECT_ROOT, 'input/classified');
  const OUTPUT_DIR = process.env.OUTPUT_DIR || path.join(PROJECT_ROOT, 'output');
  ```

- [ ] **Step 4: Run test to verify it passes**
  
  Run: `bun test tests/task1_path_env.test.js`
  Expected: PASS

- [ ] **Step 5: Commit changes**
  
  Run:
  ```bash
  git add scripts/ tests/task1_path_env.test.js
  git commit -m "feat: decouple absolute paths using relative paths and environment variables"
  ```

---

### Task 2: Sync Validator (Enforce Brand/Model Constraints & CNY Currency Guard)

**Files:**
- Create: `tests/task2_validator.test.js`
- Modify: `scripts/run_pipeline.js:230-290` (within `formatCandidatesForFeishu`)

**Interfaces:**
- Consumes: Unvalidated Candidate records
- Produces: Sanitized and validated records matching Bitable business specifications.

- [ ] **Step 1: Write test for candidate validation constraints**
  
  Create `tests/task2_validator.test.js`:
  ```javascript
  const { test, expect } = require('bun:test');
  const { formatCandidatesForFeishu } = require('../scripts/run_pipeline.js');

  test('Sync validator rules', () => {
    const raw = [
      { brand: null, modelName: 'Dolphin', priceExw: 10000 }, // Missing brand
      { brand: 'BYD', modelName: null, priceExw: 10000 }, // Missing model
      { brand: 'BYD', modelName: 'Dolphin', priceExw: 70000, priceExwCurrency: 'CNY' }, // CNY into EXW
      { brand: 'BYD', modelName: 'Dolphin', priceExw: 12000, priceExwCurrency: 'USD' } // Valid
    ];

    const result = formatCandidatesForFeishu(raw);
    
    // Dolphin records with missing brand/model should be excluded or marked invalid
    const validRecords = result.filter(r => r.brand && r.model);
    expect(validRecords.length).toBe(2);

    // CNY priceExw should NOT go into cost_exw_usd
    const cnyExwRecord = validRecords.find(r => r.cost_exw_usd === 70000);
    expect(cnyExwRecord).toBeUndefined(); // Filtered/cleaned to null

    const usdRecord = validRecords.find(r => r.cost_exw_usd === 12000);
    expect(usdRecord).toBeDefined();
  });
  ```

- [ ] **Step 2: Run test to verify it fails**
  
  Run: `bun test tests/task2_validator.test.js`
  Expected: FAIL (missing validation controls)

- [ ] **Step 3: Modify `formatCandidatesForFeishu` inside `scripts/run_pipeline.js` to implement validation**
  
  Inject checks inside `formatCandidatesForFeishu`:
  - Discard/filter out records without both a brand and model.
  - Check currency indicators (e.g. `priceExwCurrency`). If the currency is `'CNY'` or price value is in CNY range (e.g. `priceExw >= 30000` with CNY currency, or explicitly labeled CNY), keep `cost_exw_usd` as `null` (since the table column is strictly USD).
  - Also ensure that if the price value is a Guidance Price in CNY, it goes into `official_suggested_price_cny`, NOT `*_usd`.

- [ ] **Step 4: Run test to verify it passes**
  
  Run: `bun test tests/task2_validator.test.js`
  Expected: PASS

- [ ] **Step 5: Commit changes**
  
  Run:
  ```bash
  git add scripts/run_pipeline.js tests/task2_validator.test.js
  git commit -m "feat: add sync validator to guard against missing brand/model and filter CNY prices out of USD fields"
  ```

---

### Task 3: Local SQLite Staging Cache & Command Line Interface Consolidation

**Files:**
- Create: `tests/task3_sqlite_cli.test.js`
- Modify: `scripts/run_pipeline.js` (Rewrite main function to support action CLI modes)

**Interfaces:**
- Consumes: CLI Arguments (`--action run`, `--action list`, `--action sync`, `--action edit`)
- Produces: Record state changes in SQLite database `local_source.db`, structured Feishu uploads on sync.

- [ ] **Step 1: Write test for SQLite staging table creation and action execution**
  
  Create `tests/task3_sqlite_cli.test.js` using `bun:sqlite` to test Candidate Database functions:
  ```javascript
  const { test, expect, beforeAll } = require('bun:test');
  const { Database } = require('bun:sqlite');
  const fs = require('fs');

  test('Local cache DB staging operations', () => {
    const dbPath = 'local_source_test.db';
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    const db = new Database(dbPath);

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
    const row = db.prepare("SELECT * FROM source_candidates WHERE brand = 'BYD'").get();
    expect(row.model).toBe('Dolphin');
    expect(row.status).toBe('pending');

    db.close();
    fs.unlinkSync(dbPath);
  });
  ```

- [ ] **Step 2: Run test to verify it fails / passes**
  
  Run: `bun test tests/task3_sqlite_cli.test.js`
  Expected: PASS (database interface is functional)

- [ ] **Step 3: Implement SQLite backend and actions in `scripts/run_pipeline.js`**
  
  - Create table `source_candidates` in `local_source.db` with standard vehicles schema fields plus `status TEXT DEFAULT 'pending'` and `source_file TEXT`, `content_hash TEXT`.
  - Update `main` function arguments parser:
    - `run_pipeline.js --action run`: Runs document extraction and imports parsed rows into SQLite `local_source.db` with `status = 'pending'`. Does NOT automatically sync to Feishu.
    - `run_pipeline.js --action list`: Renders a table (using console.table or formatted columns) showing all `pending` candidates.
    - `run_pipeline.js --action edit --id <id> --key <field> --val <value>`: Updates the specified column in SQLite candidate table.
    - `run_pipeline.js --action delete --id <id>`: Deletes the pending record.
    - `run_pipeline.js --action sync`: Reads all `pending` rows from `local_source.db`, batches them up, pushes to Feishu Bitable, and updates their SQLite state to `synced`.

- [ ] **Step 4: Run CLI smoke tests to verify action flow**
  
  Run: `bun run scripts/run_pipeline.js --action list`
  Expected: Prints clean table (or Empty list).

- [ ] **Step 5: Commit changes**
  
  Run:
  ```bash
  git add scripts/run_pipeline.js tests/task3_sqlite_cli.test.js
  git commit -m "feat: consolidate pipeline CLI actions and implement local SQLite staging cache"
  ```

---

### Task 4: Automated model_id Enrichment using local Feishu Mirrors

**Files:**
- Create: `tests/task4_model_id.test.js`
- Modify: `scripts/run_pipeline.js` (within candidate mapping function)

**Interfaces:**
- Consumes: Candidate record (`brand`, `model`)
- Produces: Candidate record with populated `model_id` field mapped from `feishu_tables/vehicle_models.json`.

- [ ] **Step 1: Write test for model_id mapping lookup**
  
  Create `tests/task4_model_id.test.js` using mock data matching `feishu_tables/vehicle_models.json`:
  ```javascript
  const { test, expect } = require('bun:test');
  const path = require('path');
  const fs = require('fs');

  test('Model ID mapping resolver', () => {
    // Read the actual feishu_tables/vehicle_models.json
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
  ```

- [ ] **Step 2: Run test to verify it passes**
  
  Run: `bun test tests/task4_model_id.test.js`
  Expected: PASS

- [ ] **Step 3: Implement model_id backfilling in `formatCandidatesForFeishu`**
  
  - Load `feishu_tables/vehicle_models.json` on startup.
  - Compile brand/model index.
  - Match normalized candidate brand and model (e.g. `byd dolphin`) and enrich the candidate object with the appropriate `model_id`.

- [ ] **Step 4: Run pipeline dry-run to check model_id output**
  
  Run: `bun run scripts/run_pipeline.js --action run --dry-run`
  Expected: Check that output candidates in log contain valid `model_id` fields (e.g., `"model_id": "MDL-002"` for Seagull).

- [ ] **Step 5: Commit changes**
  
  Run:
  ```bash
  git add scripts/run_pipeline.js tests/task4_model_id.test.js
  git commit -m "feat: resolve and fill model_id dynamically from vehicle_models.json"
  ```

---

### Task 5: Robust Upload Retries with Exponential Backoff

**Files:**
- Create: `tests/task5_retry.test.js`
- Modify: `scripts/run_pipeline.js:320-390` (within `syncToFeishu` network logic)

**Interfaces:**
- Consumes: Feishu batch upload API payload
- Produces: Successful HTTP upload or logs error on persistent exhaustion.

- [ ] **Step 1: Write test for retry engine with mock delay**
  
  Create `tests/task5_retry.test.js`:
  ```javascript
  const { test, expect } = require('bun:test');

  async function fetchWithRetry(mockFetch, maxRetries = 3) {
    let delay = 100;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const resp = await mockFetch();
        if (resp.status === 429 || resp.status >= 500) {
          throw new Error(`HTTP ${resp.status}`);
        }
        return resp.json();
      } catch (err) {
        if (attempt === maxRetries) throw err;
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
      }
    }
  }

  test('Fetch with retry backoff', async () => {
    let attempts = 0;
    const mockFailingFetch = async () => {
      attempts++;
      if (attempts < 3) return { status: 429 };
      return { status: 200, json: async () => ({ code: 0, msg: 'success' }) };
    };

    const res = await fetchWithRetry(mockFailingFetch, 4);
    expect(attempts).toBe(3);
    expect(res.code).toBe(0);
  });
  ```

- [ ] **Step 2: Run test to verify it passes**
  
  Run: `bun test tests/task5_retry.test.js`
  Expected: PASS

- [ ] **Step 3: Update `syncToFeishu` network request inside `run_pipeline.js` to implement backoff retries**
  
  Embed backoff wrapper around the Feishu Bitable API `batch_create` call:
  - Retry on network error, status `429` (rate limit), or `>= 500` server errors.
  - Log warning on retry: `[Feishu Sync] Rate limit hit, retrying in X ms...`

- [ ] **Step 4: Verify syntax and run pipeline**
  
  Run: `bun run scripts/run_pipeline.js --action list`
  Expected: Runs successfully.

- [ ] **Step 5: Commit changes**
  
  Run:
  ```bash
  git add scripts/run_pipeline.js tests/task5_retry.test.js
  git commit -m "feat: add exponential backoff retry mechanism to Feishu syncing"
  ```

---

### Task 6: Idempotent Deduplication (SHA-256 Content Hash Guard)

**Files:**
- Create: `tests/task6_dedup.test.js`
- Modify: `scripts/run_pipeline.js`

**Interfaces:**
- Consumes: Target file content hash
- Produces: Skips file parsing if match found in SQLite execution history.

- [ ] **Step 1: Write test for file content hash tracking**
  
  Create `tests/task6_dedup.test.js`:
  ```javascript
  const { test, expect } = require('bun:test');
  const crypto = require('crypto');

  test('SHA-256 hash generation', () => {
    const text = 'test content';
    const hash = crypto.createHash('sha256').update(text).digest('hex');
    expect(hash.length).toBe(64);
  });
  ```

- [ ] **Step 2: Run test to verify it passes**
  
  Run: `bun test tests/task6_dedup.test.js`
  Expected: PASS

- [ ] **Step 3: Implement file tracking and hash verification in `scripts/run_pipeline.js`**
  
  - Create table `processed_files (id INTEGER PRIMARY KEY, filename TEXT, content_hash TEXT UNIQUE, processed_at DATETIME DEFAULT CURRENT_TIMESTAMP)` in SQLite.
  - Before parsing any Excel, image, or PDF file:
    - Generate SHA-256 hash of file buffer.
    - Check if `content_hash` already exists in `processed_files`.
    - If yes, skip parsing with log: `⏭️  Skipping already processed file: ${filename}`.
    - If no, proceed with parsing, save candidates with hash, and record hash in `processed_files` on success.

- [ ] **Step 4: Run pipeline run to verify double runs skip files**
  
  Run: `bun run scripts/run_pipeline.js --action run --dry-run`
  Expected: Check console logs to see duplicate entries being skipped.

- [ ] **Step 5: Commit changes**
  
  Run:
  ```bash
  git add scripts/run_pipeline.js tests/task6_dedup.test.js
  git commit -m "feat: implement SHA-256 content hash file tracking to prevent duplicate parsing"
  ```

---

### Task 7: Unified Document Processing (Texts/Docx/PPTX Support) & Error Notification

**Files:**
- Modify: `scripts/parse_document.py`
- Modify: `scripts/run_pipeline.js`

**Interfaces:**
- Consumes: Texts, Docx, or PPTX input files
- Produces: Clean markdown text strings passed to gemini_extract module.

- [ ] **Step 1: Expand `scripts/parse_document.py` text extraction handlers**
  
  - Inject handlers for `.docx` and `.pptx` files:
    ```python
    # Using python-docx and python-pptx
    from docx import Document
    from pptx import Presentation

    def extract_docx(file_path):
        doc = Document(file_path)
        return "\n".join([p.text for p in doc.paragraphs])

    def extract_pptx(file_path):
        prs = Presentation(file_path)
        text_runs = []
        for slide in prs.slides:
            for shape in slide.shapes:
                if hasattr(shape, "text"):
                    text_runs.append(shape.text)
        return "\n".join(text_runs)
    ```

- [ ] **Step 2: Verify PPTX/DOCX dependency installation in script execution**
  
  Ensure `parse_document.py` installs requirements on startup gracefully (e.g. `pip install python-docx python-pptx` if import fails).

- [ ] **Step 3: Update `run_pipeline.js` file traversal to forward Docx/PPTX**
  
  Support parsing txt, docx, and pptx under `input/classified/texts` or unified directories.

- [ ] **Step 4: Create local Error summary file**
  
  If any extraction fails, record the filename and exception message to `output/errors_summary.json`.

- [ ] **Step 5: Commit changes**
  
  Run:
  ```bash
  git add scripts/parse_document.py scripts/run_pipeline.js
  git commit -m "feat: add PPTX and DOCX extraction support and implement local errors summary"
  ```
