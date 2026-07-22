#!/usr/bin/env node
/**
 * 全流水线编排器 — MinerU 专业识别 + 文本结构化抽取
 * 
 * 流程：
 *   1. XLSX 库解析 Excel → 结构化 JSON
 *   2. MinerU (ocr_process.py) 处理图片/PDF/文档 → Markdown → Gemini 纯文本提取
 *   3. 专业识别失败时记录错误，并询问是否启用视觉大模型兜底
 *   4. 读取纯文本文件 → Gemini 提取
 *   5. 合并并经过自学习规则修正 → 上传飞书 / 本地保存
 */

const fs = require('fs');
const path = require('path');
const { execFileSync, execSync } = require('child_process');
const { Database } = require('bun:sqlite');
const crypto = require('crypto');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const CLASSIFIED_DIR = process.env.CLASSIFIED_DIR || path.join(PROJECT_ROOT, 'input/classified');
const OUTPUT_DIR = process.env.OUTPUT_DIR || path.join(PROJECT_ROOT, 'output');
const RECOGNIZED_DIR = path.join(OUTPUT_DIR, 'recognized', 'mineru');

function loadEnv() {
  const envPath = path.join(PROJECT_ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  const envText = fs.readFileSync(envPath, 'utf-8');
  for (const line of envText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnv();

function validateAiConfig() {
  const provider = String(process.env.AI_PROVIDER || 'gemini').trim().toLowerCase();
  if (provider === 'openrouter') {
    if (!process.env.OPENROUTER_API_KEY) {
      return {
        ok: false,
        message: 'AI 结构化抽取不可继续：AI_PROVIDER=openrouter，但未配置 OPENROUTER_API_KEY。',
      };
    }
    return { ok: true };
  }

  if (!process.env.GEMINI_API_KEY) {
    return {
      ok: false,
      message: 'AI 结构化抽取不可继续：未配置 GEMINI_API_KEY。若使用 OpenRouter，请设置 AI_PROVIDER=openrouter 和 OPENROUTER_API_KEY。',
    };
  }
  return { ok: true };
}

function normalizeDateValue(value) {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    if (value > 100000000000) return new Date(value).toISOString().slice(0, 10);
    if (value > 100000000) return new Date(value * 1000).toISOString().slice(0, 10);
    return null;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const ymd = raw.match(/(20\d{2})\D{0,3}(\d{1,2})\D{0,3}(\d{1,2})/);
  if (ymd) {
    const [, year, month, day] = ymd;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const ym = raw.match(/(20\d{2})\D{0,3}(\d{1,2})/);
  if (ym) {
    const [, year, month] = ym;
    return `${year}-${month.padStart(2, '0')}-01`;
  }

  return null;
}

function getManufactureDate(row) {
  return normalizeDateValue(
    row.manufactureDate ??
    row.manufacture_date ??
    row.productionDate ??
    row.production_date ??
    row.time ??
    null
  );
}

function computeFileHash(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found for hashing: ${filePath}`);
  }
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function getDb(dbPath = path.join(PROJECT_ROOT, 'local_source.db')) {
  const db = new Database(dbPath);
  db.run(`
    CREATE TABLE IF NOT EXISTS source_candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_id TEXT,
      brand TEXT,
      model TEXT,
      trim_config TEXT,
      manufacture_date TEXT,
      exterior_color TEXT,
      interior_color TEXT,
      stock_quantity INTEGER,
      min_quantity INTEGER,
      max_quantity INTEGER,
      lead_time TEXT,
      order_waiting_period TEXT,
      order_wait_days INTEGER,
      steering_setup TEXT,
      version_type TEXT,
      status_vehicle TEXT,
      official_suggested_price_cny REAL,
      official_suggested_price_usd REAL,
      cost_exw_cny REAL,
      cost_exw_usd REAL,
      cost_fob_cny REAL,
      cost_fob_usd REAL,
      cost_fca_cny REAL,
      cost_fca_usd REAL,
      cost_cif_cny REAL,
      cost_cif_usd REAL,
      location TEXT,
      supplier TEXT,
      notes TEXT,
      status TEXT DEFAULT 'pending',
      source_file TEXT,
      content_hash TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  const existingColumns = new Set(db.prepare("PRAGMA table_info(source_candidates)").all().map(c => c.name));
  if (!existingColumns.has('manufacture_date')) {
    db.run("ALTER TABLE source_candidates ADD COLUMN manufacture_date TEXT");
  }
  db.run(`
    CREATE TABLE IF NOT EXISTS processed_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT,
      content_hash TEXT UNIQUE,
      processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  return db;
}

function saveCandidatesToDb(db, candidates) {
  const insertStmt = db.prepare(`
    INSERT INTO source_candidates (
      model_id, brand, model, trim_config, exterior_color, interior_color,
      manufacture_date, stock_quantity, min_quantity, max_quantity, lead_time, order_waiting_period,
      order_wait_days, steering_setup, version_type, status_vehicle,
      official_suggested_price_cny, official_suggested_price_usd,
      cost_exw_cny, cost_exw_usd, cost_fob_cny, cost_fob_usd,
      cost_fca_cny, cost_fca_usd, cost_cif_cny, cost_cif_usd,
      location, supplier, notes, status, source_file, content_hash
    ) VALUES (
      $model_id, $brand, $model, $trim_config, $exterior_color, $interior_color,
      $manufacture_date, $stock_quantity, $min_quantity, $max_quantity, $lead_time, $order_waiting_period,
      $order_wait_days, $steering_setup, $version_type, $status_vehicle,
      $official_suggested_price_cny, $official_suggested_price_usd,
      $cost_exw_cny, $cost_exw_usd, $cost_fob_cny, $cost_fob_usd,
      $cost_fca_cny, $cost_fca_usd, $cost_cif_cny, $cost_cif_usd,
      $location, $supplier, $notes, $status, $source_file, $content_hash
    )
  `);

  const insertTransaction = db.transaction((rows) => {
    const insertedIds = [];
    for (const row of rows) {
      const result = insertStmt.run({
        $model_id: row.model_id ?? null,
        $brand: row.brand ?? null,
        $model: row.model ?? null,
        $trim_config: row.trim_config ?? null,
        $manufacture_date: row.manufacture_date ?? null,
        $exterior_color: row.exterior_color ?? null,
        $interior_color: row.interior_color ?? null,
        $stock_quantity: row.stock_quantity ?? null,
        $min_quantity: row.min_quantity ?? null,
        $max_quantity: row.max_quantity ?? null,
        $lead_time: row.lead_time ?? null,
        $order_waiting_period: row.order_waiting_period ?? null,
        $order_wait_days: row.order_wait_days ?? null,
        $steering_setup: row.steering_setup ?? null,
        $version_type: row.version_type ?? null,
        $status_vehicle: row.status_vehicle ?? null,
        $official_suggested_price_cny: row.official_suggested_price_cny ?? null,
        $official_suggested_price_usd: row.official_suggested_price_usd ?? null,
        $cost_exw_cny: row.cost_exw_cny ?? null,
        $cost_exw_usd: row.cost_exw_usd ?? null,
        $cost_fob_cny: row.cost_fob_cny ?? null,
        $cost_fob_usd: row.cost_fob_usd ?? null,
        $cost_fca_cny: row.cost_fca_cny ?? null,
        $cost_fca_usd: row.cost_fca_usd ?? null,
        $cost_cif_cny: row.cost_cif_cny ?? null,
        $cost_cif_usd: row.cost_cif_usd ?? null,
        $location: row.location ?? null,
        $supplier: row.supplier ?? null,
        $notes: row.notes ?? null,
        $status: 'pending',
        $source_file: row.source_file ?? null,
        $content_hash: row.content_hash ?? null
      });
      insertedIds.push(Number(result.lastInsertRowid));
    }
    return insertedIds;
  });

  const insertedIds = insertTransaction(candidates);
  console.log(`   💾 Staged ${candidates.length} candidates into local_source.db (status = 'pending')`);
  return insertedIds;
}

function markCandidatesSynced(db, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return;
  const updateStmt = db.prepare('UPDATE source_candidates SET status = ? WHERE id = ?');
  const updateTransaction = db.transaction((idList) => {
    for (const recordId of idList) {
      updateStmt.run('synced', recordId);
    }
  });
  updateTransaction(ids);
  console.log(`✅ Marked ${ids.length} records as 'synced' in local_source.db.`);
}



// ──────────────────────────────────────────────
// Step 0: 输入文件分类
// ──────────────────────────────────────────────
function runClassification() {
  console.log('\n═══════════════════════════════════════');
  console.log('📂 Step 0: 输入文件分类');
  console.log('═══════════════════════════════════════\n');

  execFileSync(process.execPath, [path.join(__dirname, 'classify_inputs.js')], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
  });
}

// ──────────────────────────────────────────────
// Step 1: MinerU 专业识别 (调用 python ocr_process.py)
// ──────────────────────────────────────────────
function runOcr(options = {}) {
  console.log('\n═══════════════════════════════════════');
  console.log('📸 Step 1: MinerU 专业识别');
  console.log('═══════════════════════════════════════\n');

  try {
    const forceArg = options.force ? ' --force' : '';
    const pythonCmd = process.env.PYTHON || 'python';
    const cmd = `${pythonCmd} ${path.join(__dirname, 'ocr_process.py')} --engine mineru${forceArg}`;
    execSync(cmd, { cwd: PROJECT_ROOT, stdio: 'inherit', timeout: 600000 });
    return true;
  } catch (err) {
    console.log('⚠️  MinerU 专业识别未完成。请查看 output/recognized/mineru/errors.json。');
    return false;
  }
}

function readRecognitionManifest() {
  const manifestPath = path.join(RECOGNIZED_DIR, 'manifest.json');
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch {
    return null;
  }
}

function hasRecognizedFiles() {
  const manifest = readRecognitionManifest();
  return Array.isArray(manifest?.files) && manifest.files.length > 0;
}

function hasRecognitionErrors() {
  const errorsPath = path.join(RECOGNIZED_DIR, 'errors.json');
  try {
    const data = JSON.parse(fs.readFileSync(errorsPath, 'utf-8'));
    return Array.isArray(data?.errors) && data.errors.length > 0;
  } catch {
    return false;
  }
}

async function promptForVisionFallback(args = []) {
  if (args.includes('--vision-fallback')) return true;
  if (args.includes('--no-vision-fallback')) return false;

  const envValue = String(process.env.ALLOW_LLM_VISION_FALLBACK || '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'always'].includes(envValue)) return true;
  if (['0', 'false', 'no', 'n', 'never'].includes(envValue)) return false;

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log('   非交互环境，默认不启用视觉大模型兜底。');
    return false;
  }

  const readline = require('readline/promises');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question('MinerU 识别失败。是否通过视觉大模型兜底识别图片/PDF？输入 y 启用，其余跳过: ');
    return ['y', 'yes'].includes(String(answer).trim().toLowerCase());
  } finally {
    rl.close();
  }
}

// ──────────────────────────────────────────────
// Step 2: Excel 解析
// ──────────────────────────────────────────────
function runExcelParsing(db, dryRun) {
  console.log('\n═══════════════════════════════════════');
  console.log('📊 Step 2: Excel 解析');
  console.log('═══════════════════════════════════════\n');

  const { parseExcelFile } = require('./parse_excel');
  const EXCELS_DIR = path.join(PROJECT_ROOT, 'input/classified/excels');
  if (!fs.existsSync(EXCELS_DIR)) {
    console.log('⚠️  No excels directory found');
    return [];
  }

  const files = fs.readdirSync(EXCELS_DIR).filter(f => /\.(xlsx|xls|csv)$/i.test(f));
  const allResults = [];

  console.log(`\n📊 Processing ${files.length} Excel files...\n`);

  for (const file of files) {
    const filePath = path.join(EXCELS_DIR, file);
    try {
      const hash = computeFileHash(filePath);

      // Check if hash exists in processed_files
      const processed = db.prepare("SELECT 1 FROM processed_files WHERE content_hash = ?").get(hash);
      if (processed) {
        console.log(`⏭️  Skipping already processed file: ${file}`);
        continue;
      }

      const rows = parseExcelFile(filePath);
      console.log(`  ✅ ${file}: ${rows.length} rows`);

      for (const row of rows) {
        row._content_hash = hash;
        row._source_file = file;
      }

      // Save per-file JSON
      const parsedDir = path.join(OUTPUT_DIR, 'parsed/excels');
      fs.mkdirSync(parsedDir, { recursive: true });
      const outputPath = path.join(parsedDir, file.replace(/\.[^.]+$/, '.json'));
      fs.writeFileSync(outputPath, JSON.stringify(rows, null, 2), 'utf-8');

      allResults.push({
        source: filePath,
        outputPath,
        rowCount: rows.length,
        rows,
      });

      // Insert record into processed_files
      if (!dryRun) {
        db.prepare("INSERT INTO processed_files (filename, content_hash) VALUES (?, ?)").run(file, hash);
      }
    } catch (err) {
      console.error(`  ❌ ${file}: ${err.message}`);
    }
  }

  // Write combined manifest
  const parsedDir = path.join(OUTPUT_DIR, 'parsed/excels');
  fs.mkdirSync(parsedDir, { recursive: true });
  const manifestPath = path.join(parsedDir, 'manifest.json');
  const manifest = {
    processedAt: new Date().toISOString(),
    totalFiles: allResults.length,
    totalRows: allResults.reduce((sum, r) => sum + r.rowCount, 0),
    files: allResults.map(({ source, outputPath, rowCount }) => ({ source, outputPath, rowCount })),
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

  console.log(`\n✅ Excel parsing complete: ${manifest.totalFiles} files, ${manifest.totalRows} rows`);
  return allResults;
}

// ──────────────────────────────────────────────
// Step 3: 提取非结构化车源 (MinerU 识别结果 / 文本)
// ──────────────────────────────────────────────
async function runExtraction(ocrSuccess, db, dryRun, options = {}) {
  console.log('\n═══════════════════════════════════════');
  console.log('🤖 Step 3: AI 结构化提取');
  console.log('═══════════════════════════════════════\n');

  const { processOcrOutput, processTextFile, processVisionFallbackFile, getApiConfig } = require('./gemini_extract');
  const config = getApiConfig();
  console.log(`   Provider: ${config.provider}, Model: ${config.model}`);
  if (!config.apiKey) {
    console.error('❌ 未设置 AI API Key！请在 .env 中配置 GEMINI_API_KEY 或 OPENROUTER_API_KEY');
    return [];
  }

  const allCandidates = [];

  // 判断是否走 MinerU 文本提取
  const manifestPath = path.join(RECOGNIZED_DIR, 'manifest.json');
  const hasLocalOcr = ocrSuccess && hasRecognizedFiles();

  if (hasLocalOcr) {
    // 3a. MinerU 识别通道 (Text Mode)
    console.log('   🟢 MinerU 识别结果可用，正在读取 Markdown 结果...');
    const manifest = readRecognitionManifest();
    for (const file of manifest.files || []) {
      const targetPath = fs.existsSync(file.source) ? file.source : (fs.existsSync(file.output_path) ? file.output_path : null);
      if (!targetPath) continue;
      const filename = path.basename(file.source_rel || file.source || file.output_path);
      try {
        const hash = computeFileHash(targetPath);

        // Check if hash exists in processed_files
        const processed = db.prepare("SELECT 1 FROM processed_files WHERE content_hash = ?").get(hash);
        if (processed) {
          console.log(`⏭️  Skipping already processed file: ${filename}`);
          continue;
        }

        console.log(`   🔄 Extracting (Text Mode): ${filename}`);
        const candidates = await processOcrOutput(file.output_path, file.source_rel);
        
        for (const c of candidates) {
          c._content_hash = hash;
          c._source_file = filename;
        }

        allCandidates.push(...candidates);
        console.log(`      → ${candidates.length} candidates`);

        // Insert record into processed_files
        if (!dryRun) {
          db.prepare("INSERT INTO processed_files (filename, content_hash) VALUES (?, ?)").run(filename, hash);
        }

        await new Promise(r => setTimeout(r, 500));
      } catch (err) {
        console.error(`   ❌ ${filename}: ${err.message}`);
      }
    }
  } else {
    console.log('   ⚠️  未找到 MinerU 识别 manifest。');
    console.log(`   Expected: ${manifestPath}`);
    if (options.allowVisionFallback) {
      console.log('   用户已确认启用视觉大模型兜底识别。');
      const fallbackBuckets = [
        { name: 'images', pattern: /\.(png|jpg|jpeg|webp|gif)$/i },
        { name: 'pdfs', pattern: /\.pdf$/i },
      ];

      for (const bucket of fallbackBuckets) {
        const bucketDir = path.join(CLASSIFIED_DIR, bucket.name);
        if (!fs.existsSync(bucketDir)) continue;
        const files = fs.readdirSync(bucketDir).filter(f => bucket.pattern.test(f));
        console.log(`\n   ${bucket.name}: ${files.length}`);
        for (const file of files) {
          const filePath = path.join(bucketDir, file);
          try {
            const hash = computeFileHash(filePath);
            const processed = db.prepare("SELECT 1 FROM processed_files WHERE content_hash = ?").get(hash);
            if (processed) {
              console.log(`⏭️  Skipping already processed file: ${file}`);
              continue;
            }

            console.log(`   🔄 Extracting (Vision fallback, user approved): ${file}`);
            const candidates = await processVisionFallbackFile(filePath);
            for (const c of candidates) {
              c._content_hash = hash;
              c._source_file = file;
            }

            allCandidates.push(...candidates);
            console.log(`      → ${candidates.length} candidates`);

            if (!dryRun) {
              db.prepare("INSERT INTO processed_files (filename, content_hash) VALUES (?, ?)").run(file, hash);
            }

            await new Promise(r => setTimeout(r, 1000));
          } catch (err) {
            console.error(`   ❌ ${file}: ${err.message}`);
          }
        }
      }
    } else {
      console.log('   未启用视觉大模型兜底，跳过图片/PDF。');
    }
  }

  // 3c. 处理纯文本
  const textsDir = path.join(CLASSIFIED_DIR, 'texts');
  if (fs.existsSync(textsDir)) {
    const textFiles = fs.readdirSync(textsDir).filter(f => /\.(txt|md)$/i.test(f));
    console.log(`\n   📝 Text files: ${textFiles.length}`);
    for (const file of textFiles) {
      const filePath = path.join(textsDir, file);
      try {
        const content = fs.readFileSync(filePath, 'utf-8').trim();
        if (content.length < 5) continue;
        
        const hash = computeFileHash(filePath);

        // Check if hash exists in processed_files
        const processed = db.prepare("SELECT 1 FROM processed_files WHERE content_hash = ?").get(hash);
        if (processed) {
          console.log(`⏭️  Skipping already processed file: ${file}`);
          continue;
        }

        console.log(`   🔄 Extracting (Text Mode): ${file}`);
        const candidates = await processTextFile(filePath);
        
        for (const c of candidates) {
          c._content_hash = hash;
          c._source_file = file;
        }

        allCandidates.push(...candidates);
        console.log(`      → ${candidates.length} candidates`);

        // Insert record into processed_files
        if (!dryRun) {
          db.prepare("INSERT INTO processed_files (filename, content_hash) VALUES (?, ?)").run(file, hash);
        }

        await new Promise(r => setTimeout(r, 500));
      } catch (err) {
        console.error(`   ❌ ${file}: ${err.message}`);
      }
    }
  }

  return allCandidates;
}

// ──────────────────────────────────────────────
// Step 4: 合并数据
// ──────────────────────────────────────────────
function mergeAllCandidates(excelResults, aiCandidates) {
  console.log('\n═══════════════════════════════════════');
  console.log('🔀 Step 4: 合并所有数据');
  console.log('═══════════════════════════════════════\n');

  const all = [];

  for (const result of excelResults) {
    for (const row of result.rows || []) {
      if (row._type === 'unstructured') continue;
      all.push({
        ...row,
        _source_type: 'excel',
        _source_file: row._source_file || path.basename(result.source),
        _content_hash: row._content_hash || null,
      });
    }
  }

  for (const candidate of aiCandidates) {
    all.push({
      ...candidate,
      _source_type: 'ai_extracted',
      _source_file: candidate._source_file || null,
      _content_hash: candidate._content_hash || null,
    });
  }

  console.log(`   Excel rows:     ${all.filter(r => r._source_type === 'excel').length}`);
  console.log(`   AI candidates:  ${all.filter(r => r._source_type === 'ai_extracted').length}`);
  console.log(`   Total:          ${all.length}`);

  return all;
}

// ──────────────────────────────────────────────
// Step 5: 自学习规则修正
// ──────────────────────────────────────────────
function applyLearningRules(candidates) {
  console.log('\n═══════════════════════════════════════');
  console.log('📚 Step 5: 自学习规则修正');
  console.log('═══════════════════════════════════════\n');

  const { applyRulesToBatch, getStats } = require('./learning_engine');
  const stats = getStats();
  console.log(`   Active rules:      ${stats.activeRules}`);
  console.log(`   Total corrections: ${stats.totalCorrections}`);
  console.log(`   Pending:           ${stats.pendingSuggestions}`);

  const results = applyRulesToBatch(candidates);
  const modified = results.filter(r => r.appliedRules.length > 0).length;
  console.log(`   Auto-corrected:    ${modified}/${candidates.length} rows`);

  return results.map(r => r.candidate);
}

// ──────────────────────────────────────────────
// Step 6: 格式化为飞书标准 Schema
// ──────────────────────────────────────────────
// ──────────────────────────────────────────────
// Step 6: 格式化为飞书标准 Schema
// ──────────────────────────────────────────────
const BRAND_MODEL_MAPPING = {
  // 比亚迪
  '海豚': { brand: 'BYD', model: 'Dolphin' },
  'dolphin': { brand: 'BYD', model: 'Dolphin' },
  '汉ev': { brand: 'BYD', model: 'Han EV' },
  'hanev': { brand: 'BYD', model: 'Han EV' },
  '秦plus': { brand: 'BYD', model: 'Qin PLUS EV' },
  'qinplusev': { brand: 'BYD', model: 'Qin PLUS EV' },
  '海鸥': { brand: 'BYD', model: 'Seagull' },
  'seagull': { brand: 'BYD', model: 'Seagull' },
  '海豹': { brand: 'BYD', model: 'Seal' },
  'seal': { brand: 'BYD', model: 'Seal' },
  '海狮05ev': { brand: 'BYD', model: 'Sealion 7' },
  '海狮07ev': { brand: 'BYD', model: 'Sealion 7' },
  '海狮7': { brand: 'BYD', model: 'Sealion 7' },
  'sealion7': { brand: 'BYD', model: 'Sealion 7' },
  '鲨鱼': { brand: 'BYD', model: 'Shark' },
  'shark': { brand: 'BYD', model: 'Shark' },
  'shark6': { brand: 'BYD', model: 'Shark' },
  '唐lev': { brand: 'BYD', model: 'Tang L EV' },
  'tanglev': { brand: 'BYD', model: 'Tang L EV' },
  '元up': { brand: 'BYD', model: 'Yuan UP' },
  'yuanup': { brand: 'BYD', model: 'Yuan UP' },
  // 长安
  '糯玉米': { brand: 'Changan', model: 'Lumin' },
  'lumin': { brand: 'Changan', model: 'Lumin' },
  '启源q05': { brand: 'Changan Nevo', model: 'Q05' },
  'q05': { brand: 'Changan Nevo', model: 'Q05' },
  // 深蓝
  's05': { brand: 'Deepal', model: 'S05' },
  's07': { brand: 'Deepal', model: 'S07' },
  // 东风
  '纳米01': { brand: 'Dongfeng', model: 'Nammi 01' },
  'nammi01': { brand: 'Dongfeng', model: 'Nammi 01' },
  '锐骐6ev': { brand: 'Dongfeng', model: 'Rich 6 EV' },
  'rich6ev': { brand: 'Dongfeng', model: 'Rich 6 EV' },
  // 方程豹
  '豹3': { brand: 'Fangchengbao', model: 'Ti 3' },
  '钛3': { brand: 'Fangchengbao', model: 'Ti 3' },
  'ti3': { brand: 'Fangchengbao', model: 'Ti 3' },
  '豹5': { brand: 'Fangchengbao', model: 'Leopard 5' },
  'leopard5': { brand: 'Fangchengbao', model: 'Leopard 5' },
  '豹7': { brand: 'Fangchengbao', model: 'Ti 7' },
  '钛7': { brand: 'Fangchengbao', model: 'Ti 7' },
  'ti7': { brand: 'Fangchengbao', model: 'Ti 7' },
  '豹8': { brand: 'Fangchengbao', model: 'Leopard 8' },
  'leopard8': { brand: 'Fangchengbao', model: 'Leopard 8' },
  // 远程
  '星享v': { brand: 'Farizon', model: 'Xingxiang V' },
  'xingxiangv': { brand: 'Farizon', model: 'Xingxiang V' },
  // 广汽埃安
  'rt': { brand: 'GAC Aion', model: 'RT' },
  '埃安v': { brand: 'GAC Aion', model: 'V' },
  'aionv': { brand: 'GAC Aion', model: 'V' },
  'i60': { brand: 'GAC Aion', model: 'i60' },
  'yplus': { brand: 'GAC Motor', model: 'Aion Y Plus' },
  'aionyplus': { brand: 'GAC Motor', model: 'Aion Y Plus' },
  // 长城
  '炮ev': { brand: 'GWM', model: 'Cannon EV' },
  'cannonev': { brand: 'GWM', model: 'Cannon EV' },
  // 吉利
  '银河e5': { brand: 'Geely', model: 'Galaxy E5' },
  'galaxye5': { brand: 'Geely', model: 'Galaxy E5' },
  '银河m9': { brand: 'Geely', model: 'Galaxy M9' },
  'galaxym9': { brand: 'Geely', model: 'Galaxy M9' },
  '几何': { brand: 'Geely', model: 'Geome' },
  'geome': { brand: 'Geely', model: 'Geome' },
  '熊猫': { brand: 'Geely', model: 'Geome' },
  '几何c': { brand: 'Geely', model: 'Geometry C' },
  'geometryc': { brand: 'Geely', model: 'Geometry C' },
  // 红旗
  'e-hs9': { brand: 'Hongqi', model: 'E-HS9' },
  // 零跑
  'd19': { brand: 'Leapmotor', model: 'D19' },
  'lafa5': { brand: 'Leapmotor', model: 'Lafa 5' },
  't03': { brand: 'Leapmotor', model: 'T03' },
  // 理想
  'l6': { brand: 'Li Auto', model: 'L6' },
  // 领徽
  'e7': { brand: 'Linghui', model: 'e7' },
  // 名爵
  'mg4ev': { brand: 'MG', model: 'MG4 EV' },
  // 雷达
  'rd6': { brand: 'Radar', model: 'RD6' },
  // 享界
  's9': { brand: 'Stelato', model: 'S9' },
  // 坦克
  '500': { brand: 'Tank', model: '500 Hi4-T' },
  'tank500': { brand: 'Tank', model: '500 Hi4-T' },
  // 岚图
  '泰山x8': { brand: 'Voyah', model: 'Taishan X8' },
  'taishanx8': { brand: 'Voyah', model: 'Taishan X8' },
  // 五菱
  '缤果plus': { brand: 'Wuling', model: 'Bingo Plus' },
  'bingoplus': { brand: 'Wuling', model: 'Bingo Plus' },
  // 小鹏
  'g9': { brand: 'XPENG', model: 'G9' },
  // 小米
  Su7ultra: { brand: 'Xiaomi', model: 'SU7 Ultra' },
  'yu7': { brand: 'Xiaomi', model: 'YU7' },
  // 极氪
  '001': { brand: 'Zeekr', model: '001' },
  '9x': { brand: 'Zeekr', model: '9X' }
};

let vehicleModelsMapCache = null;
function getVehicleModelsMap() {
  if (vehicleModelsMapCache) return vehicleModelsMapCache;
  vehicleModelsMapCache = new Map();
  const filePath = path.join(PROJECT_ROOT, 'feishu_tables/vehicle_models.json');
  if (fs.existsSync(filePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const records = data.records || [];
      for (const r of records) {
        if (r.brand && r.model && r.model_id) {
          const key = `${r.brand.toLowerCase()}|${r.model.toLowerCase()}`;
          vehicleModelsMapCache.set(key, r.model_id);
        }
      }
    } catch (err) {
      console.warn('⚠️  Failed to load vehicle_models.json:', err.message);
    }
  }
  return vehicleModelsMapCache;
}

function formatCandidatesForFeishu(candidates) {
  const modelMap = getVehicleModelsMap();

  const toNum = (val) => {
    if (val === undefined || val === null || val === '') return null;
    const cleanStr = String(val).replace(/[^0-9.]/g, '');
    const num = Number(cleanStr);
    return isNaN(num) || cleanStr === '' ? null : num;
  };

  const filtered = candidates.filter(row => {
    const rawBrand = String(row.brand || '').trim();
    const rawModel = String(row.modelName || row.model || '').trim();
    return rawBrand.length > 0 && rawModel.length > 0;
  });

  return filtered.map(row => {
    let rawBrand = row.brand || '';
    let rawModel = row.modelName || row.model || '';

    // 匹配并转译为官方格式
    const key = String(rawModel).toLowerCase().replace(/\s+/g, '');
    let matchedBrand = rawBrand;
    let matchedModel = rawModel;
    if (BRAND_MODEL_MAPPING[key]) {
      matchedBrand = BRAND_MODEL_MAPPING[key].brand;
      matchedModel = BRAND_MODEL_MAPPING[key].model;
    } else {
      // 也可以用 brand+model 匹配
      const combinedKey = `${String(rawBrand).toLowerCase()}${String(rawModel).toLowerCase()}`.replace(/\s+/g, '');
      for (const [k, v] of Object.entries(BRAND_MODEL_MAPPING)) {
        if (combinedKey.includes(k)) {
          matchedBrand = v.brand;
          matchedModel = v.model;
          break;
        }
      }
    }

    let steering = null;
    const steerRaw = String(row.steeringSetup || row.notes || row.trimName || row.steering_setup || '').toUpperCase();
    if (steerRaw.includes('左舵') || steerRaw.includes('LHD')) {
      steering = '左舵';
    } else if (steerRaw.includes('右舵') || steerRaw.includes('RHD')) {
      steering = '右舵';
    }

    let market = null;
    const marketRaw = String(row.marketRegion || row.notes || row.trimName || row.market_region || '');
    if (marketRaw.includes('国内') || marketRaw.includes('中规')) {
      market = ['国内版'];
    } else if (marketRaw.includes('国际') || marketRaw.includes('出口') || marketRaw.includes('海外') || marketRaw.includes('欧标') || marketRaw.includes('美规')) {
      market = ['国际版'];
    }

    let waitDays = toNum(row.orderWaitDays || row.order_wait_days);
    if (waitDays === null && row.leadTimeText) {
      const textStr = String(row.leadTimeText);
      const mRangeWeek = textStr.match(/(\d+)\s*[-~至]\s*(\d+)\s*周/);
      if (mRangeWeek) {
        waitDays = Number(mRangeWeek[2]) * 7;
      } else {
        const mSingleWeek = textStr.match(/(\d+)\s*周/);
        if (mSingleWeek) {
          waitDays = Number(mSingleWeek[1]) * 7;
        } else {
          const mDays = textStr.match(/(\d+)\s*天/);
          if (mDays) {
            waitDays = Number(mDays[1]);
          }
        }
      }
    }

    const getCostUsd = (priceVal, priceCurrency) => {
      const num = toNum(priceVal);
      if (num === null) return null;
      const currency = String(priceCurrency || '').trim().toUpperCase();
      const isCNY = currency === 'CNY' || (!priceCurrency && num >= 30000);
      return isCNY ? null : num;
    };

    const getCostCny = (priceVal, priceCurrency) => {
      const num = toNum(priceVal);
      if (num === null) return null;
      const currency = String(priceCurrency || '').trim().toUpperCase();
      const isCNY = currency === 'CNY' || (!priceCurrency && num >= 30000);
      return isCNY ? num : null;
    };

    let versionType = null;
    if (market) {
      versionType = Array.isArray(market) ? market[0] : market;
    }

    let finalModelId = null;
    if (matchedBrand && matchedModel) {
      const lookupKey = `${String(matchedBrand).toLowerCase()}|${String(matchedModel).toLowerCase()}`;
      finalModelId = modelMap.get(lookupKey) || row.model_id || row.modelId || null;
    } else {
      finalModelId = row.model_id || row.modelId || null;
    }

    return {
      model_id: finalModelId,
      brand: matchedBrand || null,
      model: matchedModel || null,
      trim_config: row.trimName || row.trimConfig || row.trim_config || null,
      manufacture_date: getManufactureDate(row),
      exterior_color: row.exteriorColor || row.exterior_color || null,
      interior_color: row.interiorColor || row.interior_color || null,
      stock_quantity: toNum(row.stockQuantity || row.stock_quantity),
      min_quantity: toNum(row.minQuantity || row.min_quantity),
      max_quantity: toNum(row.maxQuantity || row.max_quantity),
      lead_time: row.leadTime || row.lead_time || null,
      order_waiting_period: row.orderWaitingPeriod || row.order_waiting_period || (row.leadTimeText || null),
      order_wait_days: waitDays,
      steering_setup: steering,
      version_type: versionType,
      status_vehicle: row.statusVehicle || row.status_vehicle || null,
      official_suggested_price_cny: toNum(row.officialPrice || row.officialPriceCny || row.official_suggested_price_cny),
      official_suggested_price_usd: toNum(row.officialPriceUsd || row.official_suggested_price_usd),
      cost_exw_cny: toNum(row.costExwCny || row.cost_exw_cny) ?? getCostCny(row.priceExw, row.priceExwCurrency),
      cost_exw_usd: getCostUsd(row.priceExw || row.costExwUsd || row.cost_exw_usd, row.priceExwCurrency),
      cost_fob_cny: toNum(row.costFobCny || row.cost_fob_cny) ?? getCostCny(row.priceFob, row.priceFobCurrency),
      cost_fob_usd: getCostUsd(row.priceFob || row.costFobUsd || row.cost_fob_usd, row.priceFobCurrency),
      cost_fca_cny: toNum(row.costFcaCny || row.cost_fca_cny) ?? getCostCny(row.priceFca, row.priceFcaCurrency),
      cost_fca_usd: getCostUsd(row.priceFca || row.costFcaUsd || row.cost_fca_usd, row.priceFcaCurrency),
      cost_cif_cny: toNum(row.costCifCny || row.cost_cif_cny) ?? getCostCny(row.priceCif, row.priceCifCurrency),
      cost_cif_usd: getCostUsd(row.priceCif || row.costCifUsd || row.cost_cif_usd, row.priceCifCurrency),
      location: row.location || null,
      supplier: row.supplierName || row.supplier || null,
      notes: row.notes || null,
      source_file: row._source_file || row.source_file || null,
      content_hash: row._content_hash || row.content_hash || null,
      market_region: market
    };
  });
}

// ──────────────────────────────────────────────
// Step 7: 保存输出
// ──────────────────────────────────────────────
function saveFinalOutput(candidates) {
  console.log('\n═══════════════════════════════════════');
  console.log('💾 Step 7: 保存最终结果');
  console.log('═══════════════════════════════════════\n');

  const finalDir = path.join(OUTPUT_DIR, 'final');
  fs.mkdirSync(finalDir, { recursive: true });

  const outputPath = path.join(finalDir, `candidates_${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(candidates, null, 2), 'utf-8');
  console.log(`   📄 JSON: ${outputPath} (${candidates.length} rows)`);

  const csvPath = path.join(finalDir, `candidates_${new Date().toISOString().slice(0, 10)}.csv`);
  const csvFields = [
    'brand', 'model', 'trim_config', 'manufacture_date', 'exterior_color', 'interior_color',
    'stock_quantity', 'supplier', 'location', 'notes',
    'official_suggested_price_cny', 'cost_exw_cny', 'cost_exw_usd', 'cost_fob_cny',
    'cost_fob_usd', 'cost_fca_cny', 'cost_fca_usd', 'cost_cif_cny', 'cost_cif_usd',
    'min_quantity', 'max_quantity',
    'steering_setup', 'market_region', 'order_wait_days'
  ];
  const csvHeader = csvFields.join(',');
  const csvRows = candidates.map(c => {
    return csvFields.map(f => {
      let v = c[f] ?? '';
      if (Array.isArray(v)) {
        v = v.join(', ');
      }
      const s = String(v).replace(/"/g, '""');
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
    }).join(',');
  });
  fs.writeFileSync(csvPath, [csvHeader, ...csvRows].join('\n'), 'utf-8');
  console.log(`   📊 CSV: ${csvPath}`);

  return { jsonPath: outputPath, csvPath, count: candidates.length };
}

// ──────────────────────────────────────────────
// Step 8: 飞书同步
// ──────────────────────────────────────────────
function recordToFeishuFields(record) {
  const fields = {};
  const allowedBitableFields = [
    'model_id', 'brand', 'model', 'trim_config', 'manufacture_date', 'exterior_color', 'interior_color',
    'stock_quantity', 'supplier', 'location', 'notes', 'min_quantity', 'max_quantity',
    'official_suggested_price_cny', 'cost_fca_usd', 'cost_fob_usd', 'cost_exw_usd',
    'cost_cif_usd', 'steering_setup', 'order_wait_days'
  ];
  for (const key of allowedBitableFields) {
    if (record[key] !== null && record[key] !== undefined && record[key] !== '') {
      fields[key] = record[key];
    }
  }
  if (record.version_type) {
    fields.market_region = [record.version_type];
  } else if (record.market_region) {
    fields.market_region = Array.isArray(record.market_region) ? record.market_region : [record.market_region];
  }
  return fields;
}

async function fetchWithRetry(urlOrFn, options = {}, maxRetries = 3, initialDelayMs = 1000) {
  let opts = options;
  let retries = maxRetries;
  let delay = initialDelayMs;

  if (typeof options === 'number') {
    retries = options;
    opts = {};
    if (typeof maxRetries === 'number') {
      delay = maxRetries;
    }
  } else if (typeof options === 'object' && options !== null) {
    if (options.initialDelayMs !== undefined) {
      delay = options.initialDelayMs;
    }
    if (options.maxRetries !== undefined) {
      retries = options.maxRetries;
    }
  }

  const maxAttempts = retries;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      let resp;
      if (typeof urlOrFn === 'function') {
        resp = await urlOrFn();
      } else {
        resp = await fetch(urlOrFn, opts);
      }

      if (resp && resp.status === undefined && resp.code !== undefined) {
        if (resp.code !== 0) {
          const code = resp.code;
          const msg = String(resp.msg || resp.message || '').toLowerCase();
          const isRateLimit = code === 99991400 || msg.includes('rate limit') || msg.includes('frequency') || msg.includes('too many') || msg.includes('throttled');
          const isTransientServerError = code >= 500000 || msg.includes('service unavailable') || msg.includes('internal error') || msg.includes('timeout');
          if (isRateLimit || isTransientServerError) {
            throw new Error(`Feishu API Error ${code}: ${resp.msg || 'Transient error'}`);
          }
        }
        return resp;
      }

      if (resp && resp.status !== undefined) {
        if (resp.status === 429 || resp.status >= 500) {
          throw new Error(`HTTP status ${resp.status}`);
        }
      }

      let data;
      if (resp && typeof resp.json === 'function') {
        const resClone = typeof resp.clone === 'function' ? resp.clone() : resp;
        data = await resClone.json();
      } else {
        data = resp;
      }

      if (data && typeof data === 'object' && data.code !== undefined && data.code !== 0) {
        const code = data.code;
        const msg = String(data.msg || data.message || '').toLowerCase();
        const isRateLimit = code === 99991400 || msg.includes('rate limit') || msg.includes('frequency') || msg.includes('too many') || msg.includes('throttled');
        const isTransientServerError = code >= 500000 || msg.includes('service unavailable') || msg.includes('internal error') || msg.includes('timeout');

        if (isRateLimit || isTransientServerError) {
          throw new Error(`Feishu API Error ${code}: ${data.msg || 'Transient error'}`);
        }
      }

      return data;
    } catch (err) {
      if (attempt === maxAttempts) {
        throw err;
      }
      console.warn(`⚠️  [Fetch Retry] Attempt ${attempt}/${maxAttempts} failed: ${err.message}. Retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
      delay *= 2;
    }
  }
}

async function syncToFeishu(candidates, dryRun = false) {
  if (dryRun) {
    console.log('\n   ⏭️  Dry run — skipping Feishu upload');
    return true;
  }

  console.log('\n═══════════════════════════════════════');
  console.log('🔄 Step 8: 飞书多维表格同步');
  console.log('═══════════════════════════════════════\n');

  const appId = process.env.FEISHU_APP_ID || process.env.LARK_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET || process.env.LARK_APP_SECRET;
  const appToken = process.env.FEISHU_BITABLE_APP_TOKEN;
  const tableId = process.env.FEISHU_BITABLE_TABLE_ID;

  if (!appId || !appSecret) {
    console.log('   ⚠️  飞书 App 未配置。请在 .env 中设置 FEISHU_APP_ID + FEISHU_APP_SECRET');
    return false;
  }
  if (!appToken || !tableId) {
    console.log('   ⚠️  飞书 Bitable 未配置。请设置 FEISHU_BITABLE_APP_TOKEN + FEISHU_BITABLE_TABLE_ID');
    return false;
  }

  let tokenData;
  try {
    tokenData = await fetchWithRetry('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    });
  } catch (err) {
    console.error(`   ❌ 飞书认证网络请求失败: ${err.message}`);
    return false;
  }

  if (!tokenData || tokenData.code !== 0) {
    console.error(`   ❌ 飞书认证失败: ${tokenData ? tokenData.msg : '无响应'}`);
    return false;
  }
  const accessToken = tokenData.tenant_access_token;
  console.log('   ✅ 飞书认证成功');

  const batchSize = 100;
  let uploaded = 0;
  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    const records = batch.map(c => ({ fields: recordToFeishuFields(c) }));

    const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_create`;
    let data;
    try {
      data = await fetchWithRetry(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ records }),
      });
    } catch (err) {
      data = { code: -1, msg: err.message };
    }

    if (data && data.code === 0) {
      uploaded += batch.length;
      console.log(`   ✅ Batch ${Math.floor(i / batchSize) + 1}: ${batch.length} records uploaded`);
    } else {
      console.error(`   ❌ Batch ${Math.floor(i / batchSize) + 1} failed: ${data ? data.msg : 'Unknown error'}`);
    }
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\n   ✅ 飞书上传完成: ${uploaded}/${candidates.length} records`);
  return uploaded > 0;
}

// ──────────────────────────────────────────────
// 主入口
// ──────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);

  const getArgVal = (flag) => {
    const idx = args.indexOf(flag);
    return idx !== -1 && args[idx + 1] !== undefined ? args[idx + 1] : null;
  };

  let action = getArgVal('--action');
  if (!action) {
    if (args.length > 0 && !args[0].startsWith('-')) {
      action = args[0];
    } else {
      action = 'run';
    }
  }

  const dryRun = args.includes('--dry-run');
  const db = getDb();

  if (action === 'list') {
    const rows = db.prepare("SELECT id, brand, model, trim_config, manufacture_date, exterior_color, interior_color, stock_quantity, cost_exw_usd, status_vehicle, status, created_at FROM source_candidates WHERE status = 'pending'").all();
    if (rows.length === 0) {
      console.log('📋 No pending candidate records found in local_source.db.');
    } else {
      console.log(`📋 Pending candidate records (${rows.length}):`);
      console.table(rows);
    }
    db.close();
    return;
  }

  if (action === 'edit') {
    const id = getArgVal('--id');
    const key = getArgVal('--key');
    const val = getArgVal('--val');

    if (!id || !key || val === null) {
      console.error('❌ Usage: run_pipeline.js --action edit --id <id> --key <key> --val <val>');
      db.close();
      process.exit(1);
    }

    const allowedKeys = [
      'model_id', 'brand', 'model', 'trim_config', 'exterior_color', 'interior_color',
      'manufacture_date', 'stock_quantity', 'min_quantity', 'max_quantity', 'lead_time', 'order_waiting_period',
      'order_wait_days', 'steering_setup', 'version_type', 'status_vehicle',
      'official_suggested_price_cny', 'official_suggested_price_usd',
      'cost_exw_cny', 'cost_exw_usd', 'cost_fob_cny', 'cost_fob_usd',
      'cost_fca_cny', 'cost_fca_usd', 'cost_cif_cny', 'cost_cif_usd',
      'location', 'supplier', 'notes', 'status'
    ];

    if (!allowedKeys.includes(key)) {
      console.error(`❌ Invalid column key: "${key}". Allowed keys: ${allowedKeys.join(', ')}`);
      db.close();
      process.exit(1);
    }

    const res = db.prepare(`UPDATE source_candidates SET ${key} = ? WHERE id = ?`).run(val, id);
    console.log(`✅ [SQLite] Updated record #${id}: ${key} = ${val} (affected rows: ${res.changes})`);
    db.close();
    return;
  }

  if (action === 'delete') {
    const id = getArgVal('--id');
    if (!id) {
      console.error('❌ Usage: run_pipeline.js --action delete --id <id>');
      db.close();
      process.exit(1);
    }

    const res = db.prepare('DELETE FROM source_candidates WHERE id = ?').run(id);
    console.log(`✅ [SQLite] Deleted record #${id} (affected rows: ${res.changes})`);
    db.close();
    return;
  }

  if (action === 'clean') {
    const res = db.prepare('DELETE FROM source_candidates').run();
    console.log(`✅ [SQLite] Cleaned ${res.changes} records from local_source.db.`);
    db.close();
    return;
  }

  if (action === 'sync') {
    const pendingRecords = db.prepare("SELECT * FROM source_candidates WHERE status = 'pending'").all();
    if (pendingRecords.length === 0) {
      console.log('📋 No pending records to sync in local_source.db.');
      db.close();
      return;
    }

    console.log(`🔄 Syncing ${pendingRecords.length} pending records to Feishu...`);
    const success = await syncToFeishu(pendingRecords, dryRun);
    if (success && !dryRun) {
      const ids = pendingRecords.map(r => r.id);
      markCandidatesSynced(db, ids);
    }
    db.close();
    return;
  }

  if (action === 'run') {
    const skipClassify = args.includes('--skip-classify');
    const skipOcr = args.includes('--skip-ocr');
    const forceOcr = args.includes('--force-ocr');
    let allowVisionFallback = false;

    console.log('╔══════════════════════════════════════════╗');
    console.log('║  EV Export Management — 全流水线        ║');
    console.log('║  MinerU → Gemini Text → SQLite           ║');
    console.log('╚══════════════════════════════════════════╝');
    console.log(`\n  Skip Classify: ${skipClassify}  |  Skip OCR: ${skipOcr}  |  Dry Run: ${dryRun}  |  Force OCR: ${forceOcr}\n`);

    const startTime = Date.now();

    // Step 0: Classify raw input files into input/classified/
    if (!skipClassify) {
      try {
        runClassification();
      } catch (err) {
        console.error(`❌ Input classification failed: ${err.message}`);
        db.close();
        process.exit(1);
      }
    }

    // Step 1: OCR
    let ocrSuccess = false;
    if (!skipOcr) {
      ocrSuccess = runOcr({ force: forceOcr });
      if (!ocrSuccess || hasRecognitionErrors()) {
        allowVisionFallback = await promptForVisionFallback(args);
      }
    }

        // Step 2: Excel
    let excelResults = [];
    try {
      excelResults = runExcelParsing(db, dryRun);
    } catch (err) {
      console.error(`❌ Excel parsing failed: ${err.message}`);
    }

    // Step 3: Extraction
    let aiCandidates = [];
    const aiConfig = validateAiConfig();
    if (!aiConfig.ok) {
      console.error(`❌ ${aiConfig.message}`);
      console.error('   已完成可运行的分类/专业识别步骤；请补齐 .env 后重新运行结构化抽取。');
    } else {
      try {
        aiCandidates = await runExtraction(ocrSuccess, db, dryRun, { allowVisionFallback });
      } catch (err) {
        console.error(`❌ AI extraction failed: ${err.message}`);
      }
    }

    // Step 4: Merge
    const allCandidates = mergeAllCandidates(excelResults, aiCandidates);

    if (allCandidates.length === 0) {
      console.log('\n⚠️  No candidates extracted. Check your input files, MinerU output, and AI API configuration.');
      db.close();
      process.exit(1);
    }

    // Step 5: Learning rules
    const corrected = applyLearningRules(allCandidates);

    // Step 6: Format to standard Schema
    const formatted = formatCandidatesForFeishu(corrected);

    // Step 7: Save output files
    const output = saveFinalOutput(formatted);

    // Step 8: Save to local SQLite staging DB (status = 'pending') and upload to Feishu
    if (dryRun) {
      console.log('\n   ⏭️  Dry run — skipping SQLite write and Feishu upload');
    } else {
      const stagedIds = saveCandidatesToDb(db, formatted);
      const syncSuccess = await syncToFeishu(formatted, false);
      if (syncSuccess) {
        markCandidatesSynced(db, stagedIds);
      } else {
        console.log('   ⚠️  Feishu upload failed or was not configured; records remain pending in local_source.db.');
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n╔══════════════════════════════════════════╗`);
    console.log(`║  ✅ Pipeline complete in ${elapsed}s`);
    console.log(`║  📊 ${output.count} candidates extracted`);
    console.log(`║  📄 ${output.jsonPath}`);
    console.log(`╚══════════════════════════════════════════╝\n`);

    db.close();
    return;
  }

  console.error(`❌ Unknown action: "${action}". Valid actions: run, list, edit, delete, sync, clean`);
  db.close();
  process.exit(1);
}

if (require.main === module) {
  main().catch(err => {
    console.error('\n💥 Pipeline failed:', err.message);
    process.exit(1);
  });
}

module.exports = {
  formatCandidatesForFeishu,
  recordToFeishuFields,
  normalizeDateValue,
  validateAiConfig,
  hasRecognizedFiles,
  hasRecognitionErrors,
  getDb,
  saveCandidatesToDb,
  markCandidatesSynced,
  syncToFeishu,
  fetchWithRetry
};
