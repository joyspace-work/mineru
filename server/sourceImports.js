import multer from 'multer'
import XLSX from 'xlsx'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import { execSync, execFileSync } from 'node:child_process'
import { loadPromptFromFeishu, refinePromptWithExperiences } from './promptRefiner.js'

function loadLocalEnvFile() {
  try {
    const envText = readFileSync(resolve(process.cwd(), '.env'), 'utf8')
    envText.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) return
      const separatorIndex = trimmed.indexOf('=')
      if (separatorIndex <= 0) return
      const key = trimmed.slice(0, separatorIndex).trim()
      const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '')
      if (!process.env[key]) process.env[key] = value
    })
  } catch {
    // Local .env is optional.
  }
}

loadLocalEnvFile()

const SOURCE_IMPORT_STATUSES = {
  imported: 'imported',
  parsing: 'parsing',
  needsReview: 'needs_review',
  reviewed: 'reviewed',
  exported: 'exported',
}

const REVIEW_STATUS = {
  pending: 'pending_review',
  approved: 'approved',
  needsReview: 'needs_review',
  rejected: 'rejected',
}

const CHANGE_STATUS = {
  new: 'new',
  unchanged: 'unchanged',
  changed: 'changed',
  missing: 'missing_from_latest_snapshot',
}

const STANDARD_FIELDS = [
  'brand',
  'modelName',
  'year',
  'trimName',
  'exteriorColor',
  'interiorColor',
  'stockQuantity',
  'supplierPrice',
  'currency',
  'tradeTerm',
  'priceExw',
  'priceFca',
  'priceFob',
  'officialPrice',
  'location',
  'preorderMinDays',
  'preorderMaxDays',
  'canPreorder',
  'notes',
]

const DEFAULT_HEADER_ALIASES = [
  ['品牌', 'brand'],
  ['brand', 'brand'],
  ['厂牌', 'brand'],
  ['车系', 'modelName'],
  ['车型', 'modelName'],
  ['车型名称', 'modelName'],
  ['车辆名称', 'modelName'],
  ['model', 'modelName'],
  ['config', 'modelName'],
  ['配置', 'trimName'],
  ['版本', 'trimName'],
  ['车型版本', 'trimName'],
  ['款型', 'year'],
  ['年款', 'year'],
  ['年份', 'year'],
  ['外观', 'exteriorColor'],
  ['外饰', 'exteriorColor'],
  ['外观颜色', 'exteriorColor'],
  ['外饰颜色', 'exteriorColor'],
  ['车身颜色', 'exteriorColor'],
  ['内饰', 'interiorColor'],
  ['内饰颜色', 'interiorColor'],
  ['数量', 'stockQuantity'],
  ['库存', 'stockQuantity'],
  ['库存数量', 'stockQuantity'],
  ['合计', 'stockQuantity'],
  ['现车', 'stockQuantity'],
  ['price', 'supplierPrice'],
  ['价格', 'supplierPrice'],
  ['报价', 'supplierPrice'],
  ['出口价', 'supplierPrice'],
  ['exwusd', 'supplierPrice'],
  ['exw-usd', 'supplierPrice'],
  ['exw usd', 'supplierPrice'],
  ['fca', 'supplierPrice'],
  ['fca价格', 'priceFca'],
  ['fca价', 'priceFca'],
  ['fca报价', 'priceFca'],
  ['fca usd', 'priceFca'],
  ['fca-usd', 'priceFca'],
  ['fob', 'supplierPrice'],
  ['fob价格', 'priceFob'],
  ['fob价', 'priceFob'],
  ['fob报价', 'priceFob'],
  ['不含税fob', 'supplierPrice'],
  ['不含税fobrmb', 'supplierPrice'],
  ['exw价格', 'priceExw'],
  ['exw价', 'priceExw'],
  ['出厂价', 'priceExw'],
  ['厂家价', 'priceExw'],
  ['销售价', 'supplierPrice'],
  ['指导价', 'officialPrice'],
  ['官方指导价', 'officialPrice'],
  ['国内指导价', 'officialPrice'],
  ['msrp', 'officialPrice'],
  ['币种', 'currency'],
  ['currency', 'currency'],
  ['贸易条款', 'tradeTerm'],
  ['条款', 'tradeTerm'],
  ['term', 'tradeTerm'],
  ['库存地', 'location'],
  ['地点', 'location'],
  ['仓库', 'location'],
  ['location', 'location'],
  ['预订周期', 'preorderMaxDays'],
  ['交期', 'preorderMaxDays'],
  ['排产周期', 'preorderMaxDays'],
  ['备注', 'notes'],
  ['remark', 'notes'],
  ['remarks', 'notes'],
  ['notes', 'notes'],
  ['说明', 'notes'],
  ['vin码', 'notes'],
  ['vin', 'notes'],
]

const TERM_PATTERN = /\b(EXW|FCA|FOB|CIF|CNF)\b/i
const LOCATION_ALIASES = [
  ['霍尔果斯', ['霍尔果斯', 'Horgos', '果斯', '霍尔果']],
  ['南沙', ['南沙', 'Nansha']],
  ['上海', ['上海', 'Shanghai']],
  ['武汉', ['武汉', 'Wuhan']],
  ['湘潭', ['湘潭', 'Xiangtan']],
  ['山东', ['山东', 'Shandong']],
  ['重庆', ['重庆', 'Chongqing']],
]

function getAiProviderConfig() {
  try {
    if (typeof process.loadEnvFile === 'function') {
      process.loadEnvFile()
    }
  } catch (e) { }

  const provider = (
    process.env.AI_PROVIDER ||
    (process.env.GEMINI_API_KEY
      ? 'gemini'
      : process.env.OPENROUTER_API_KEY
        ? 'openrouter'
        : 'openai')
  ).toLowerCase()

  let config
  if (provider === 'gemini') {
    config = {
      provider,
      enabled: Boolean(process.env.GEMINI_API_KEY),
      apiKey: process.env.GEMINI_API_KEY || '',
      model: process.env.GEMINI_SOURCE_IMPORT_MODEL || process.env.AI_SOURCE_IMPORT_MODEL || 'gemini-2.5-flash',
      baseUrl: (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai').replace(/\/$/, ''),
    }
  } else if (provider === 'openrouter') {
    config = {
      provider,
      enabled: Boolean(process.env.OPENROUTER_API_KEY),
      apiKey: process.env.OPENROUTER_API_KEY || '',
      model: process.env.OPENROUTER_SOURCE_IMPORT_MODEL || process.env.AI_SOURCE_IMPORT_MODEL || 'openrouter/free',
      baseUrl: (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, ''),
    }
  } else {
    config = {
      provider: 'openai',
      enabled: Boolean(process.env.OPENAI_API_KEY),
      apiKey: process.env.OPENAI_API_KEY || '',
      model: process.env.OPENAI_SOURCE_IMPORT_MODEL || process.env.AI_SOURCE_IMPORT_MODEL || 'gpt-4.1-mini',
      baseUrl: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    }
  }

  process.stderr.write('[AI Config] provider=' + config.provider + ' baseUrl=' + config.baseUrl + ' model=' + config.model + ' enabled=' + config.enabled + '\n')
  return config
}

const AI_SUPPORTED_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])

function getAiImportStatus() {
  const config = getAiProviderConfig()
  return {
    enabled: config.enabled,
    provider: config.provider,
    model: config.model,
    supportsImages: true,
    supportsText: true,
    supportedFileTypes: ['xlsx', 'xls', 'txt', 'png', 'jpg', 'jpeg', 'webp'],
  }
}

function initSourceImportTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vehicle_source_import_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_name TEXT NOT NULL,
      snapshot_name TEXT NOT NULL DEFAULT '',
      snapshot_time TEXT NOT NULL,
      imported_by TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'imported',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS vehicle_source_suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_name TEXT NOT NULL UNIQUE,
      contact_name TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      wechat TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      channel_type TEXT NOT NULL DEFAULT 'unknown',
      notes TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      feishu_record_id TEXT
    );

    CREATE TABLE IF NOT EXISTS vehicle_source_import_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT '',
      file_size INTEGER NOT NULL DEFAULT 0,
      file_type TEXT NOT NULL DEFAULT '',
      parse_status TEXT NOT NULL DEFAULT 'pending',
      parser_notes TEXT NOT NULL DEFAULT '',
      raw_text TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (batch_id) REFERENCES vehicle_source_import_batches(id)
    );

    CREATE TABLE IF NOT EXISTS vehicle_source_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL,
      supplier_name TEXT NOT NULL,
      snapshot_time TEXT NOT NULL,
      version_no INTEGER NOT NULL DEFAULT 1,
      previous_snapshot_id INTEGER,
      status TEXT NOT NULL DEFAULT 'active',
      active_count INTEGER NOT NULL DEFAULT 0,
      new_count INTEGER NOT NULL DEFAULT 0,
      changed_count INTEGER NOT NULL DEFAULT 0,
      missing_count INTEGER NOT NULL DEFAULT 0,
      duplicate_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (batch_id) REFERENCES vehicle_source_import_batches(id)
    );

    CREATE TABLE IF NOT EXISTS vehicle_source_candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL,
      snapshot_id INTEGER NOT NULL,
      file_id INTEGER,
      source_sheet TEXT NOT NULL DEFAULT '',
      row_index INTEGER NOT NULL DEFAULT 0,
      fingerprint TEXT NOT NULL DEFAULT '',
      raw_fields TEXT NOT NULL DEFAULT '{}',
      raw_text TEXT NOT NULL DEFAULT '',
      brand TEXT NOT NULL DEFAULT '',
      model_name TEXT NOT NULL DEFAULT '',
      year TEXT NOT NULL DEFAULT '',
      trim_name TEXT NOT NULL DEFAULT '',
      exterior_color TEXT NOT NULL DEFAULT '',
      interior_color TEXT NOT NULL DEFAULT '',
      stock_quantity INTEGER NOT NULL DEFAULT 0,
      supplier_price REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT '',
      trade_term TEXT NOT NULL DEFAULT '',
      price_exw REAL,
      price_exw_currency TEXT,
      price_fca REAL,
      price_fca_currency TEXT,
      price_fob REAL,
      price_fob_currency TEXT,
      official_price TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      preorder_min_days INTEGER NOT NULL DEFAULT 0,
      preorder_max_days INTEGER NOT NULL DEFAULT 0,
      can_preorder INTEGER NOT NULL DEFAULT 1,
      notes TEXT NOT NULL DEFAULT '',
      profile_id INTEGER,
      match_status TEXT NOT NULL DEFAULT 'unmatched',
      match_confidence INTEGER NOT NULL DEFAULT 0,
      review_status TEXT NOT NULL DEFAULT 'pending_review',
      issue_tags TEXT NOT NULL DEFAULT '[]',
      change_status TEXT NOT NULL DEFAULT 'new',
      duplicate_score INTEGER NOT NULL DEFAULT 0,
      canonical_action TEXT NOT NULL DEFAULT 'count_inventory',
      reviewed_by TEXT NOT NULL DEFAULT '',
      reviewed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (batch_id) REFERENCES vehicle_source_import_batches(id),
      FOREIGN KEY (snapshot_id) REFERENCES vehicle_source_snapshots(id),
      FOREIGN KEY (file_id) REFERENCES vehicle_source_import_files(id)
    );

    CREATE TABLE IF NOT EXISTS vehicle_source_duplicate_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL,
      snapshot_id INTEGER NOT NULL,
      candidate_id INTEGER NOT NULL,
      matched_candidate_id INTEGER NOT NULL,
      score INTEGER NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'suggested',
      resolution TEXT NOT NULL DEFAULT '',
      confirmed_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (batch_id) REFERENCES vehicle_source_import_batches(id),
      FOREIGN KEY (snapshot_id) REFERENCES vehicle_source_snapshots(id)
    );

    CREATE TABLE IF NOT EXISTS vehicle_source_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_type TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'global',
      supplier_name TEXT NOT NULL DEFAULT '',
      source_key TEXT NOT NULL DEFAULT '',
      source_value TEXT NOT NULL DEFAULT '',
      target_field TEXT NOT NULL DEFAULT '',
      target_value TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '{}',
      confidence TEXT NOT NULL DEFAULT 'human_confirmed',
      status TEXT NOT NULL DEFAULT 'active',
      usage_count INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS vehicle_source_field_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_id INTEGER NOT NULL,
      batch_id INTEGER NOT NULL,
      supplier_name TEXT NOT NULL DEFAULT '',
      field_name TEXT NOT NULL,
      field_label TEXT NOT NULL DEFAULT '',
      before_value TEXT NOT NULL DEFAULT '',
      after_value TEXT NOT NULL DEFAULT '',
      change_type TEXT NOT NULL,
      source_presence TEXT NOT NULL DEFAULT '',
      suggestion_key TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (candidate_id) REFERENCES vehicle_source_candidates(id),
      FOREIGN KEY (batch_id) REFERENCES vehicle_source_import_batches(id)
    );

    CREATE TABLE IF NOT EXISTS vehicle_source_rule_suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      suggestion_key TEXT NOT NULL UNIQUE,
      rule_type TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'supplier',
      supplier_name TEXT NOT NULL DEFAULT '',
      source_key TEXT NOT NULL DEFAULT '',
      source_value TEXT NOT NULL DEFAULT '',
      target_field TEXT NOT NULL DEFAULT '',
      target_value TEXT NOT NULL DEFAULT '',
      change_type TEXT NOT NULL DEFAULT '',
      evidence_count INTEGER NOT NULL DEFAULT 0,
      confidence_score INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_by TEXT NOT NULL DEFAULT '',
      decided_by TEXT NOT NULL DEFAULT '',
      decided_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS vehicle_source_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      actor TEXT NOT NULL DEFAULT '',
      before_value TEXT NOT NULL DEFAULT '',
      after_value TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_vehicle_source_field_changes_candidate
      ON vehicle_source_field_changes(candidate_id);
    CREATE INDEX IF NOT EXISTS idx_vehicle_source_field_changes_pattern
      ON vehicle_source_field_changes(supplier_name, field_name, before_value, after_value, change_type);
    CREATE INDEX IF NOT EXISTS idx_vehicle_source_rule_suggestions_status
      ON vehicle_source_rule_suggestions(status, evidence_count);
  `)
}

function normalizeHeader(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[：:()（）【】\[\]_\-—\s/\\]+/g, '')
}

function normalizeText(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[：:()（）【】\[\]_\-—\s/\\,，.。]+/g, '')
}

function compactText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function asNumber(value) {
  const text = String(value ?? '').replace(/,/g, '').trim()
  const match = text.match(/-?\d+(?:\.\d+)?/)
  if (!match) return 0
  const number = Number(match[0])
  return Number.isFinite(number) ? number : 0
}

function normalizeCurrency(value, context = '') {
  const text = `${value ?? ''} ${context}`.toLowerCase()
  if (text.includes('usd') || text.includes('美金') || text.includes('美元') || text.includes('$')) return 'USD'
  if (text.includes('rmb') || text.includes('cny') || text.includes('人民币')) return 'CNY'
  const price = asNumber(value)
  if (price >= 50000) return 'CNY'
  if (price > 0) return 'USD'
  return ''
}

function inferTradeTerm(value) {
  const match = String(value ?? '').match(TERM_PATTERN)
  return match ? match[1].toUpperCase() : ''
}

function inferLocation(value) {
  const text = String(value ?? '')
  for (const [standard, aliases] of LOCATION_ALIASES) {
    if (aliases.some((alias) => text.toLowerCase().includes(String(alias).toLowerCase()))) {
      return standard
    }
  }
  return ''
}

function jsonParse(value, fallback) {
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function getRules(db, supplierName = '') {
  return db.prepare(`
    SELECT * FROM vehicle_source_rules
    WHERE status = 'active'
      AND (scope = 'global' OR supplier_name = ? OR supplier_name = '')
    ORDER BY scope DESC, id DESC
  `).all(supplierName)
}

function targetFieldForHeader(header, rules) {
  const normalized = normalizeHeader(header)
  if (!normalized) return ''
  const fieldRule = rules.find((rule) =>
    rule.rule_type === 'field_mapping' &&
    normalizeHeader(rule.source_value || rule.source_key) === normalized &&
    STANDARD_FIELDS.includes(rule.target_field)
  )
  if (fieldRule) return fieldRule.target_field

  const exactAlias = DEFAULT_HEADER_ALIASES.find(([source]) => normalizeHeader(source) === normalized)
  if (exactAlias) return exactAlias[1]
  const partialAlias = DEFAULT_HEADER_ALIASES.find(([source]) =>
    normalized.includes(normalizeHeader(source)) || normalizeHeader(source).includes(normalized)
  )
  return partialAlias?.[1] ?? ''
}

function rememberRuleHit(ruleHits, rule, field, fromValue, toValue) {
  if (!ruleHits || !rule || compactText(fromValue) === compactText(toValue)) return
  ruleHits.push({
    id: Number(rule.id),
    ruleType: rule.rule_type,
    field,
    fromValue: compactText(fromValue),
    toValue: compactText(toValue),
  })
}

function applyValueRules(value, field, rules, supplierName, ruleHits) {
  const original = compactText(value)
  if (!original) {
    const defaultRule = rules.find((entry) => {
      if (entry.rule_type !== 'supplier_default') return false
      if (entry.target_field && entry.target_field !== field) return false
      if (entry.scope === 'supplier' && entry.supplier_name && entry.supplier_name !== supplierName) return false
      return compactText(entry.target_value)
    })
    rememberRuleHit(ruleHits, defaultRule, field, '', defaultRule?.target_value)
    return defaultRule?.target_value || original
  }
  const normalized = normalizeText(original)
  const rule = rules.find((entry) => {
    if (!['value_alias', 'profile_alias'].includes(entry.rule_type)) return false
    if (entry.target_field && entry.target_field !== field) return false
    if (entry.scope === 'supplier' && entry.supplier_name && entry.supplier_name !== supplierName) return false
    return normalizeText(entry.source_value) === normalized
  })
  rememberRuleHit(ruleHits, rule, field, original, rule?.target_value)
  return rule?.target_value || original
}

function splitModelAndTrim(text) {
  const value = compactText(text)
  if (!value) return { modelName: '', trimName: '' }
  const yearMatch = value.match(/20\d{2}款?/)
  const versionSeparators = [' 智', ' 超', ' 领', ' 尊', ' 豪', ' Max', ' MAX', ' Plus', ' PLUS', ' Pro', ' PRO', ' Ultra', ' ULTRA']
  const separator = versionSeparators
    .map((item) => ({ item, index: value.indexOf(item) }))
    .filter((entry) => entry.index > 1)
    .sort((a, b) => a.index - b.index)[0]
  if (separator) {
    return {
      modelName: value.slice(0, separator.index).trim(),
      trimName: value.slice(separator.index).trim(),
      year: yearMatch?.[0]?.replace('款', '') ?? '',
    }
  }
  return { modelName: value, trimName: '', year: yearMatch?.[0]?.replace('款', '') ?? '' }
}

function findBestHeaderRow(rows, rules) {
  let best = { index: -1, score: 0, headerMap: new Map() }
  rows.slice(0, 20).forEach((row, index) => {
    const headerMap = new Map()
    let score = 0
    row.forEach((cell, columnIndex) => {
      const field = targetFieldForHeader(cell, rules)
      if (field) {
        headerMap.set(columnIndex, { field, header: compactText(cell) })
        score += ['modelName', 'supplierPrice', 'stockQuantity'].includes(field) ? 4 : 2
      }
    })
    if (score > best.score) best = { index, score, headerMap }
  })
  return best.score >= 8 ? best : { index: -1, score: 0, headerMap: new Map() }
}

function buildRawText(rawFields, fallbackText = '') {
  const pairs = Object.entries(rawFields)
    .filter(([, value]) => compactText(value))
    .map(([key, value]) => `${key}:${compactText(value)}`)
  return pairs.length > 0 ? pairs.join(' | ') : compactText(fallbackText)
}

function normalizeCandidate(rawInput, context) {
  const { rawFields = {}, rawText = '', supplierName, rules = {}, carry = {} } = rawInput
  const fullText = buildRawText(rawFields, rawText)
  const normalized = {}
  const ruleHits = []
  for (const field of STANDARD_FIELDS) normalized[field] = ''

  Object.entries(rawFields).forEach(([header, value]) => {
    const targetField = context.headerTargets?.get(header) || targetFieldForHeader(header, context.rules)
    if (!targetField || normalized[targetField]) return
    normalized[targetField] = compactText(value)
  })

  if (!normalized.modelName && carry.modelName) normalized.modelName = carry.modelName
  if (!normalized.trimName && carry.trimName) normalized.trimName = carry.trimName
  if (!normalized.brand && carry.brand) normalized.brand = carry.brand
  if (!normalized.year && carry.year) normalized.year = carry.year

  if (!normalized.modelName && fullText) {
    const split = splitModelAndTrim(fullText.split(/[|，,]/)[0])
    normalized.modelName = split.modelName
    normalized.trimName = normalized.trimName || split.trimName
    normalized.year = normalized.year || split.year
  }

  normalized.modelName = applyValueRules(normalized.modelName, 'modelName', rules, supplierName, ruleHits)
  normalized.trimName = applyValueRules(normalized.trimName, 'trimName', rules, supplierName, ruleHits)
  normalized.location = applyValueRules(normalized.location || inferLocation(fullText), 'location', rules, supplierName, ruleHits)
  normalized.tradeTerm = applyValueRules(normalized.tradeTerm || inferTradeTerm(fullText), 'tradeTerm', rules, supplierName, ruleHits).toUpperCase()
  normalized.exteriorColor = applyValueRules(normalized.exteriorColor, 'exteriorColor', rules, supplierName, ruleHits)
  normalized.interiorColor = applyValueRules(normalized.interiorColor, 'interiorColor', rules, supplierName, ruleHits)

  const textPrice = fullText.match(/(?:USD|美金|美元|\$|人民币|RMB|CNY)?\s*(\d{4,7}(?:\.\d+)?)/i)
  const supplierPrice = asNumber(normalized.supplierPrice) || asNumber(textPrice?.[0] ?? '')
  normalized.supplierPrice = supplierPrice
  normalized.currency = normalizeCurrency(normalized.currency || supplierPrice, `${fullText} ${normalized.supplierPrice}`)
  normalized.priceExw = asNumber(normalized.priceExw)
  normalized.priceFca = asNumber(normalized.priceFca)
  normalized.priceFob = asNumber(normalized.priceFob)
  normalized.priceExwCurrency = normalizeCurrency(normalized.priceExwCurrency || normalized.currency, `${fullText} ${normalized.priceExw}`)
  normalized.priceFcaCurrency = normalizeCurrency(normalized.priceFcaCurrency || normalized.currency, `${fullText} ${normalized.priceFca}`)
  normalized.priceFobCurrency = normalizeCurrency(normalized.priceFobCurrency || normalized.currency, `${fullText} ${normalized.priceFob}`)
  normalized.officialPrice = compactText(normalized.officialPrice)
  normalized.stockQuantity = Math.max(0, Math.floor(asNumber(normalized.stockQuantity)))
  normalized.preorderMinDays = Math.max(0, Math.floor(asNumber(normalized.preorderMinDays)))
  normalized.preorderMaxDays = Math.max(0, Math.floor(asNumber(normalized.preorderMaxDays)))
  normalized.canPreorder = normalized.preorderMaxDays > 0 || /预订|排产|订车|一个月|天/.test(fullText)
  normalized.notes = compactText([normalized.notes, fullText.length > 260 ? fullText.slice(0, 260) : ''].filter(Boolean).join('；'))

  if (!normalized.year) {
    const year = fullText.match(/20\d{2}/)
    normalized.year = year?.[0] ?? ''
  }

  normalized.appliedRuleIds = [...new Set(ruleHits.map((hit) => hit.id).filter(Boolean))]
  normalized.ruleHits = ruleHits
  return normalized
}

function extractResponseText(responseBody) {
  if (typeof responseBody?.output_text === 'string') return responseBody.output_text
  const chunks = []
  for (const output of responseBody?.output ?? []) {
    for (const content of output.content ?? []) {
      if (typeof content.text === 'string') chunks.push(content.text)
    }
  }
  return chunks.join('\n')
}

function normalizeAiContentText(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string') return part
      if (typeof part?.text === 'string') return part.text
      if (typeof part?.content === 'string') return part.content
      return ''
    }).filter(Boolean).join('\n')
  }
  if (typeof content?.text === 'string') return content.text
  return String(content ?? '')
}

function extractJsonObject(text) {
  if (text && typeof text === 'object') return text
  const value = String(text ?? '').trim()
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)
    if (fenced) return extractJsonObject(fenced[1])
    const start = value.indexOf('{')
    const end = value.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(value.slice(start, end + 1))
      } catch {
        return null
      }
    }
  }
  return null
}

function normalizeAiParseEnvelope(json) {
  if (!json) return null
  if (Array.isArray(json)) return { rawText: '', parserNotes: '', candidates: json }
  if (Array.isArray(json.candidates)) return json
  const candidateKeys = ['vehicles', 'items', 'rows', 'records', 'data', 'vehicleSources', 'sourceCandidates']
  for (const key of candidateKeys) {
    if (Array.isArray(json[key])) {
      return {
        rawText: json.rawText || json.originalText || '',
        parserNotes: json.parserNotes || `AI返回字段 ${key}，已自动转换为 candidates。`,
        candidates: json[key],
      }
    }
  }
  if (json.modelName || json.trimName || json.supplierPrice || json.stockQuantity || json.rawText) {
    return {
      rawText: json.rawText || '',
      parserNotes: 'AI返回单条车源对象，已自动转换为 candidates。',
      candidates: [json],
    }
  }
  return null
}

function sanitizeAiCandidate(candidate, index, context) {
  const rawFields = candidate.rawFields && typeof candidate.rawFields === 'object' ? candidate.rawFields : {}
  const rawText = compactText(candidate.rawText || Object.entries(rawFields).map(([key, value]) => `${key}:${value}`).join(' | '))
  const normalized = normalizeCandidate(
    {
      rawFields,
      rawText,
      supplierName: context.supplierName,
      rules: context.rules,
    },
    { rules: context.rules },
  )
  const confidence = Math.max(0, Math.min(100, Number(candidate.confidence) || 0))
  const notes = compactText(candidate.notes)
  return {
    ...normalized,
    brand: compactText(candidate.brand) || normalized.brand,
    modelName: compactText(candidate.modelName) || normalized.modelName,
    year: compactText(candidate.year) || normalized.year,
    trimName: compactText(candidate.trimName) || normalized.trimName,
    exteriorColor: compactText(candidate.exteriorColor) || normalized.exteriorColor,
    interiorColor: compactText(candidate.interiorColor) || normalized.interiorColor,
    stockQuantity: Math.max(0, Math.floor(Number(candidate.stockQuantity) || Number(normalized.stockQuantity) || 0)),
    supplierPrice: Number(candidate.supplierPrice) || Number(normalized.supplierPrice) || 0,
    currency: compactText(candidate.currency) || normalized.currency,
    tradeTerm: compactText(candidate.tradeTerm).toUpperCase() || normalized.tradeTerm,
    priceExw: Number(candidate.priceExw) || Number(normalized.priceExw) || null,
    priceExwCurrency: compactText(candidate.priceExwCurrency) || normalized.priceExwCurrency || normalized.currency || 'USD',
    priceFca: Number(candidate.priceFca) || Number(normalized.priceFca) || null,
    priceFcaCurrency: compactText(candidate.priceFcaCurrency) || normalized.priceFcaCurrency || normalized.currency || 'USD',
    priceFob: Number(candidate.priceFob) || Number(normalized.priceFob) || null,
    priceFobCurrency: compactText(candidate.priceFobCurrency) || normalized.priceFobCurrency || normalized.currency || 'USD',
    officialPrice: compactText(candidate.officialPrice) || normalized.officialPrice,
    location: compactText(candidate.location) || normalized.location,
    preorderMinDays: Math.max(0, Math.floor(Number(candidate.preorderMinDays) || Number(normalized.preorderMinDays) || 0)),
    preorderMaxDays: Math.max(0, Math.floor(Number(candidate.preorderMaxDays) || Number(normalized.preorderMaxDays) || 0)),
    canPreorder: Boolean(candidate.canPreorder ?? normalized.canPreorder),
    notes,
    rawFields: { ...rawFields, _parser: 'ai' },
    rawText,
    rowIndex: Number(candidate.rowIndex) || index + 1,
    sourceSheet: compactText(candidate.sourceSheet) || 'AI解析',
    issueTags: [
      'ai_parsed',
      ...(confidence && confidence < 75 ? ['ai_low_confidence'] : []),
      ...(Array.isArray(candidate.uncertainFields) && candidate.uncertainFields.length > 0 ? ['ai_uncertain_fields'] : []),
    ],
  }
}

function sourceImportJsonSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      rawText: { type: 'string' },
      parserNotes: { type: 'string' },
      candidates: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            brand: { type: 'string' },
            modelName: { type: 'string' },
            year: { type: 'string' },
            trimName: { type: 'string' },
            exteriorColor: { type: 'string' },
            interiorColor: { type: 'string' },
            stockQuantity: { type: 'number' },
            supplierPrice: { type: 'number' },
            currency: { type: 'string' },
            tradeTerm: { type: 'string' },
            priceExw: { type: 'number' },
            priceExwCurrency: { type: 'string' },
            priceFca: { type: 'number' },
            priceFcaCurrency: { type: 'string' },
            priceFob: { type: 'number' },
            priceFobCurrency: { type: 'string' },
            officialPrice: { type: 'string' },
            location: { type: 'string' },
            preorderMinDays: { type: 'number' },
            preorderMaxDays: { type: 'number' },
            canPreorder: { type: 'boolean' },
            notes: { type: 'string' },
            rawText: { type: 'string' },
            rawFields: { type: 'object', additionalProperties: { type: 'string' } },
            rowIndex: { type: 'number' },
            sourceSheet: { type: 'string' },
            confidence: { type: 'number' },
            uncertainFields: { type: 'array', items: { type: 'string' } },
          },
          required: [
            'brand', 'modelName', 'year', 'trimName', 'exteriorColor', 'interiorColor',
            'stockQuantity', 'supplierPrice', 'currency', 'tradeTerm',
            'priceExw', 'priceExwCurrency', 'priceFca', 'priceFcaCurrency',
            'priceFob', 'priceFobCurrency', 'officialPrice', 'location',
            'preorderMinDays', 'preorderMaxDays', 'canPreorder', 'notes', 'rawText',
            'rawFields', 'rowIndex', 'sourceSheet', 'confidence', 'uncertainFields',
          ],
        },
      },
    },
    required: ['rawText', 'parserNotes', 'candidates'],
  }
}

async function sourceImportPrompt({ text, context, mode }) {
  let template = ''
  try {
    template = await loadPromptFromFeishu()
  } catch (e) {
    console.error('[Prompt Load Error] Fallback to hardcoded prompt:', e.message)
  }

  if (!template) {
    return [
      '你是车源导入解析助手。请把供应商发来的车源资料解析为严格 JSON。',
      '只输出一个 JSON 对象，不要输出解释文字。顶层必须包含 candidates 数组。',
      '顶层格式必须是：{"rawText":"","parserNotes":"","candidates":[...]}。',
      '字段必须使用：brand, modelName, year, trimName, exteriorColor, interiorColor, stockQuantity, priceExw, priceExwCurrency, priceFca, priceFcaCurrency, priceFob, priceFobCurrency, officialPrice, location, preorderMinDays, preorderMaxDays, canPreorder, notes, rawText, rawFields, confidence, uncertainFields。',
      '注意价格提取：priceExw 表示出厂价/EXW价格，priceFca 表示FCA价格，priceFob 表示港口价/FOB价格。分别提取并解析出它们的数字值及对应币种（如 CNY、USD 等，对应币种字段为 priceExwCurrency/priceFcaCurrency/priceFobCurrency）。officialPrice 表示官方/国内指导价，可以保留原文如“11.98万”。如果供应商同一种车型同时报了多个条款价格，请同时录入。如果没有提供某项价格，则填 null 或 0。',
      '如果供应商把多个信息写在同一格或同一句话里，请按业务含义拆字段。',
      '如果价格口径不确定、车型库可能不匹配、颜色缩写不确定，请保留原文并把字段名写入 uncertainFields。',
      '不要编造看不到的信息；库存数量不明确时填 0；价格不明确时填 0。',
      `供应商：${context.supplierName}`,
      `解析模式：${mode}`,
      text ? `原始文本：\n${text.slice(0, 18000)}` : '',
    ].filter(Boolean).join('\n\n')
  }

  // Dynamically inject confirmed experiences as few-shot examples
  let experiencesBlock = ''
  try {
    const result = execFileSync('lark-cli', [
      'base', '+record-list', '--base-token', 'Xvdfbpk7cadLrnsVCFFcHbhOnCb',
      '--table-id', 'tblwWEYbWbV3WGlH',
      '--as', 'user', '--limit', '50', '--format', 'json',
    ], { encoding: 'utf8', timeout: 15000 })
    const parsed = JSON.parse(result)
    if (parsed.ok && parsed.data?.data?.length) {
      const fields = parsed.data.fields || []
      const records = parsed.data.data || []
      const examples = []
      for (let i = 0; i < records.length; i++) {
        const vals = {}
        if (Array.isArray(records[i])) fields.forEach((name, j) => { vals[name] = records[i][j] })
        const status = Array.isArray(vals['Status'] || vals['状态'] || '') ? (vals['Status'] || vals['状态'] || '')[0] : (vals['Status'] || vals['状态'] || '')
        if (status !== 'confirmed' && status !== '已确认') continue
        const field = vals['Field'] || vals['字段'] || ''
        const original = vals['Original Value'] || vals['原始值'] || ''
        const corrected = vals['Corrected Value'] || vals['修正值'] || ''
        const feedback = vals['用户反馈'] || vals['User Feedback'] || ''
        const rawText = vals['原始识别内容'] || vals['Original Raw Text'] || ''
        const beforeForm = vals['解析前表单'] || vals['Before Form'] || ''
        const afterForm = vals['解析后表单'] || vals['After Form'] || ''
        if (!field) continue
        // Build a rich experience entry with full context
        const lines = [`- 【字段 ${field}】`]
        if (original || corrected) {
          lines.push(`  原始提取值: "${original}" → 修正值: "${corrected}"`)
        }
        if (feedback) {
          lines.push(`  用户纠错原因: ${feedback}`)
        }
        if (rawText) {
          lines.push(`  原始数据源文本: "${rawText.slice(0, 300)}"`)
        }
        if (beforeForm && afterForm) {
          try {
            const before = JSON.parse(beforeForm)
            const after = JSON.parse(afterForm)
            // Only show business-relevant field changes, skip system/internal fields
            const businessKeys = ['brand','modelName','year','trimName','exteriorColor','interiorColor',
              'stockQuantity','priceExw','priceExwCurrency','priceFca','priceFcaCurrency','priceFob',
              'priceFobCurrency','officialPrice','location','deliveryTime','tradeTerm',
              'preorderMinDays','preorderMaxDays','canPreorder','notes','supplierPrice','currency']
            const changes = []
            for (const key of businessKeys) {
              const bv = before[key] !== undefined ? JSON.stringify(before[key]) : ''
              const av = after[key] !== undefined ? JSON.stringify(after[key]) : ''
              if (bv !== av && (bv || av)) {
                changes.push(`    ${key}: ${bv || '(空)'} → ${av || '(空)'}`)
              }
            }
            if (changes.length > 0) {
              lines.push(`  表单变更对比（仅业务字段）:`)
              lines.push(...changes.slice(0, 8))
            }
          } catch (_) { /* skip if not valid JSON */ }
        }
        examples.push(lines.join('\n'))
        if (examples.length >= 15) break
      }
      if (examples.length > 0) {
        experiencesBlock = '\n\n【⚠️ 经验参考 —— 以下是历史纠错记录，解析时必须严格遵守这些经验规则】\n' + examples.join('\n\n') + '\n'
      }
    }
  } catch (e) {
    console.error('[Source Import Prompt] Error loading experiences:', e.message)
  }

  console.log('[Source Import Prompt] experiencesBlock length:', experiencesBlock.length, experiencesBlock ? experiencesBlock.slice(0, 200) : '(empty)')
  let rendered = template
    .replace('{{experiences}}', experiencesBlock)
    .replace('{{supplierName}}', context.supplierName || '')
    .replace('{{mode}}', mode || '')
    .replace('{{rawText}}', text ? `原始文本：\n${text.slice(0, 18000)}` : '')

  return rendered
}

function buildImageDataUrl(filePath, file, extension) {
  const mimeType = file.mimetype || (extension === '.png' ? 'image/png' : 'image/jpeg')
  const base64 = readFileSync(filePath).toString('base64')
  return `data:${mimeType};base64,${base64}`
}

async function callOpenRouterSourceImportAi({ filePath, file, text, context, mode, config }) {
  const extension = extname(file.originalname).toLowerCase()
  const content = [{ type: 'text', text: await sourceImportPrompt({ text, context, mode }) }]
  if (AI_SUPPORTED_IMAGE_EXTENSIONS.has(extension)) {
    content.push({
      type: 'image_url',
      image_url: { url: buildImageDataUrl(filePath, file, extension) },
    })
  }
  const requestBody = {
    model: config.model,
    messages: [{ role: 'user', content }],
    max_tokens: 5000,
  }
  if (!config.model.startsWith('nvidia/nemotron-')) {
    requestBody.response_format = { type: 'json_object' }
  }
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 300000)
  let response
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://127.0.0.1:5173',
        'X-Title': 'EV Export Management Source Import',
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    })
  } catch (error) {
    clearTimeout(timeoutId)
    if (error.name === 'AbortError') throw new Error('OpenRouter AI 解析超时，请稍后重试或更换更稳定的视觉模型')
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(body?.error?.message || `OpenRouter 解析失败：HTTP ${response.status}`)
  }
  const responseText = normalizeAiContentText(body?.choices?.[0]?.message?.content)
  return extractJsonObject(responseText) ?? {
    rawText: responseText,
    parserNotes: 'AI返回了非JSON文本，系统已按OCR文本继续拆字段。',
    candidates: parseTextContent(responseText, { ...context, sourceSheet: 'AI OCR文本' }).candidates,
  }
}

async function callOpenAiSourceImportAi({ filePath, file, text, context, mode, config }) {
  const extension = extname(file.originalname).toLowerCase()
  const content = [{ type: 'text', text: await sourceImportPrompt({ text, context, mode }) }]
  if (AI_SUPPORTED_IMAGE_EXTENSIONS.has(extension)) {
    content.push({
      type: 'image_url',
      image_url: { url: buildImageDataUrl(filePath, file, extension) },
    })
  }
  const requestBody = {
    model: config.model,
    messages: [{ role: 'user', content }],
  }
  if (!AI_SUPPORTED_IMAGE_EXTENSIONS.has(extension)) {
    requestBody.response_format = { type: 'json_object' }
  }
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 300000)
  let response
  try {
    process.stderr.write('[AI] Calling ' + config.model + '...\n')
    const startTime = Date.now()
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    })
    process.stderr.write('[AI] Response in ' + ((Date.now() - startTime) / 1000).toFixed(1) + 's\n')
  } catch (error) {
    clearTimeout(timeoutId)
    if (error.name === 'AbortError') throw new Error('AI 解析超时，请稍后重试或使用更小的图片')
    throw error
  }
  clearTimeout(timeoutId)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    process.stderr.write('[AI Error] ' + JSON.stringify(body).slice(0, 500) + '\n')
    throw new Error(body?.error?.message || `AI 解析失败：HTTP ${response.status}`)
  }
  const responseText = body?.choices?.[0]?.message?.content
  return extractJsonObject(responseText) ?? {
    rawText: responseText,
    parserNotes: 'AI返回了非JSON文本，系统已按OCR文本继续拆字段。',
    candidates: parseTextContent(responseText, { ...context, sourceSheet: 'AI OCR文本' }).candidates,
  }
}

async function callGeminiSourceImportAi({ filePath, file, text, context, mode, config }) {
  const extension = extname(file.originalname).toLowerCase()
  const parts = [{ text: await sourceImportPrompt({ text, context, mode }) }]

  if (AI_SUPPORTED_IMAGE_EXTENSIONS.has(extension)) {
    const base64Data = readFileSync(filePath).toString('base64')
    const mimeType = file.mimetype || (extension === '.png' ? 'image/png' : 'image/jpeg')
    parts.push({
      inlineData: {
        mimeType: mimeType,
        data: base64Data,
      },
    })
  }

  const requestBody = {
    contents: [{ parts }],
    generationConfig: {
      responseMimeType: 'application/json',
    },
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 180000)
  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    })
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Gemini AI 解析超时，请稍后重试')
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(body?.error?.message || `Gemini 解析失败：HTTP ${response.status}`)
  }
  const responseText = body.candidates?.[0]?.content?.parts?.[0]?.text
  if (!responseText) {
    throw new Error('Gemini API 未能返回文本解析内容')
  }
  return extractJsonObject(responseText) ?? {
    rawText: responseText,
    parserNotes: 'AI返回了非JSON文本，系统已按OCR文本继续拆字段。',
    candidates: parseTextContent(responseText, { ...context, sourceSheet: 'AI OCR文本' }).candidates,
  }
}

async function callSourceImportAi({ filePath, file, text, context, mode }) {
  const config = getAiProviderConfig()
  if (!config.enabled) throw new Error(`未配置 ${config.provider} API Key，无法启用 AI 解析`)

  let rawJson
  if (config.provider === 'gemini') {
    rawJson = await callGeminiSourceImportAi({ filePath, file, text, context, mode, config })
  } else if (config.provider === 'openrouter') {
    rawJson = await callOpenRouterSourceImportAi({ filePath, file, text, context, mode, config })
  } else {
    rawJson = await callOpenAiSourceImportAi({ filePath, file, text, context, mode, config })
  }

  const json = normalizeAiParseEnvelope(rawJson)
  if (!json || !Array.isArray(json.candidates)) {
    throw new Error('AI 返回格式无效，未得到候选车源数组')
  }
  return {
    rawText: compactText(json.rawText || text || ''),
    parserNotes: compactText(json.parserNotes || ''),
    candidates: json.candidates
      .map((candidate, index) => sanitizeAiCandidate(candidate, index, context))
      .filter(candidateHasBusinessSignal),
  }
}

function candidateHasBusinessSignal(candidate) {
  return Boolean(
    candidate.modelName ||
    candidate.trimName ||
    candidate.supplierPrice > 0 ||
    candidate.stockQuantity > 0 ||
    candidate.exteriorColor ||
    candidate.interiorColor,
  )
}

function candidateLooksLikeHeader(candidate) {
  const text = normalizeText([
    candidate.rawText,
    candidate.modelName,
    candidate.trimName,
    candidate.exteriorColor,
    candidate.interiorColor,
  ].join(' '))
  const headerSignals = ['车型', '配置', '外观', '内饰', '数量', '价格', '指导价', '销售方式', '出口价']
  const signalCount = headerSignals.filter((signal) => text.includes(normalizeText(signal))).length
  return signalCount >= 3 && !candidate.stockQuantity && !candidate.supplierPrice
}

function candidateFingerprint(candidate) {
  return [
    candidate.modelName,
    candidate.year,
    candidate.trimName,
    candidate.exteriorColor,
    candidate.interiorColor,
    candidate.location,
    candidate.tradeTerm,
  ].map(normalizeText).join('|')
}

function stringSimilarity(a, b) {
  const left = normalizeText(a)
  const right = normalizeText(b)
  if (!left || !right) return 0
  if (left === right) return 1
  if (left.includes(right) || right.includes(left)) return 0.85
  const leftSet = new Set([...left])
  const rightSet = new Set([...right])
  const intersection = [...leftSet].filter((item) => rightSet.has(item)).length
  const union = new Set([...leftSet, ...rightSet]).size
  return union === 0 ? 0 : intersection / union
}

function findProfileMatch(db, candidate, rules, supplierName) {
  const aliasRule = rules.find((rule) =>
    rule.rule_type === 'profile_alias' &&
    normalizeText(rule.source_value) === normalizeText(candidate.modelName) &&
    (rule.scope !== 'supplier' || !rule.supplier_name || rule.supplier_name === supplierName)
  )
  if (aliasRule) {
    const metadata = jsonParse(aliasRule.metadata, {})
    if (metadata.profileId) {
      return {
        profileId: Number(metadata.profileId),
        matchStatus: 'matched',
        matchConfidence: 100,
      }
    }
  }
  const profileTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='vehicle_profiles'").get()
  if (!profileTableExists) return { profileId: null, matchStatus: 'no_profiles', matchConfidence: 0 }
  const profiles = db.prepare('SELECT id, brand, model, year, trim FROM vehicle_profiles').all()
  let best = { profileId: null, score: 0 }
  const sourceModel = `${candidate.brand} ${candidate.modelName}`
  const sourceTrim = `${candidate.year} ${candidate.trimName}`
  for (const profile of profiles) {
    let score = 0
    const profileModel = `${profile.brand} ${profile.model}`
    const modelSimilarity = stringSimilarity(sourceModel, profileModel)
    const trimSimilarity = stringSimilarity(sourceTrim, `${profile.year} ${profile.trim}`)
    score += modelSimilarity * 58
    score += trimSimilarity * 34
    if (candidate.year && String(profile.year).includes(candidate.year)) score += 8
    if (score > best.score) best = { profileId: Number(profile.id), score: Math.round(score) }
  }
  if (best.score >= 82) {
    return { profileId: best.profileId, matchStatus: 'matched', matchConfidence: best.score }
  }
  if (best.score >= 55) {
    return { profileId: best.profileId, matchStatus: 'needs_confirmation', matchConfidence: best.score }
  }
  return { profileId: null, matchStatus: 'unmatched', matchConfidence: best.score }
}

function issueTagsFor(candidate, match) {
  const tags = []
  if (!candidate.modelName) tags.push('missing_model')
  if (!candidate.trimName) tags.push('missing_trim')
  if (!candidate.supplierPrice && !candidate.priceExw && !candidate.priceFca && !candidate.priceFob) tags.push('missing_price')
  if (!candidate.stockQuantity) tags.push('missing_stock')
  if (!candidate.currency && !candidate.priceExwCurrency && !candidate.priceFcaCurrency && !candidate.priceFobCurrency) tags.push('missing_currency')
  if (!candidate.tradeTerm) tags.push('missing_trade_term')
  if (!candidate.location) tags.push('missing_location')
  if (match.matchStatus !== 'matched') tags.push(match.matchStatus === 'needs_confirmation' ? 'profile_needs_confirmation' : 'unmatched_profile')
  return tags
}

function serializeCandidate(row) {
  return {
    id: Number(row.id),
    batchId: Number(row.batch_id),
    snapshotId: Number(row.snapshot_id),
    fileId: row.file_id === null ? null : Number(row.file_id),
    sourceSheet: row.source_sheet,
    rowIndex: Number(row.row_index),
    fingerprint: row.fingerprint,
    rawFields: jsonParse(row.raw_fields, {}),
    rawText: row.raw_text,
    brand: row.brand,
    modelName: row.model_name,
    year: row.year,
    trimName: row.trim_name,
    exteriorColor: row.exterior_color,
    interiorColor: row.interior_color,
    stockQuantity: Number(row.stock_quantity),
    supplierPrice: Number(row.supplier_price),
    currency: row.currency,
    tradeTerm: row.trade_term,
    priceExw: row.price_exw ? Number(row.price_exw) : null,
    priceExwCurrency: row.price_exw_currency,
    priceFca: row.price_fca ? Number(row.price_fca) : null,
    priceFcaCurrency: row.price_fca_currency,
    priceFob: row.price_fob ? Number(row.price_fob) : null,
    priceFobCurrency: row.price_fob_currency,
    officialPrice: row.official_price,
    location: row.location,
    preorderMinDays: Number(row.preorder_min_days),
    preorderMaxDays: Number(row.preorder_max_days),
    canPreorder: Boolean(row.can_preorder),
    notes: row.notes,
    profileId: row.profile_id === null ? null : Number(row.profile_id),
    matchStatus: row.match_status,
    matchConfidence: Number(row.match_confidence),
    reviewStatus: row.review_status,
    issueTags: jsonParse(row.issue_tags, []),
    changeStatus: row.change_status,
    duplicateScore: Number(row.duplicate_score),
    canonicalAction: row.canonical_action,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    feishuRecordId: row.feishu_record_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function serializeBatch(row, db) {
  const summary = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN review_status = 'approved' THEN 1 ELSE 0 END) AS approved,
      SUM(CASE WHEN review_status = 'needs_review' THEN 1 ELSE 0 END) AS needs_review,
      SUM(CASE WHEN issue_tags <> '[]' THEN 1 ELSE 0 END) AS with_issues,
      SUM(CASE WHEN change_status = 'missing_from_latest_snapshot' THEN 1 ELSE 0 END) AS missing
    FROM vehicle_source_candidates
    WHERE batch_id = ?
  `).get(row.id)
  return {
    id: Number(row.id),
    supplierName: row.supplier_name,
    snapshotName: row.snapshot_name,
    snapshotTime: row.snapshot_time,
    importedBy: row.imported_by,
    status: row.status,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    summary: {
      total: Number(summary.total ?? 0),
      approved: Number(summary.approved ?? 0),
      needsReview: Number(summary.needs_review ?? 0),
      withIssues: Number(summary.with_issues ?? 0),
      missing: Number(summary.missing ?? 0),
    },
  }
}

function serializeFile(row) {
  return {
    id: Number(row.id),
    batchId: Number(row.batch_id),
    originalName: row.original_name,
    storedName: row.stored_name,
    mimeType: row.mime_type,
    fileSize: Number(row.file_size),
    fileType: row.file_type,
    parseStatus: row.parse_status,
    parserNotes: row.parser_notes,
    rawText: row.raw_text,
    createdAt: row.created_at,
  }
}

function serializeDuplicate(row) {
  return {
    id: Number(row.id),
    batchId: Number(row.batch_id),
    snapshotId: Number(row.snapshot_id),
    candidateId: Number(row.candidate_id),
    matchedCandidateId: Number(row.matched_candidate_id),
    score: Number(row.score),
    reason: row.reason,
    status: row.status,
    resolution: row.resolution,
    confirmedBy: row.confirmed_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // Human-readable extended fields (resolved via JOIN on list query)
    candidateModel: row.candidate_model || null,
    candidatePrice: row.candidate_price != null ? Number(row.candidate_price) : null,
    candidateCurrency: row.candidate_currency || null,
    candidateSupplier: row.candidate_supplier || null,
    matchedModel: row.matched_model || null,
    matchedPrice: row.matched_price != null ? Number(row.matched_price) : null,
    matchedCurrency: row.matched_currency || null,
    matchedSupplier: row.matched_supplier || null,
  }
}

function serializeRule(row) {
  return {
    id: Number(row.id),
    ruleType: row.rule_type,
    scope: row.scope,
    supplierName: row.supplier_name,
    sourceKey: row.source_key,
    sourceValue: row.source_value,
    targetField: row.target_field,
    targetValue: row.target_value,
    metadata: jsonParse(row.metadata, {}),
    confidence: row.confidence,
    status: row.status,
    usageCount: Number(row.usage_count),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function serializeRuleSuggestion(row) {
  return {
    id: Number(row.id),
    suggestionKey: row.suggestion_key,
    ruleType: row.rule_type,
    scope: row.scope,
    supplierName: row.supplier_name,
    sourceKey: row.source_key,
    sourceValue: row.source_value,
    targetField: row.target_field,
    targetValue: row.target_value,
    changeType: row.change_type,
    evidenceCount: Number(row.evidence_count),
    confidenceScore: Number(row.confidence_score),
    status: row.status,
    metadata: jsonParse(row.metadata, {}),
    createdBy: row.created_by,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function serializeSupplier(row) {
  return {
    id: Number(row.id),
    supplierName: row.supplier_name,
    contactName: row.contact_name,
    phone: row.phone,
    wechat: row.wechat,
    location: row.location,
    channelType: row.channel_type,
    notes: row.notes,
    isActive: Boolean(row.is_active),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function normalizeSupplierInput(body) {
  const supplier = {
    supplierName: compactText(body?.supplierName ?? body?.supplier_name),
    contactName: compactText(body?.contactName ?? body?.contact_name),
    phone: compactText(body?.phone),
    wechat: compactText(body?.wechat),
    location: compactText(body?.location),
    channelType: compactText(body?.channelType ?? body?.channel_type) || 'unknown',
    notes: compactText(body?.notes),
    isActive: body?.isActive === undefined ? true : Boolean(body.isActive),
  }
  if (!supplier.supplierName) throw new Error('请填写供应商名称')
  return supplier
}

function ensureSupplier(db, supplierName, actor = '') {
  const normalizedName = compactText(supplierName)
  if (!normalizedName) return null
  const existing = db.prepare('SELECT * FROM vehicle_source_suppliers WHERE supplier_name = ?').get(normalizedName)
  if (existing) return existing
  const now = new Date().toISOString()
  const result = db.prepare(`
    INSERT INTO vehicle_source_suppliers (
      supplier_name, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?)
  `).run(normalizedName, actor, now, now)
  const created = db.prepare('SELECT * FROM vehicle_source_suppliers WHERE id = ?').get(result.lastInsertRowid)
  try { syncSupplierToFeishuBase(db, created.id) } catch (e) { /* sync best-effort */ }
  return created
}

const SNAPSHOT_RANGE_PATTERNS = [
  ['BYD', ['BYD', '比亚迪', '元PLUS', '元 PLUS', 'ATTO', '海狮', '海鸥', '宋PLUS', '宋 PLUS', '秦PLUS', '秦 PLUS', '唐', '汉']],
  ['长安', ['长安', 'Changan', '深蓝', 'Deepal', '阿维塔', 'Avatr', '启源', 'LUMIN', 'UNI-Z']],
  ['广汽', ['广汽', 'GAC', '传祺', 'GS8', 'GS4', 'M8', 'ES9', 'I60', '向往S7']],
  ['吉利', ['吉利', 'Geely', '远程', '银河', '星舰', '星耀', '牛仔', 'Cowboy', 'Okavango']],
  ['东风', ['东风', 'Dongfeng', '奕派', 'eπ', '纳米']],
  ['五菱', ['五菱', 'Wuling', '宏光', 'MINI', '星光']],
  ['福田', ['福田', 'Foton', '奥铃']],
  ['奇瑞', ['奇瑞', 'Chery']],
  ['捷途', ['捷途', 'Jetour']],
  ['零跑', ['零跑', 'Leapmotor', 'T03']],
]

function compactSupplierName(supplierName) {
  const compacted = compactText(supplierName)
    .replace(/有限责任公司|股份有限公司|商贸有限公司|贸易有限公司|汽车销售服务有限公司|新能源汽车|新能源|有限公司|集团|4S店/gi, '')
    .replace(/\s+/g, '')
  return compacted || compactText(supplierName)
}

function snapshotDateKey(snapshotTime) {
  const digits = String(snapshotTime ?? '').replace(/\D/g, '')
  if (digits.length >= 8) return digits.slice(0, 8)
  return new Date().toISOString().slice(0, 10).replace(/-/g, '')
}

function inferSnapshotRange(files, candidates) {
  const text = [
    ...files.map((file) => file.originalname ?? ''),
    ...candidates.flatMap((candidate) => [
      candidate.brand,
      candidate.modelName,
      candidate.trimName,
      candidate.rawText,
      Object.values(candidate.rawFields ?? {}).join(' '),
    ]),
  ].join(' ')
  const matches = SNAPSHOT_RANGE_PATTERNS
    .map(([label, patterns]) => ({
      label,
      score: patterns.reduce((sum, pattern) =>
        text.toLowerCase().includes(String(pattern).toLowerCase()) ? sum + 1 : sum,
        0),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
  if (matches.length === 0) return '综合车源'
  if (matches.length === 1 || matches[0].score >= matches[1].score + 2) return matches[0].label
  return '综合车源'
}

function buildSnapshotName({ supplierName, snapshotTime, sequence, files, candidates }) {
  const supplier = compactSupplierName(supplierName)
  const range = inferSnapshotRange(files, candidates)
  const date = snapshotDateKey(snapshotTime)
  const sequenceText = String(sequence).padStart(2, '0')
  return `${supplier}-${range}-车源-${date}-${sequenceText}`
}

function parseTxtFile(filePath, context) {
  const raw = readFileSync(filePath, 'utf8')
  return parseTextContent(raw, { ...context, sourceSheet: 'TXT' })
}

function parseTextContent(raw, context) {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const markdownRows = lines
    .filter((line) => line.includes('|'))
    .map((line) => line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => compactText(cell)))
    .filter((row) => row.length >= 3 && !row.every((cell) => /^-+$/.test(cell.replace(/\s/g, ''))))

  if (markdownRows.length >= 2) {
    const bestHeader = findBestHeaderRow(markdownRows, context.rules)
    if (bestHeader.index !== -1) {
      const headerLabels = markdownRows[bestHeader.index].map((header, index) =>
        compactText(header) || `Column ${index + 1}`,
      )
      const headerTargets = new Map()
      bestHeader.headerMap.forEach(({ field, header }) => headerTargets.set(header, field))
      const carry = {}
      const candidates = []
      markdownRows.slice(bestHeader.index + 1).forEach((row, offset) => {
        const rawFields = {}
        row.forEach((cell, index) => {
          const value = compactText(cell)
          if (!value) return
          rawFields[headerLabels[index]] = value
        })
        const rawText = buildRawText(rawFields, row.join(' '))
        if (!rawText) return
        const normalized = normalizeCandidate(
          { rawFields, rawText, supplierName: context.supplierName, rules: context.rules, carry },
          { rules: context.rules, headerTargets },
        )
        if (!normalized.modelName && carry.modelName) normalized.modelName = carry.modelName
        if (!normalized.trimName && carry.trimName) normalized.trimName = carry.trimName
        if (!candidateHasBusinessSignal(normalized)) return
        if (normalized.modelName) carry.modelName = normalized.modelName
        if (normalized.trimName) carry.trimName = normalized.trimName
        candidates.push({
          ...normalized,
          rawFields: { ...rawFields, _parser: 'ai_text_fallback' },
          rawText,
          rowIndex: offset + 1,
          sourceSheet: context.sourceSheet || 'AI OCR文本',
          issueTags: ['ai_parsed', 'ai_text_fallback'],
        })
      })
      if (candidates.length > 0) return { rawText: raw, candidates }
    }
  }

  return {
    rawText: raw,
    candidates: lines.map((line, index) => {
      const normalized = normalizeCandidate(
        { rawFields: {}, rawText: line, supplierName: context.supplierName, rules: context.rules },
        { rules: context.rules },
      )
      return {
        ...normalized,
        rawFields: {},
        rawText: line,
        rowIndex: index + 1,
        sourceSheet: context.sourceSheet || 'TXT',
        issueTags: context.sourceSheet === 'AI OCR文本' ? ['ai_parsed', 'ai_text_fallback'] : [],
      }
    }).filter(candidateHasBusinessSignal),
  }
}

function parseXlsxFile(filePath, context) {
  const workbook = XLSX.readFile(filePath, { cellDates: false, raw: false })
  const candidates = []
  const rawTextParts = []
  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: false })
    const bestHeader = findBestHeaderRow(rows, context.rules)
    const carry = {}
    if (bestHeader.index === -1) {
      rows.forEach((row, rowIndex) => {
        const text = compactText(row.join(' '))
        if (!text) return
        rawTextParts.push(text)
        const normalized = normalizeCandidate(
          { rawFields: {}, rawText: text, supplierName: context.supplierName, rules: context.rules, carry },
          { rules: context.rules },
        )
        if (candidateHasBusinessSignal(normalized)) {
          candidates.push({ ...normalized, rawFields: {}, rawText: text, rowIndex: rowIndex + 1, sourceSheet: sheetName })
        }
      })
      continue
    }

    const headerLabels = rows[bestHeader.index].map((header, index) =>
      compactText(header) || `Column ${index + 1}`,
    )

    // Build Markdown Table Headers
    const markdownTableRows = []
    markdownTableRows.push(`| ${headerLabels.join(' | ')} |`)
    markdownTableRows.push(`| ${headerLabels.map(() => '---').join(' | ')} |`)

    const headerTargets = new Map()
    bestHeader.headerMap.forEach(({ field, header }) => headerTargets.set(header, field))
    rows.slice(bestHeader.index + 1).forEach((row, offset) => {
      const rawFields = {}
      const markdownCells = []

      headerLabels.forEach((label, index) => {
        let value = compactText(row[index])
        // If cell is empty, and it is a typical merged field, carry it forward for the raw fields representation
        if (!value && ['车型', '指导价', '品牌', '年款', '配置', '车型名称', '型号', '型号名称'].some(name => label.includes(name))) {
          if (label.includes('指导价') && carry.officialPrice) {
            value = carry.officialPrice
          } else if (label.includes('品牌') && carry.brand) {
            value = carry.brand
          } else if (carry.modelName) {
            value = carry.modelName
          }
        }
        if (value) {
          rawFields[label] = value
        }
        markdownCells.push(value || '')
      })

      const rawText = buildRawText(rawFields, row.join(' '))
      if (!rawText) return

      markdownTableRows.push(`| ${markdownCells.map(val => String(val).replace(/\|/g, '\\|')).join(' | ')} |`)

      const normalized = normalizeCandidate(
        { rawFields, rawText, supplierName: context.supplierName, rules: context.rules, carry },
        { rules: context.rules, headerTargets },
      )

      if (!normalized.modelName && carry.modelName) normalized.modelName = carry.modelName
      if (!normalized.trimName && carry.trimName) normalized.trimName = carry.trimName
      if (!normalized.brand && carry.brand) normalized.brand = carry.brand
      if (!normalized.year && carry.year) normalized.year = carry.year

      if (!candidateHasBusinessSignal(normalized)) return

      // Update carry values based on successfully resolved candidate fields
      if (normalized.modelName) carry.modelName = normalized.modelName
      if (normalized.trimName) carry.trimName = normalized.trimName
      if (normalized.brand) carry.brand = normalized.brand
      if (normalized.year) carry.year = normalized.year
      if (normalized.officialPrice) carry.officialPrice = normalized.officialPrice

      candidates.push({
        ...normalized,
        rawFields,
        rawText,
        rowIndex: bestHeader.index + offset + 2,
        sourceSheet: sheetName,
      })
    })

    if (markdownTableRows.length > 2) {
      rawTextParts.push(`### Sheet: ${sheetName}\n` + markdownTableRows.join('\n'))
    }
  }
  return { rawText: rawTextParts.slice(0, 50).join('\n\n'), candidates }
}

function parseGenericAttachment(file) {
  return {
    rawText: '',
    candidates: [{
      brand: '',
      modelName: '',
      year: '',
      trimName: '',
      exteriorColor: '',
      interiorColor: '',
      stockQuantity: 0,
      supplierPrice: 0,
      currency: '',
      tradeTerm: '',
      location: '',
      preorderMinDays: 0,
      preorderMaxDays: 0,
      canPreorder: false,
      notes: `${file.originalname} 已作为原始附件保存，图片/PDF/PPT 的自动识别可在 AI/OCR 接入后启用。`,
      rawFields: {},
      rawText: '',
      rowIndex: 0,
      sourceSheet: '附件',
      attachmentOnly: true,
    }],
  }
}

async function parseFileWithOptionalAi({ file, storedPath, extension, context, aiMode }) {
  const traditional = ['.xlsx', '.xls'].includes(extension)
    ? parseXlsxFile(storedPath, context)
    : extension === '.txt'
      ? parseTxtFile(storedPath, context)
      : parseGenericAttachment(file)

  const shouldUseAi = aiMode === 'ai_assist' && getAiProviderConfig().enabled
  const canUseAiForFile = ['.xlsx', '.xls', '.txt'].includes(extension) || AI_SUPPORTED_IMAGE_EXTENSIONS.has(extension)
  if (!shouldUseAi || !canUseAiForFile) return { ...traditional, parserNotes: '' }

  try {
    const aiText = traditional.rawText || traditional.candidates.map((candidate) => candidate.rawText).filter(Boolean).join('\n')
    const aiParsed = await callSourceImportAi({
      filePath: storedPath,
      file,
      text: aiText,
      context,
      mode: ['.xlsx', '.xls', '.txt'].includes(extension) ? 'text_or_table_semantic_parse' : 'image_ocr_and_semantic_parse',
    })
    if (aiParsed.candidates.length > 0) {
      return {
        rawText: aiParsed.rawText || traditional.rawText,
        candidates: aiParsed.candidates,
        parserNotes: `AI 结构化识别 ${aiParsed.candidates.length} 条；传统规则识别 ${traditional.candidates.length} 条。${aiParsed.parserNotes}`,
      }
    }
    return {
      ...traditional,
      parserNotes: `AI 未识别到有效车源，已使用传统规则结果 ${traditional.candidates.length} 条。`,
    }
  } catch (error) {
    return {
      ...traditional,
      parserNotes: `AI 解析未完成，已使用传统规则结果 ${traditional.candidates.length} 条。原因：${error.message}`,
    }
  }

  process.stderr.write('[AI Config] provider=' + config.provider + ' baseUrl=' + config.baseUrl + ' model=' + config.model + ' enabled=' + config.enabled + '\n')
  return config
}

function withRuleHitNotes(parsed) {
  const hitCount = parsed.candidates.reduce((sum, candidate) => sum + (candidate.ruleHits?.length ?? 0), 0)
  if (hitCount <= 0) return parsed
  const notes = compactText(parsed.parserNotes || '')
  return {
    ...parsed,
    parserNotes: [notes, `本次应用历史规则 ${hitCount} 次。`].filter(Boolean).join(' '),
  }
}

function splitCandidateByColor(candidate) {
  const ext = String(candidate.exteriorColor || '').trim()
  const intr = String(candidate.interiorColor || '').trim()
  const qty = Math.max(0, Math.floor(Number(candidate.stockQuantity) || 0))

  // Try to parse quantity-prefixed color combos like "20白/灰+10灰/灰"
  const parsed = parseColorPairsWithQty(ext, intr)
  if (parsed.length <= 1) {
    // Fall back to simple color-only parsing
    const pairs = parseColorPairs(ext, intr)
    if (pairs.length <= 1) return [candidate]
    const splitQty = qty > 0 ? Math.floor(qty / pairs.length) : 0
    const remainder = qty > 0 ? qty % pairs.length : 0
    return pairs.map(([exterior, interior], index) => ({
      ...candidate, exteriorColor: exterior, interiorColor: interior || '',
      stockQuantity: splitQty + (index === 0 ? remainder : 0),
    }))
  }
  return parsed.map(p => ({ ...candidate, exteriorColor: p.exteriorColor, interiorColor: p.interiorColor, stockQuantity: p.stockQuantity }))
}

function parseColorPairsWithQty(exterior, interior) {
  // Pattern: "20白/灰+10灰/灰" or "20白+10灰"
  // Split by + to get individual combos
  const results = []
  const parts = (exterior || '').split(/[+]/).map(s => s.trim()).filter(Boolean)
  for (const part of parts) {
    // Extract leading number
    const numMatch = part.match(/^(\d+)\s*(.*)/)
    if (!numMatch) continue
    const qty = parseInt(numMatch[1], 10)
    const rest = numMatch[2].trim()
    // Split by / to get exterior/interior
    const sub = rest.split('/').map(s => s.trim()).filter(Boolean)
    const extColor = sub[0] || ''
    const intColor = sub[1] || ''
    results.push({ exteriorColor: extColor, interiorColor: intColor, stockQuantity: qty })
  }
  return results
}

function parseColorPairs(exterior, interior) {
  const comboParts = interior ? interior.split(/[,，、;；]/).map(s => s.trim()).filter(Boolean) : []
  const extParts = exterior ? exterior.split(/[,，、;；]/).map(s => s.trim()).filter(Boolean) : []
  if (comboParts.length > 1) return comboParts.map(part => { const sub = part.split('/'); return [extParts[0] || sub[0] || '', sub[1] || sub[0] || ''] })
  if (extParts.length > 1) return extParts.map(part => { const sub = part.split('/'); const interiorFromIntr = interior ? interior.split('/')[0] || interior : ''; return [sub[0] || '', interiorFromIntr] })
  if (exterior && interior) return [[exterior, interior]]
  const extSplit = exterior ? exterior.split('/').map(s => s.trim()).filter(Boolean) : []
  const intSplit = interior ? interior.split('/').map(s => s.trim()).filter(Boolean) : []
  if (extSplit.length === 2 && intSplit.length === 2) return [[extSplit[0], intSplit[0]], [extSplit[1], intSplit[1]]]
  return [[exterior || '', interior || '']]
}

function insertCandidate(db, candidate, context) {
  if (candidateLooksLikeHeader(candidate)) return null
  const now = new Date().toISOString()
  const match = candidate.attachmentOnly
    ? { profileId: null, matchStatus: 'attachment_only', matchConfidence: 0 }
    : findProfileMatch(db, candidate, context.rules, context.supplierName)
  const issueTags = candidate.attachmentOnly
    ? ['attachment_pending_parser']
    : [...new Set([...(candidate.issueTags ?? []), ...issueTagsFor(candidate, match)])]
  const reviewStatus = issueTags.length > 0 ? REVIEW_STATUS.needsReview : REVIEW_STATUS.pending
  const fingerprint = candidateFingerprint(candidate)

  let priceExw = candidate.priceExw ? Number(candidate.priceExw) : null
  let priceExwCurrency = candidate.priceExwCurrency || null
  let priceFca = candidate.priceFca ? Number(candidate.priceFca) : null
  let priceFcaCurrency = candidate.priceFcaCurrency || null
  let priceFob = candidate.priceFob ? Number(candidate.priceFob) : null
  let priceFobCurrency = candidate.priceFobCurrency || null

  if (!priceExw && !priceFca && !priceFob && Number(candidate.supplierPrice) > 0) {
    const term = String(candidate.tradeTerm || '').toUpperCase()
    if (term === 'FOB') {
      priceFob = Number(candidate.supplierPrice)
      priceFobCurrency = candidate.currency || 'USD'
    } else if (term === 'FCA') {
      priceFca = Number(candidate.supplierPrice)
      priceFcaCurrency = candidate.currency || 'USD'
    } else {
      priceExw = Number(candidate.supplierPrice)
      priceExwCurrency = candidate.currency || 'USD'
    }
  }

  const result = db.prepare(`
    INSERT INTO vehicle_source_candidates (
      batch_id, snapshot_id, file_id, source_sheet, row_index, fingerprint,
      raw_fields, raw_text, brand, model_name, year, trim_name,
      exterior_color, interior_color, stock_quantity, supplier_price, currency,
      trade_term, price_exw, price_exw_currency, price_fca, price_fca_currency,
      price_fob, price_fob_currency, official_price,
      location, preorder_min_days, preorder_max_days, can_preorder,
      notes, profile_id, match_status, match_confidence, review_status,
      issue_tags, change_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    context.batchId,
    context.snapshotId,
    context.fileId,
    candidate.sourceSheet,
    candidate.rowIndex,
    fingerprint,
    JSON.stringify(candidate.rawFields ?? {}),
    candidate.rawText ?? '',
    candidate.brand ?? '',
    candidate.modelName ?? '',
    candidate.year ?? '',
    candidate.trimName ?? '',
    candidate.exteriorColor ?? '',
    candidate.interiorColor ?? '',
    Math.max(0, Math.floor(Number(candidate.stockQuantity) || 0)),
    Number(candidate.supplierPrice) || 0,
    candidate.currency ?? '',
    candidate.tradeTerm ?? '',
    priceExw,
    priceExwCurrency,
    priceFca,
    priceFcaCurrency,
    priceFob,
    priceFobCurrency,
    candidate.officialPrice ?? '',
    candidate.location ?? '',
    Math.max(0, Math.floor(Number(candidate.preorderMinDays) || 0)),
    Math.max(0, Math.floor(Number(candidate.preorderMaxDays) || 0)),
    candidate.canPreorder ? 1 : 0,
    candidate.notes ?? '',
    match.profileId,
    match.matchStatus,
    match.matchConfidence,
    reviewStatus,
    JSON.stringify(issueTags),
    CHANGE_STATUS.new,
    now,
    now,
  )
  for (const ruleId of candidate.appliedRuleIds ?? []) {
    db.prepare('UPDATE vehicle_source_rules SET usage_count = usage_count + 1, updated_at = ? WHERE id = ?').run(now, ruleId)
  }
  return Number(result.lastInsertRowid)
}

function updateSnapshotDiff(db, snapshotId, previousSnapshotId) {
  const snapshot = db.prepare('SELECT batch_id FROM vehicle_source_snapshots WHERE id = ?').get(snapshotId)
  const currentRows = db.prepare('SELECT * FROM vehicle_source_candidates WHERE snapshot_id = ?').all(snapshotId)
  const currentByFingerprint = new Map(currentRows.map((row) => [row.fingerprint, row]))
  let changedCount = 0
  let unchangedCount = 0
  let missingCount = 0
  if (previousSnapshotId) {
    const previousRows = db.prepare(`
      SELECT * FROM vehicle_source_candidates
      WHERE snapshot_id = ? AND change_status <> ?
    `).all(previousSnapshotId, CHANGE_STATUS.missing)
    for (const current of currentRows) {
      const previous = previousRows.find((row) => row.fingerprint === current.fingerprint)
      if (!previous) continue
      const changed =
        Number(previous.stock_quantity) !== Number(current.stock_quantity) ||
        Number(previous.supplier_price) !== Number(current.supplier_price) ||
        previous.currency !== current.currency ||
        previous.trade_term !== current.trade_term ||
        Number(previous.price_exw) !== Number(current.price_exw) ||
        previous.price_exw_currency !== current.price_exw_currency ||
        Number(previous.price_fca) !== Number(current.price_fca) ||
        previous.price_fca_currency !== current.price_fca_currency ||
        Number(previous.price_fob) !== Number(current.price_fob) ||
        previous.price_fob_currency !== current.price_fob_currency ||
        previous.official_price !== current.official_price ||
        previous.location !== current.location
      db.prepare('UPDATE vehicle_source_candidates SET change_status = ? WHERE id = ?')
        .run(changed ? CHANGE_STATUS.changed : CHANGE_STATUS.unchanged, current.id)
      if (changed) changedCount += 1
      else unchangedCount += 1
    }
    for (const previous of previousRows) {
      if (currentByFingerprint.has(previous.fingerprint)) continue
      const now = new Date().toISOString()
      const issueTags = [...new Set([...jsonParse(previous.issue_tags, []), 'missing_from_latest_snapshot'])]
      db.prepare(`
        INSERT INTO vehicle_source_candidates (
          batch_id, snapshot_id, file_id, source_sheet, row_index, fingerprint,
          raw_fields, raw_text, brand, model_name, year, trim_name,
          exterior_color, interior_color, stock_quantity, supplier_price, currency,
          trade_term, price_exw, price_exw_currency, price_fca, price_fca_currency,
          price_fob, price_fob_currency, official_price,
          location, preorder_min_days, preorder_max_days, can_preorder,
          notes, profile_id, match_status, match_confidence, review_status,
          issue_tags, change_status, canonical_action, created_at, updated_at
        ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        snapshot.batch_id,
        snapshotId,
        '上版快照',
        previous.row_index,
        previous.fingerprint,
        previous.raw_fields,
        previous.raw_text,
        previous.brand,
        previous.model_name,
        previous.year,
        previous.trim_name,
        previous.exterior_color,
        previous.interior_color,
        previous.supplier_price,
        previous.currency,
        previous.trade_term,
        previous.price_exw,
        previous.price_exw_currency,
        previous.price_fca,
        previous.price_fca_currency,
        previous.price_fob,
        previous.price_fob_currency,
        previous.official_price,
        previous.location,
        previous.preorder_min_days,
        previous.preorder_max_days,
        previous.can_preorder,
        `上一个快照存在，本次未出现。${previous.notes}`,
        previous.profile_id,
        previous.match_status,
        previous.match_confidence,
        REVIEW_STATUS.needsReview,
        JSON.stringify(issueTags),
        CHANGE_STATUS.missing,
        'do_not_count',
        now,
        now,
      )
      missingCount += 1
    }
  }
  const newCount = Number(db.prepare(`
    SELECT COUNT(*) AS count FROM vehicle_source_candidates
    WHERE snapshot_id = ? AND change_status = ?
  `).get(snapshotId, CHANGE_STATUS.new).count)
  db.prepare(`
    UPDATE vehicle_source_snapshots
    SET active_count = ?, new_count = ?, changed_count = ?, missing_count = ?
    WHERE id = ?
  `).run(currentRows.length, newCount, changedCount, missingCount, snapshotId)
  return { changedCount, unchangedCount, missingCount, newCount }
}

function duplicateScore(left, right) {
  if (left.id === right.id) return 0
  let score = 0
  if (left.profile_id && right.profile_id && Number(left.profile_id) === Number(right.profile_id)) score += 38
  else score += Math.round(stringSimilarity(`${left.brand} ${left.model_name}`, `${right.brand} ${right.model_name}`) * 34)
  score += Math.round(stringSimilarity(left.trim_name, right.trim_name) * 20)
  if (left.exterior_color && right.exterior_color && normalizeText(left.exterior_color) === normalizeText(right.exterior_color)) score += 8
  if (left.interior_color && right.interior_color && normalizeText(left.interior_color) === normalizeText(right.interior_color)) score += 6
  if (left.location && right.location && normalizeText(left.location) === normalizeText(right.location)) score += 8
  if (Number(left.stock_quantity) > 0 && Number(left.stock_quantity) === Number(right.stock_quantity)) score += 10
  const leftPrice = Number(left.supplier_price)
  const rightPrice = Number(right.supplier_price)
  if (leftPrice > 0 && rightPrice > 0) {
    const diff = Math.abs(leftPrice - rightPrice)
    if (diff === 0) score += 10
    else if (diff <= 300) score += 8
    else if (diff <= 800) score += 5
  }
  return Math.min(score, 100)
}

function duplicateReason(left, right, score) {
  const reasons = []
  if (left.profile_id && right.profile_id && Number(left.profile_id) === Number(right.profile_id)) reasons.push('车型库匹配一致')
  if (left.exterior_color && normalizeText(left.exterior_color) === normalizeText(right.exterior_color)) reasons.push('外观色一致')
  if (left.location && normalizeText(left.location) === normalizeText(right.location)) reasons.push('库存地一致')
  if (Number(left.stock_quantity) > 0 && Number(left.stock_quantity) === Number(right.stock_quantity)) reasons.push('数量相同')
  const priceDiff = Math.abs(Number(left.supplier_price) - Number(right.supplier_price))
  if (priceDiff === 0) reasons.push('价格相同')
  else if (priceDiff <= 800) reasons.push(`价格差 ${priceDiff}`)
  return `相似度 ${score}：${reasons.join('、') || '车型/配置文本相似'}`
}

function updateDuplicateSuggestions(db, batchId, snapshotId, supplierName) {
  const currentRows = db.prepare(`
    SELECT * FROM vehicle_source_candidates
    WHERE snapshot_id = ? AND change_status <> ? AND model_name <> ''
  `).all(snapshotId, CHANGE_STATUS.missing)
  const comparisonRows = db.prepare(`
    SELECT c.*, b.supplier_name
    FROM vehicle_source_candidates c
    JOIN vehicle_source_import_batches b ON b.id = c.batch_id
    JOIN vehicle_source_snapshots s ON s.id = c.snapshot_id
    WHERE b.supplier_name <> ?
      AND c.change_status <> ?
      AND c.model_name <> ''
      AND s.id IN (
        SELECT MAX(s2.id)
        FROM vehicle_source_snapshots s2
        JOIN vehicle_source_import_batches b2 ON b2.id = s2.batch_id
        GROUP BY b2.supplier_name
      )
  `).all(supplierName, CHANGE_STATUS.missing)
  let duplicateCount = 0
  for (const current of currentRows) {
    for (const other of comparisonRows) {
      const score = duplicateScore(current, other)
      if (score < 72) continue
      duplicateCount += 1
      const now = new Date().toISOString()
      db.prepare(`
        INSERT INTO vehicle_source_duplicate_links (
          batch_id, snapshot_id, candidate_id, matched_candidate_id,
          score, reason, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(batchId, snapshotId, current.id, other.id, score, duplicateReason(current, other, score), now, now)
      const issueTags = jsonParse(current.issue_tags, [])
      if (!issueTags.includes('duplicate_risk')) {
        db.prepare(`
          UPDATE vehicle_source_candidates
          SET issue_tags = ?, duplicate_score = MAX(duplicate_score, ?), review_status = ?
          WHERE id = ?
        `).run(JSON.stringify([...issueTags, 'duplicate_risk']), score, REVIEW_STATUS.needsReview, current.id)
      } else {
        db.prepare('UPDATE vehicle_source_candidates SET duplicate_score = MAX(duplicate_score, ?) WHERE id = ?')
          .run(score, current.id)
      }
    }
  }
  db.prepare('UPDATE vehicle_source_snapshots SET duplicate_count = ? WHERE id = ?').run(duplicateCount, snapshotId)
  return duplicateCount
}

function createRule(db, input) {
  const now = new Date().toISOString()
  const existing = db.prepare(`
    SELECT id FROM vehicle_source_rules
    WHERE rule_type = ? AND scope = ? AND supplier_name = ?
      AND source_key = ? AND source_value = ? AND target_field = ?
      AND status = 'active'
  `).get(
    input.ruleType,
    input.scope,
    input.supplierName ?? '',
    input.sourceKey ?? '',
    input.sourceValue ?? '',
    input.targetField ?? '',
  )
  if (existing) {
    db.prepare(`
      UPDATE vehicle_source_rules
      SET target_value = ?, metadata = ?, updated_at = ?, usage_count = usage_count + 1
      WHERE id = ?
    `).run(input.targetValue ?? '', JSON.stringify(input.metadata ?? {}), now, existing.id)
    return Number(existing.id)
  }
  const result = db.prepare(`
    INSERT INTO vehicle_source_rules (
      rule_type, scope, supplier_name, source_key, source_value,
      target_field, target_value, metadata, confidence, created_by,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.ruleType,
    input.scope,
    input.supplierName ?? '',
    input.sourceKey ?? '',
    input.sourceValue ?? '',
    input.targetField ?? '',
    input.targetValue ?? '',
    JSON.stringify(input.metadata ?? {}),
    input.confidence ?? 'human_confirmed',
    input.createdBy ?? '',
    now,
    now,
  )
  return Number(result.lastInsertRowid)
}

const FIELD_CHANGE_FIELDS = [
  ['brand', 'brand', '品牌'],
  ['modelName', 'model_name', '车型'],
  ['year', 'year', '年款'],
  ['trimName', 'trim_name', '配置版本'],
  ['exteriorColor', 'exterior_color', '外观色'],
  ['interiorColor', 'interior_color', '内饰色'],
  ['stockQuantity', 'stock_quantity', '库存数量'],
  ['supplierPrice', 'supplier_price', '供应商价格'],
  ['currency', 'currency', '币种'],
  ['tradeTerm', 'trade_term', '贸易条款'],
  ['priceExw', 'price_exw', 'EXW价格'],
  ['priceFca', 'price_fca', 'FCA价格'],
  ['priceFob', 'price_fob', 'FOB价格'],
  ['officialPrice', 'official_price', '官方指导价参考'],
  ['location', 'location', '库存地'],
  ['preorderMinDays', 'preorder_min_days', '预订最短天数'],
  ['preorderMaxDays', 'preorder_max_days', '预订最长天数'],
  ['canPreorder', 'can_preorder', '是否可预订'],
  ['notes', 'notes', '备注'],
  ['profileId', 'profile_id', '车型库'],
  ['canonicalAction', 'canonical_action', '同源处理'],
  ['reviewStatus', 'review_status', '审核状态'],
]

const VALUE_ALIAS_SUGGESTION_FIELDS = new Set([
  'brand',
  'modelName',
  'trimName',
  'exteriorColor',
  'interiorColor',
  'location',
  'tradeTerm',
  'currency',
])

const SUPPLIER_DEFAULT_FIELDS = new Set(['location', 'tradeTerm', 'currency'])
const SUGGESTION_EVIDENCE_THRESHOLD = 2

function displayValue(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? '是' : '否'
  return compactText(value)
}

function valuesEqualForExperience(before, after) {
  return normalizeText(displayValue(before)) === normalizeText(displayValue(after))
}

function classifyFieldChange(fieldName, beforeValue, afterValue) {
  const before = displayValue(beforeValue)
  const after = displayValue(afterValue)
  if (fieldName === 'reviewStatus' && after === REVIEW_STATUS.rejected) return 'human_rejection'
  if (fieldName === 'profileId' && !before && after) return 'profile_match_correction'
  if (!before && after) return 'human_supplement'
  if (before && !after) return 'manual_clear'
  return 'recognition_correction'
}

function buildSuggestionInput(change) {
  if (change.changeType === 'profile_match_correction') {
    return {
      ruleType: 'profile_alias',
      sourceValue: change.previousModelName,
      targetField: 'profileId',
      targetValue: change.afterLabel || change.afterValue,
      metadata: { profileId: Number(change.afterRaw) || null },
    }
  }
  if (change.changeType === 'human_supplement') {
    if (!SUPPLIER_DEFAULT_FIELDS.has(change.fieldName) || !change.afterValue) return null
    return {
      ruleType: 'supplier_default',
      sourceValue: '',
      targetField: change.fieldName,
      targetValue: change.afterValue,
      metadata: { sourcePresence: change.sourcePresence },
    }
  }
  if (change.changeType !== 'recognition_correction') return null
  if (!VALUE_ALIAS_SUGGESTION_FIELDS.has(change.fieldName)) return null
  if (!change.beforeValue || !change.afterValue) return null
  return {
    ruleType: 'value_alias',
    sourceValue: change.beforeValue,
    targetField: change.fieldName,
    targetValue: change.afterValue,
    metadata: { sourcePresence: change.sourcePresence },
  }
}

function suggestionKeyFor({ supplierName, ruleType, sourceValue, targetField, targetValue }) {
  return [
    ruleType,
    normalizeText(supplierName),
    normalizeText(sourceValue),
    targetField,
    normalizeText(targetValue),
  ].join('|')
}

function upsertRuleSuggestion(db, change, actor) {
  const suggestion = buildSuggestionInput(change)
  if (!suggestion) return ''
  const supplierName = change.supplierName || ''
  const suggestionKey = suggestionKeyFor({ supplierName, ...suggestion })
  const now = new Date().toISOString()
  const metadata = {
    ...suggestion.metadata,
    fieldLabel: change.fieldLabel,
    lastCandidateId: change.candidateId,
    lastChangeId: change.id,
    changeType: change.changeType,
  }
  const existing = db.prepare('SELECT * FROM vehicle_source_rule_suggestions WHERE suggestion_key = ?').get(suggestionKey)
  if (existing) {
    const nextEvidenceCount = Number(existing.evidence_count) + 1
    const confidence = Math.min(95, Math.max(50, 45 + nextEvidenceCount * 12))
    db.prepare(`
      UPDATE vehicle_source_rule_suggestions
      SET evidence_count = ?, confidence_score = ?, metadata = ?, updated_at = ?
      WHERE id = ?
    `).run(
      nextEvidenceCount,
      confidence,
      JSON.stringify({ ...jsonParse(existing.metadata, {}), ...metadata }),
      now,
      existing.id,
    )
    return suggestionKey
  }
  const confidence = 55
  db.prepare(`
    INSERT INTO vehicle_source_rule_suggestions (
      suggestion_key, rule_type, scope, supplier_name, source_key, source_value,
      target_field, target_value, change_type, evidence_count, confidence_score,
      status, metadata, created_by, created_at, updated_at
    ) VALUES (?, ?, 'supplier', ?, ?, ?, ?, ?, ?, 1, ?, 'pending', ?, ?, ?, ?)
  `).run(
    suggestionKey,
    suggestion.ruleType,
    supplierName,
    change.fieldName,
    suggestion.sourceValue,
    suggestion.targetField,
    suggestion.targetValue,
    change.changeType,
    confidence,
    JSON.stringify(metadata),
    actor,
    now,
    now,
  )
  return suggestionKey
}

function profileLabel(db, profileId) {
  if (!profileId || !db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='vehicle_profiles'").get()) return String(profileId || '')
  const profile = db.prepare('SELECT id, brand, model, year, trim FROM vehicle_profiles WHERE id = ?').get(profileId)
  return profile ? `${profile.brand} ${profile.model} ${profile.year} ${profile.trim}` : String(profileId)
}

function recordFieldChanges(db, oldRow, updated, actor) {
  const batch = db.prepare('SELECT supplier_name FROM vehicle_source_import_batches WHERE id = ?').get(oldRow.batch_id)
  const supplierName = batch?.supplier_name ?? ''
  const now = new Date().toISOString()
  const insert = db.prepare(`
    INSERT INTO vehicle_source_field_changes (
      candidate_id, batch_id, supplier_name, field_name, field_label,
      before_value, after_value, change_type, source_presence,
      suggestion_key, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const changes = []
  for (const [apiField, column, label] of FIELD_CHANGE_FIELDS) {
    const beforeRaw = column === 'profile_id' ? oldRow[column] : oldRow[column]
    const afterRaw = updated[apiField]
    const beforeValue = column === 'profile_id'
      ? profileLabel(db, beforeRaw)
      : apiField === 'canPreorder'
        ? (oldRow.can_preorder ? '是' : '否')
        : displayValue(beforeRaw)
    const afterValue = column === 'profile_id'
      ? profileLabel(db, afterRaw)
      : apiField === 'canPreorder'
        ? (updated.canPreorder ? '是' : '否')
        : displayValue(afterRaw)
    if (valuesEqualForExperience(beforeValue, afterValue)) continue
    const changeType = classifyFieldChange(apiField, beforeValue, afterValue)
    const sourcePresence = beforeValue ? 'present_in_parsed_source' : 'missing_in_parsed_source'
    const change = {
      candidateId: Number(oldRow.id),
      batchId: Number(oldRow.batch_id),
      supplierName,
      fieldName: apiField,
      fieldLabel: label,
      beforeValue,
      afterValue,
      afterRaw,
      afterLabel: afterValue,
      previousModelName: oldRow.model_name,
      changeType,
      sourcePresence,
    }
    const suggestionKey = upsertRuleSuggestion(db, change, actor)
    const result = insert.run(
      change.candidateId,
      change.batchId,
      supplierName,
      apiField,
      label,
      beforeValue,
      afterValue,
      changeType,
      sourcePresence,
      suggestionKey,
      actor,
      now,
    )
    changes.push({ ...change, id: Number(result.lastInsertRowid), suggestionKey })
  }
  return changes
}

function audit(db, entityType, entityId, action, actor, beforeValue, afterValue) {
  db.prepare(`
    INSERT INTO vehicle_source_audit_logs (
      entity_type, entity_id, action, actor, before_value, after_value, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    entityType,
    entityId,
    action,
    actor,
    JSON.stringify(beforeValue ?? ''),
    JSON.stringify(afterValue ?? ''),
    new Date().toISOString(),
  )
}


export function setupSourceImportWorkbench({ app, db, requireAuth, requireRole, dataDir }) {
  initSourceImportTables(db)

  // Startup sync (async, non-blocking)
  setTimeout(async () => {
    // 1. 同步飞书供应商到本地数据库
    try {
      console.log('[Startup Sync] Syncing suppliers from Feishu...')
      await syncSuppliersFromFeishu(db)
      console.log('[Startup Sync] Suppliers sync complete.')
    } catch (e) {
      console.error('[Startup Sync] Error syncing suppliers from Feishu:', e.message)
    }

    // 2. 同步已审核候选人到飞书
    try {
      const approvedCandidates = db.prepare("SELECT id FROM vehicle_source_candidates WHERE review_status = 'approved' AND feishu_record_id IS NULL").all()
      if (approvedCandidates.length > 0) {
        console.log(`[Startup Sync] Found ${approvedCandidates.length} unsynced approved candidates...`)
        for (const candidate of approvedCandidates) {
          syncCandidateToFeishuBase(db, candidate.id, 'system')
        }
        console.log('[Startup Sync] Successfully synced all approved candidates to Feishu Base.')
      }
    } catch (e) {
      console.error('[Startup Sync] Error during approved candidates sync:', e)
    }
  }, 1000)

  const sourceImportDir = resolve(dataDir, 'source-imports')
  const tempDir = resolve(sourceImportDir, '_tmp')
  mkdirSync(tempDir, { recursive: true })
  const upload = multer({
    dest: tempDir,
    limits: { fileSize: 250 * 1024 * 1024, files: 30 },
  })

  app.get('/api/source-imports/suppliers', requireAuth, requireRole('admin', 'sales'), (req, res) => {
    const suppliers = db.prepare(`
      SELECT * FROM vehicle_source_suppliers
      ORDER BY is_active DESC, supplier_name
    `).all().map(serializeSupplier)
    res.json({ suppliers })
  })

  app.post('/api/source-imports/suppliers', requireAuth, requireRole('admin', 'sales'), (req, res) => {
    let supplier
    try {
      supplier = normalizeSupplierInput(req.body)
    } catch (error) {
      return res.status(400).json({ error: error.message })
    }
    const now = new Date().toISOString()
    try {
      const result = db.prepare(`
        INSERT INTO vehicle_source_suppliers (
          supplier_name, contact_name, phone, wechat, location,
          channel_type, notes, is_active, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        supplier.supplierName,
        supplier.contactName,
        supplier.phone,
        supplier.wechat,
        supplier.location,
        supplier.channelType,
        supplier.notes,
        supplier.isActive ? 1 : 0,
        req.user.username,
        now,
        now,
      )
      const created = db.prepare('SELECT * FROM vehicle_source_suppliers WHERE id = ?').get(result.lastInsertRowid)
      try { syncSupplierToFeishuBase(db, created.id) } catch (e) { console.error('[Feishu] Supplier sync error:', e.message) }
      res.status(201).json({ supplier: serializeSupplier(created) })
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) {
        return res.status(400).json({ error: '供应商名称已存在' })
      }
      throw error
    }
  })

  app.patch('/api/source-imports/suppliers/:supplierId', requireAuth, requireRole('admin', 'sales'), (req, res) => {
    const existing = db.prepare('SELECT * FROM vehicle_source_suppliers WHERE id = ?').get(req.params.supplierId)
    if (!existing) return res.status(404).json({ error: '供应商不存在' })
    let supplier
    try {
      supplier = normalizeSupplierInput({
        supplierName: req.body?.supplierName ?? existing.supplier_name,
        contactName: req.body?.contactName ?? existing.contact_name,
        phone: req.body?.phone ?? existing.phone,
        wechat: req.body?.wechat ?? existing.wechat,
        location: req.body?.location ?? existing.location,
        channelType: req.body?.channelType ?? existing.channel_type,
        notes: req.body?.notes ?? existing.notes,
        isActive: req.body?.isActive ?? Boolean(existing.is_active),
      })
    } catch (error) {
      return res.status(400).json({ error: error.message })
    }
    try {
      db.prepare(`
        UPDATE vehicle_source_suppliers
        SET supplier_name = ?, contact_name = ?, phone = ?, wechat = ?,
            location = ?, channel_type = ?, notes = ?, is_active = ?, updated_at = ?
        WHERE id = ?
      `).run(
        supplier.supplierName,
        supplier.contactName,
        supplier.phone,
        supplier.wechat,
        supplier.location,
        supplier.channelType,
        supplier.notes,
        supplier.isActive ? 1 : 0,
        new Date().toISOString(),
        existing.id,
      )
      const updated = db.prepare('SELECT * FROM vehicle_source_suppliers WHERE id = ?').get(existing.id)
      try { syncSupplierToFeishuBase(db, updated.id) } catch (e) { console.error('[Feishu] Supplier sync error:', e.message) }
      res.json({ supplier: serializeSupplier(updated) })
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) {
        return res.status(400).json({ error: '供应商名称已存在' })
      }
      throw error
    }
  })

  app.delete('/api/source-imports/suppliers/:supplierId', requireAuth, requireRole('admin'), (req, res) => {
    const existing = db.prepare('SELECT * FROM vehicle_source_suppliers WHERE id = ?').get(req.params.supplierId)
    if (!existing) return res.status(404).json({ error: '供应商不存在' })

    let feishuRecordId = existing.feishu_record_id

    // If no feishu_record_id, try looking up by supplier name in Feishu
    if (!feishuRecordId && existing.supplier_name) {
      try {
        const result = execSync(
          `lark-cli base +record-list --base-token ${FEISHU_BASE_TOKEN} --table-id ${FEISHU_SUPPLIERS_TABLE_ID} --as user --limit 50 --format json`,
          { encoding: 'utf8', timeout: 15000 },
        )
        const parsed = JSON.parse(result)
        if (parsed.ok && parsed.data?.data?.length) {
          const fields = parsed.data.fields || []
          const records = parsed.data.data || []
          const recordIds = parsed.data.record_id_list || []
          for (let i = 0; i < records.length; i++) {
            const vals = {}
            if (Array.isArray(records[i])) {
              fields.forEach((name, j) => { vals[name] = records[i][j] })
            }
            if (vals['Supplier Name'] === existing.supplier_name) {
              feishuRecordId = recordIds[i]
              break
            }
          }
        }
      } catch (e) {
        console.error('[Feishu] Lookup error:', e.message)
      }
    }

    if (feishuRecordId) {
      try {
        execFileSync('lark-cli', [
          'base', '+record-delete',
          '--base-token', FEISHU_BASE_TOKEN,
          '--table-id', FEISHU_SUPPLIERS_TABLE_ID,
          '--as', 'user',
          '--record-id', feishuRecordId,
          '--yes',
        ], { stdio: 'pipe', timeout: 15000 })
      } catch (e) {
        console.error('[Feishu] Delete error:', e.message)
      }
    }
    db.prepare('DELETE FROM vehicle_source_suppliers WHERE id = ?').run(existing.id)
    res.status(204).end()
  })

  app.get('/api/source-imports', requireAuth, requireRole('admin', 'sales'), (req, res) => {
    const batches = db.prepare(`
      SELECT * FROM vehicle_source_import_batches
      ORDER BY id DESC
      LIMIT 80
    `).all().map((row) => serializeBatch(row, db))
    const suppliers = db.prepare(`
      SELECT * FROM vehicle_source_suppliers
      WHERE is_active = 1
      ORDER BY supplier_name
    `).all().map(serializeSupplier)
    const rules = db.prepare(`
      SELECT * FROM vehicle_source_rules
      WHERE status = 'active'
      ORDER BY id DESC
      LIMIT 80
    `).all().map(serializeRule)
    const ruleSuggestions = db.prepare(`
      SELECT * FROM vehicle_source_rule_suggestions
      WHERE status = 'pending'
        AND evidence_count >= ?
      ORDER BY confidence_score DESC, evidence_count DESC, updated_at DESC
      LIMIT 30
    `).all(SUGGESTION_EVIDENCE_THRESHOLD).map(serializeRuleSuggestion)
    const experienceMetrics = db.prepare(`
      SELECT
        COUNT(*) AS total_changes,
        SUM(CASE WHEN change_type = 'recognition_correction' THEN 1 ELSE 0 END) AS recognition_corrections,
        SUM(CASE WHEN change_type = 'human_supplement' THEN 1 ELSE 0 END) AS human_supplements,
        SUM(CASE WHEN change_type = 'profile_match_correction' THEN 1 ELSE 0 END) AS profile_corrections
      FROM vehicle_source_field_changes
    `).get()
    const metrics = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN review_status = 'needs_review' THEN 1 ELSE 0 END) AS needs_review,
        SUM(CASE WHEN issue_tags LIKE '%duplicate_risk%' THEN 1 ELSE 0 END) AS duplicate_risk
      FROM vehicle_source_candidates
    `).get()
    res.json({
      batches,
      suppliers,
      rules,
      ruleSuggestions,
      aiStatus: getAiImportStatus(),
      metrics: {
        totalCandidates: Number(metrics.total ?? 0),
        needsReview: Number(metrics.needs_review ?? 0),
        duplicateRisk: Number(metrics.duplicate_risk ?? 0),
        totalFieldChanges: Number(experienceMetrics.total_changes ?? 0),
        recognitionCorrections: Number(experienceMetrics.recognition_corrections ?? 0),
        humanSupplements: Number(experienceMetrics.human_supplements ?? 0),
        profileCorrections: Number(experienceMetrics.profile_corrections ?? 0),
      },
    })
  })

  app.patch('/api/source-imports/rule-suggestions/:suggestionId', requireAuth, requireRole('admin', 'sales'), (req, res) => {
    const suggestion = db.prepare('SELECT * FROM vehicle_source_rule_suggestions WHERE id = ?').get(req.params.suggestionId)
    if (!suggestion) return res.status(404).json({ error: '规则建议不存在' })
    const action = compactText(req.body?.action)
    const now = new Date().toISOString()
    if (!['remember_supplier', 'remember_global', 'snooze', 'ignore'].includes(action)) {
      return res.status(400).json({ error: '规则建议处理动作无效' })
    }
    db.exec('BEGIN')
    try {
      let ruleId = null
      if (action === 'remember_supplier' || action === 'remember_global') {
        ruleId = createRule(db, {
          ruleType: suggestion.rule_type,
          scope: action === 'remember_global' ? 'global' : 'supplier',
          supplierName: action === 'remember_global' ? '' : suggestion.supplier_name,
          sourceKey: suggestion.source_key,
          sourceValue: suggestion.source_value,
          targetField: suggestion.target_field,
          targetValue: suggestion.target_value,
          metadata: jsonParse(suggestion.metadata, {}),
          confidence: `suggested_${suggestion.confidence_score}`,
          createdBy: req.user.username,
        })
      }
      const status = action === 'snooze' ? 'snoozed' : action === 'ignore' ? 'ignored' : 'accepted'
      db.prepare(`
        UPDATE vehicle_source_rule_suggestions
        SET status = ?, decided_by = ?, decided_at = ?, updated_at = ?
        WHERE id = ?
      `).run(status, req.user.username, now, now, suggestion.id)
      audit(db, 'rule_suggestion', suggestion.id, action, req.user.username, serializeRuleSuggestion(suggestion), { ruleId, status })
      db.exec('COMMIT')
      const updated = db.prepare('SELECT * FROM vehicle_source_rule_suggestions WHERE id = ?').get(suggestion.id)
      res.json({ suggestion: serializeRuleSuggestion(updated), ruleId })
    } catch (error) {
      db.exec('ROLLBACK')
      console.error('[Batch Delete] Error:', error.message)
      res.status(500).json({ error: '删除导入批次失败' })
    }
  })

  app.get('/api/source-imports/ai/status', requireAuth, requireRole('admin', 'sales'), (req, res) => {
    res.json(getAiImportStatus())
  })

  app.get('/api/source-imports/rules', requireAuth, requireRole('admin', 'sales'), (req, res) => {
    const rules = db.prepare('SELECT * FROM vehicle_source_rules ORDER BY id DESC').all().map(serializeRule)
    res.json({ rules })
  })

  app.post('/api/source-imports/rules', requireAuth, requireRole('admin', 'sales'), (req, res) => {
    const { ruleType, scope, supplierName, sourceKey, sourceValue, targetField, targetValue } = req.body ?? {}
    if (!ruleType || !targetField) return res.status(400).json({ error: '规则类型和目标字段为必填' })
    const now = new Date().toISOString()
    const result = db.prepare(`INSERT INTO vehicle_source_rules (rule_type, scope, supplier_name, source_key, source_value, target_field, target_value, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(ruleType, scope || 'global', supplierName || '', sourceKey || '', sourceValue || '', targetField, targetValue || '', req.user.username, now, now)
    const rule = db.prepare('SELECT * FROM vehicle_source_rules WHERE id = ?').get(Number(result.lastInsertRowid))
    res.status(201).json({ rule: serializeRule(rule) })
  })

  app.patch('/api/source-imports/rules/:ruleId', requireAuth, requireRole('admin', 'sales'), (req, res) => {
    const existing = db.prepare('SELECT * FROM vehicle_source_rules WHERE id = ?').get(req.params.ruleId)
    if (!existing) return res.status(404).json({ error: '规则不存在' })
    const { ruleType, scope, supplierName, sourceKey, sourceValue, targetField, targetValue } = req.body ?? {}
    const now = new Date().toISOString()
    db.prepare(`UPDATE vehicle_source_rules SET rule_type = ?, scope = ?, supplier_name = ?, source_key = ?, source_value = ?, target_field = ?, target_value = ?, updated_at = ? WHERE id = ?`).run(ruleType ?? existing.rule_type, scope ?? existing.scope, supplierName ?? existing.supplier_name, sourceKey ?? existing.source_key, sourceValue ?? existing.source_value, targetField ?? existing.target_field, targetValue ?? existing.target_value, now, existing.id)
    const rule = db.prepare('SELECT * FROM vehicle_source_rules WHERE id = ?').get(existing.id)
    res.json({ rule: serializeRule(rule) })
  })

  app.delete('/api/source-imports/rules/:ruleId', requireAuth, requireRole('admin', 'sales'), (req, res) => {
    const existing = db.prepare('SELECT * FROM vehicle_source_rules WHERE id = ?').get(req.params.ruleId)
    if (!existing) return res.status(404).json({ error: '规则不存在' })
    db.prepare('DELETE FROM vehicle_source_rules WHERE id = ?').run(existing.id)
    res.status(204).end()
  })

  app.get('/api/source-imports/batches/:batchId', requireAuth, requireRole('admin', 'sales'), (req, res) => {
    const batch = db.prepare('SELECT * FROM vehicle_source_import_batches WHERE id = ?').get(req.params.batchId)
    if (!batch) return res.status(404).json({ error: '导入批次不存在' })
    const files = db.prepare('SELECT * FROM vehicle_source_import_files WHERE batch_id = ? ORDER BY id').all(batch.id).map(serializeFile)
    const candidates = db.prepare('SELECT * FROM vehicle_source_candidates WHERE batch_id = ? ORDER BY id').all(batch.id).map(serializeCandidate)
    const duplicates = db.prepare(`
      SELECT d.*, 
             c1.model_name as candidate_model, c1.supplier_price as candidate_price, c1.currency as candidate_currency, b1.supplier_name as candidate_supplier,
             c2.model_name as matched_model, c2.supplier_price as matched_price, c2.currency as matched_currency, b2.supplier_name as matched_supplier
      FROM vehicle_source_duplicate_links d
      LEFT JOIN vehicle_source_candidates c1 ON c1.id = d.candidate_id
      LEFT JOIN vehicle_source_import_batches b1 ON b1.id = c1.batch_id
      LEFT JOIN vehicle_source_candidates c2 ON c2.id = d.matched_candidate_id
      LEFT JOIN vehicle_source_import_batches b2 ON b2.id = c2.batch_id
      WHERE d.batch_id = ?
      ORDER BY d.score DESC, d.id
    `).all(batch.id).map(serializeDuplicate)
    const snapshots = db.prepare('SELECT * FROM vehicle_source_snapshots WHERE batch_id = ? ORDER BY id').all(batch.id).map((snapshot) => ({
      id: Number(snapshot.id),
      batchId: Number(snapshot.batch_id),
      supplierName: snapshot.supplier_name,
      snapshotTime: snapshot.snapshot_time,
      versionNo: Number(snapshot.version_no),
      previousSnapshotId: snapshot.previous_snapshot_id === null ? null : Number(snapshot.previous_snapshot_id),
      status: snapshot.status,
      activeCount: Number(snapshot.active_count),
      newCount: Number(snapshot.new_count),
      changedCount: Number(snapshot.changed_count),
      missingCount: Number(snapshot.missing_count),
      duplicateCount: Number(snapshot.duplicate_count),
      createdAt: snapshot.created_at,
    }))
    res.json({ batch: serializeBatch(batch, db), files, candidates, duplicates, snapshots })
  })

  app.patch('/api/source-imports/batches/:batchId', requireAuth, requireRole('admin', 'sales'), (req, res) => {
    const batchId = req.params.batchId
    const batch = db.prepare('SELECT * FROM vehicle_source_import_batches WHERE id = ?').get(batchId)
    if (!batch) return res.status(404).json({ error: '导入批次不存在' })

    const snapshotName = compactText(req.body?.snapshotName) ?? batch.snapshot_name
    const snapshotTime = compactText(req.body?.snapshotTime) ?? batch.snapshot_time
    const notes = compactText(req.body?.notes) ?? batch.notes

    const now = new Date().toISOString()
    db.prepare(`
      UPDATE vehicle_source_import_batches
      SET snapshot_name = ?, snapshot_time = ?, notes = ?, updated_at = ?
      WHERE id = ?
    `).run(snapshotName, snapshotTime, notes, now, batchId)

    db.prepare(`
      UPDATE vehicle_source_snapshots
      SET snapshot_time = ?
      WHERE batch_id = ?
    `).run(snapshotTime, batchId)

    const updated = db.prepare('SELECT * FROM vehicle_source_import_batches WHERE id = ?').get(batchId)
    audit(db, 'batch', batchId, 'update_batch', req.user.username, serializeBatch(batch, db), serializeBatch(updated, db))
    res.json({ batch: serializeBatch(updated, db) })
  })

  app.delete('/api/source-imports/batches/:batchId', requireAuth, requireRole('admin'), (req, res) => {
    const batchId = req.params.batchId
    const batch = db.prepare('SELECT * FROM vehicle_source_import_batches WHERE id = ?').get(batchId)
    if (!batch) return res.status(404).json({ error: '导入批次不存在' })

    const supplierName = batch.supplier_name
    db.exec('BEGIN')
    try {
      // Delete duplicate links and field-change records
      db.prepare('DELETE FROM vehicle_source_duplicate_links WHERE candidate_id IN (SELECT id FROM vehicle_source_candidates WHERE batch_id = ?)').run(batchId)
      db.prepare('DELETE FROM vehicle_source_duplicate_links WHERE matched_candidate_id IN (SELECT id FROM vehicle_source_candidates WHERE batch_id = ?)').run(batchId)
      db.prepare('DELETE FROM vehicle_source_field_changes WHERE batch_id = ?').run(batchId)

      // Delete candidates
      db.prepare('DELETE FROM vehicle_source_candidates WHERE batch_id = ?').run(batchId)

      // Delete files
      db.prepare('DELETE FROM vehicle_source_import_files WHERE batch_id = ?').run(batchId)

      // Delete snapshots
      db.prepare('DELETE FROM vehicle_source_snapshots WHERE batch_id = ?').run(batchId)

      // Delete batch
      db.prepare('DELETE FROM vehicle_source_import_batches WHERE id = ?').run(batchId)

      // 8. Delete physical files from disk
      const batchDir = resolve(sourceImportDir, String(batchId))
      try {
        rmSync(batchDir, { recursive: true, force: true })
      } catch (e) {
        console.error(`Failed to delete batch directory ${batchDir}:`, e)
      }

      audit(db, 'batch', batchId, 'delete_batch', req.user.username, serializeBatch(batch, db), null)
      db.exec('COMMIT')
      res.json({ success: true })
    } catch (error) {
      db.exec('ROLLBACK')
      console.error('[Delete Batch] Error:', error.message)
      res.status(500).json({ error: '删除批次失败' })
    }
  })

  app.post('/api/source-imports/batches', requireAuth, requireRole('admin', 'sales'), upload.array('files'), async (req, res) => {
    const supplierName = compactText(req.body?.supplierName)
    const importedBy = compactText(req.body?.importedBy) || req.user.displayName || req.user.username
    const snapshotTime = compactText(req.body?.snapshotTime) || new Date().toISOString().slice(0, 10)
    const snapshotName = compactText(req.body?.snapshotName)
    const notes = compactText(req.body?.notes)
    const aiMode = compactText(req.body?.aiMode) === 'ai_assist' ? 'ai_assist' : 'rules_only'
    if (!supplierName) return res.status(400).json({ error: '请填写供应商名称' })
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: '请上传至少一个供应商文件' })
    ensureSupplier(db, supplierName, req.user.username)

    const previousSnapshot = db.prepare(`
      SELECT s.*
      FROM vehicle_source_snapshots s
      JOIN vehicle_source_import_batches b ON b.id = s.batch_id
      WHERE b.supplier_name = ?
      ORDER BY s.snapshot_time DESC, s.id DESC
      LIMIT 1
    `).get(supplierName)
    const versionNo = previousSnapshot ? Number(previousSnapshot.version_no) + 1 : 1
    const snapshotSequence = Number(db.prepare(`
      SELECT COUNT(*) AS count
      FROM vehicle_source_import_batches
      WHERE supplier_name = ? AND snapshot_time = ?
    `).get(supplierName, snapshotTime).count) + 1
    const now = new Date().toISOString()
    let batchId
    let snapshotId
    db.exec('BEGIN')
    try {
      const batchResult = db.prepare(`
        INSERT INTO vehicle_source_import_batches (
          supplier_name, snapshot_name, snapshot_time, imported_by,
          status, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(supplierName, snapshotName, snapshotTime, importedBy, SOURCE_IMPORT_STATUSES.parsing, notes, now, now)
      batchId = Number(batchResult.lastInsertRowid)
      const snapshotResult = db.prepare(`
        INSERT INTO vehicle_source_snapshots (
          batch_id, supplier_name, snapshot_time, version_no,
          previous_snapshot_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(batchId, supplierName, snapshotTime, versionNo, previousSnapshot?.id ?? null, now)
      snapshotId = Number(snapshotResult.lastInsertRowid)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }

    const batchDir = resolve(sourceImportDir, String(batchId))
    mkdirSync(batchDir, { recursive: true })
    const rules = getRules(db, supplierName)
    const parsedCandidatesForName = []
    for (const file of req.files) {
      const extension = extname(file.originalname).toLowerCase()
      const storedName = `${Date.now()}-${file.filename}${extension}`
      const storedPath = resolve(batchDir, storedName)
      renameSync(file.path, storedPath)
      const fileType = extension.replace('.', '') || 'unknown'
      const fileResult = db.prepare(`
        INSERT INTO vehicle_source_import_files (
          batch_id, original_name, stored_name, file_path, mime_type,
          file_size, file_type, parse_status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'parsing', ?)
      `).run(batchId, file.originalname, storedName, storedPath, file.mimetype ?? '', file.size, fileType, now)
      const fileId = Number(fileResult.lastInsertRowid)
      try {
        const parserContext = { supplierName, rules }
        const parsed = withRuleHitNotes(await parseFileWithOptionalAi({
          file,
          storedPath,
          extension,
          context: parserContext,
          aiMode,
        }))
        parsedCandidatesForName.push(...parsed.candidates)
        const insertContext = { batchId, snapshotId, fileId, supplierName, rules }
        for (const candidate of parsed.candidates) {
          const splits = splitCandidateByColor(candidate)
          for (const splitCandidate of splits) insertCandidate(db, splitCandidate, insertContext)
          if (splits.length > 1) {
            parsed.parserNotes = `${parsed.parserNotes || ''} 其中一条按配色拆成 ${splits.length} 条。`.trim()
          }
        }
        db.prepare(`
          UPDATE vehicle_source_import_files
          SET parse_status = 'parsed', parser_notes = ?, raw_text = ?
          WHERE id = ?
        `).run(parsed.parserNotes || `识别 ${parsed.candidates.length} 条候选记录`, parsed.rawText.slice(0, 20000), fileId)
      } catch (error) {
        db.prepare(`
          UPDATE vehicle_source_import_files
          SET parse_status = 'failed', parser_notes = ?
          WHERE id = ?
        `).run(error.message, fileId)
      }
    }

    if (!snapshotName) {
      const generatedSnapshotName = buildSnapshotName({
        supplierName,
        snapshotTime,
        sequence: snapshotSequence,
        files: req.files,
        candidates: parsedCandidatesForName,
      })
      db.prepare(`
        UPDATE vehicle_source_import_batches
        SET snapshot_name = ?, updated_at = ?
        WHERE id = ?
      `).run(generatedSnapshotName, new Date().toISOString(), batchId)
    }

    updateSnapshotDiff(db, snapshotId, previousSnapshot?.id ?? null)
    const duplicateCount = updateDuplicateSuggestions(db, batchId, snapshotId, supplierName)
    const candidateCount = Number(db.prepare('SELECT COUNT(*) AS count FROM vehicle_source_candidates WHERE batch_id = ?').get(batchId).count)
    const needsReviewCount = Number(db.prepare(`
      SELECT COUNT(*) AS count FROM vehicle_source_candidates
      WHERE batch_id = ? AND review_status = ?
    `).get(batchId, REVIEW_STATUS.needsReview).count)
    db.prepare(`
      UPDATE vehicle_source_import_batches
      SET status = ?, updated_at = ?
      WHERE id = ?
    `).run(needsReviewCount > 0 || duplicateCount > 0 ? SOURCE_IMPORT_STATUSES.needsReview : SOURCE_IMPORT_STATUSES.reviewed, new Date().toISOString(), batchId)
    audit(db, 'batch', batchId, 'create_import_batch', req.user.username, null, { candidateCount, duplicateCount })

    const batch = db.prepare('SELECT * FROM vehicle_source_import_batches WHERE id = ?').get(batchId)
    res.status(201).json({ batch: serializeBatch(batch, db) })
  })

  app.get('/api/source-imports/candidates/:candidateId', requireAuth, (req, res) => {
    const row = db.prepare('SELECT * FROM vehicle_source_candidates WHERE id = ?').get(req.params.candidateId)
    if (!row) return res.status(404).json({ error: '候选车源不存在' })
    res.json({ candidate: serializeCandidate(row) })
  })

  app.patch('/api/source-imports/candidates/:candidateId', requireAuth, requireRole('admin', 'sales'), (req, res) => {
    const existing = db.prepare('SELECT * FROM vehicle_source_candidates WHERE id = ?').get(req.params.candidateId)
    if (!existing) return res.status(404).json({ error: '候选车源不存在' })
    const input = req.body ?? {}
    const updated = {
      brand: compactText(input.brand ?? existing.brand),
      modelName: compactText(input.modelName ?? existing.model_name),
      year: compactText(input.year ?? existing.year),
      trimName: compactText(input.trimName ?? existing.trim_name),
      exteriorColor: compactText(input.exteriorColor ?? existing.exterior_color),
      interiorColor: compactText(input.interiorColor ?? existing.interior_color),
      stockQuantity: Math.max(0, Math.floor(Number(input.stockQuantity ?? existing.stock_quantity) || 0)),
      supplierPrice: Number(input.supplierPrice ?? existing.supplier_price) || 0,
      currency: compactText(input.currency ?? existing.currency),
      tradeTerm: compactText(input.tradeTerm ?? existing.trade_term).toUpperCase(),
      priceExw: input.priceExw === null || input.priceExw === '' ? null : (Number(input.priceExw) || null),
      priceExwCurrency: input.priceExwCurrency ? compactText(input.priceExwCurrency) : (existing.price_exw_currency || 'USD'),
      priceFca: input.priceFca === null || input.priceFca === '' ? null : (Number(input.priceFca) || null),
      priceFcaCurrency: input.priceFcaCurrency ? compactText(input.priceFcaCurrency) : (existing.price_fca_currency || 'USD'),
      priceFob: input.priceFob === null || input.priceFob === '' ? null : (Number(input.priceFob) || null),
      priceFobCurrency: input.priceFobCurrency ? compactText(input.priceFobCurrency) : (existing.price_fob_currency || 'USD'),
      officialPrice: compactText(input.officialPrice ?? existing.official_price),
      location: compactText(input.location ?? existing.location),
      preorderMinDays: Math.max(0, Math.floor(Number(input.preorderMinDays ?? existing.preorder_min_days) || 0)),
      preorderMaxDays: Math.max(0, Math.floor(Number(input.preorderMaxDays ?? existing.preorder_max_days) || 0)),
      canPreorder: Boolean(input.canPreorder ?? existing.can_preorder),
      notes: compactText(input.notes ?? existing.notes),
      profileId: input.profileId === null || input.profileId === '' ? null : Number(input.profileId ?? existing.profile_id),
      reviewStatus: compactText(input.reviewStatus ?? existing.review_status),
      canonicalAction: compactText(input.canonicalAction ?? existing.canonical_action) || 'count_inventory',
    }
    if (!Object.values(REVIEW_STATUS).includes(updated.reviewStatus)) {
      return res.status(400).json({ error: '审核状态无效' })
    }
    const rules = getRules(db)
    const match = updated.profileId
      ? { profileId: updated.profileId, matchStatus: 'matched', matchConfidence: 100 }
      : findProfileMatch(db, updated, rules, '')
    const tags = issueTagsFor(updated, match)
    const fingerprint = candidateFingerprint(updated)
    db.exec('BEGIN')
    try {
      db.prepare(`
        UPDATE vehicle_source_candidates
        SET fingerprint = ?, brand = ?, model_name = ?, year = ?, trim_name = ?,
            exterior_color = ?, interior_color = ?, stock_quantity = ?,
            supplier_price = ?, currency = ?, trade_term = ?, 
            price_exw = ?, price_exw_currency = ?, price_fca = ?, price_fca_currency = ?,
            price_fob = ?, price_fob_currency = ?, official_price = ?,
            location = ?, preorder_min_days = ?, preorder_max_days = ?, can_preorder = ?,
            notes = ?, profile_id = ?, match_status = ?, match_confidence = ?,
            review_status = ?, issue_tags = ?, canonical_action = ?,
            reviewed_by = ?, reviewed_at = ?, updated_at = ?
        WHERE id = ?
      `).run(
        fingerprint,
        updated.brand,
        updated.modelName,
        updated.year,
        updated.trimName,
        updated.exteriorColor,
        updated.interiorColor,
        updated.stockQuantity,
        updated.supplierPrice,
        updated.currency,
        updated.tradeTerm,
        updated.priceExw,
        updated.priceExwCurrency,
        updated.priceFca,
        updated.priceFcaCurrency,
        updated.priceFob,
        updated.priceFobCurrency,
        updated.officialPrice,
        updated.location,
        updated.preorderMinDays,
        updated.preorderMaxDays,
        updated.canPreorder ? 1 : 0,
        updated.notes,
        match.profileId,
        match.matchStatus,
        match.matchConfidence,
        updated.reviewStatus,
        JSON.stringify(tags),
        updated.canonicalAction,
        req.user.username,
        new Date().toISOString(),
        new Date().toISOString(),
        existing.id,
      )
      recordFieldChanges(db, existing, updated, req.user.username)
      audit(db, 'candidate', existing.id, 'update_candidate', req.user.username, serializeCandidate(existing), updated)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    const saved = db.prepare('SELECT * FROM vehicle_source_candidates WHERE id = ?').get(existing.id)
    if (saved.review_status === 'approved') {
      try { syncCandidateToFeishuBase(db, saved.id, req.user.username) } catch (e) { console.error('[Feishu Sync] Error:', e.message) }
      try { syncSnapshotToFeishuBase(db, saved.id, req.user.username) } catch (e) { console.error('[Snapshot Sync] Error:', e.message) }
    }
    res.json({ candidate: serializeCandidate(saved) })
  })

  app.post('/api/source-imports/candidates/:candidateId/refine-experience', requireAuth, requireRole('admin', 'sales'), async (req, res) => {
    const candidateId = Number(req.params.candidateId)
    const { feedbackText, currentFormValues } = req.body
    if (!feedbackText) return res.status(400).json({ error: '请填写反馈内容' })

    const candidate = db.prepare('SELECT * FROM vehicle_source_candidates WHERE id = ?').get(candidateId)
    if (!candidate) return res.status(404).json({ error: '找不到对应的候选车源' })

    const beforeValues = {
      brand: candidate.brand,
      modelName: candidate.model_name,
      year: candidate.year,
      trimName: candidate.trim_name,
      exteriorColor: candidate.exterior_color,
      interiorColor: candidate.interior_color,
      stockQuantity: candidate.stock_quantity,
      priceExw: candidate.price_exw,
      priceFca: candidate.price_fca,
      priceFob: candidate.price_fob,
      officialPrice: candidate.official_price,
      location: candidate.location,
      deliveryTime: candidate.delivery_time,
      notes: candidate.notes
    }

    const rawText = candidate.raw_text

    // Save the user's manual corrections to the database so they don't get lost
    if (currentFormValues && typeof currentFormValues === 'object') {
      const now = new Date().toISOString()
      db.prepare(`
        UPDATE vehicle_source_candidates
        SET brand = ?, model_name = ?, year = ?, trim_name = ?,
            exterior_color = ?, interior_color = ?, stock_quantity = ?,
            price_exw = ?, price_fca = ?, price_fob = ?, official_price = ?,
            location = ?, delivery_time = ?, notes = ?, updated_at = ?
        WHERE id = ?
      `).run(
        currentFormValues.brand ?? candidate.brand,
        currentFormValues.modelName ?? candidate.model_name,
        currentFormValues.year ?? candidate.year,
        currentFormValues.trimName ?? candidate.trim_name,
        currentFormValues.exteriorColor ?? candidate.exterior_color,
        currentFormValues.interiorColor ?? candidate.interior_color,
        currentFormValues.stockQuantity ?? candidate.stock_quantity,
        currentFormValues.priceExw ?? candidate.price_exw,
        currentFormValues.priceFca ?? candidate.price_fca,
        currentFormValues.priceFob ?? candidate.price_fob,
        currentFormValues.officialPrice ?? candidate.official_price,
        currentFormValues.location ?? candidate.location,
        currentFormValues.deliveryTime ?? candidate.delivery_time,
        currentFormValues.notes ?? candidate.notes,
        now,
        candidateId
      )
      console.log(`[Refine Experience] Saving corrections for candidate ${candidateId}:`, {
        priceExw: currentFormValues.priceExw,
        notes: currentFormValues.notes,
        stockQuantity: currentFormValues.stockQuantity,
      })
      console.log(`[Refine Experience] Saved manual corrections for candidate ${candidateId}`)
    }

    // Extract structure rule using AI
    let rules = []
    try {
      const config = getAiProviderConfig()
      if (!config.enabled) throw new Error('未配置 AI Key，无法运行纠错提取')

      const prompt = `你是一个数据校验规则提取专家。
请根据以下上下文提取出一条或多条“纠错规则”：
1. 原始文本：${rawText}
2. 原始 AI 提取错误结果：${JSON.stringify(beforeValues)}
3. 人工修改后的正确结果：${JSON.stringify(currentFormValues)}
4. 用户吐槽的具体错误：${feedbackText}

你的任务是分析用户的吐槽以及修改前后数据的差异，从中提取出结构化的纠错规则。
每条规则必须包含：
- field: 发生错误的字段名（必须是 brand, modelName, year, trimName, exteriorColor, interiorColor, stockQuantity, priceExw, priceFca, priceFob, officialPrice, location, deliveryTime, notes 之一）
- originalValue: 导致解析出错的“原始值”或“错误词汇”。它必须在原始文本或原始错误结果中出现过。
- correctedValue: 用户修正后的“正确值”。它必须代表最终正确的输出。

你必须只返回一个 JSON 数组，格式如下：
[
  { "field": "trimName", "originalValue": "钛3", "correctedValue": "502旗舰型" }
]

不要输出任何 Markdown 格式包裹（严禁使用 \`\`\` 符号），不要输出多余解释文字，直接输出 JSON 数组。`

      let responseText = ''
      if (config.provider === 'gemini' && !config.baseUrl.includes('openai')) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        })
        const body = await res.json()
        responseText = body.candidates?.[0]?.content?.parts?.[0]?.text || ''
      } else {
        const url = `${config.baseUrl}/chat/completions`
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`
          },
          body: JSON.stringify({
            model: config.model,
            messages: [{ role: 'user', content: prompt }]
          })
        })
        const body = await res.json()
        responseText = body.choices?.[0]?.message?.content || ''
      }

      if (responseText) {
        let cleanText = responseText.trim()
        if (cleanText.startsWith('```')) {
          cleanText = cleanText.replace(/^```[a-zA-Z0-9]*\\n/, '').replace(/\\n```$/, '').trim()
        }
        rules = JSON.parse(cleanText)
      }
    } catch (err) {
      console.error('[Experience Extract] AI extraction failed:', err.message)
      return res.status(500).json({ error: 'AI 经验规则提取失败: ' + err.message })
    }

    if (!Array.isArray(rules) || rules.length === 0) {
      return res.status(400).json({ error: 'AI 无法从当前反馈中归纳出结构化规则' })
    }

    // Append to Feishu Experiences Table — each record gets its own contribution description
    const syncErrors = []
    const ruleIndexCounter = { value: 0 }
    for (const rule of rules) {
      if (!rule.field || !rule.originalValue || !rule.correctedValue) continue
      ruleIndexCounter.value++

      // Generate unique contribution description for this rule
      const contributionLines = [
        `【经验规则 #${ruleIndexCounter.value}】字段“${rule.field}”的纠错`,
        `- 错误值：“${rule.originalValue}” → 正确值：“${rule.correctedValue}”`,
      ]
      if (feedbackText) {
        contributionLines.push(`- 纠错原因：${feedbackText}`)
      }
      if (rawText) {
        const snippet = rawText.length > 120 ? rawText.slice(0, 120) + '…' : rawText
        contributionLines.push(`- 数据源原文：${snippet}`)
      }
      const contributionNote = contributionLines.join('\n')

      const fields = ['字段', '原始值', '修正值', '状态', '原始识别内容', '用户反馈', '解析前表单', '解析后表单', '提示词贡献说明']
      const row = [
        rule.field,
        rule.originalValue,
        rule.correctedValue,
        'confirmed',
        rawText,
        feedbackText,
        JSON.stringify(beforeValues),
        JSON.stringify(currentFormValues),
        contributionNote
      ]
      const recordId = feishuAppendRow(FEISHU_EXPERIENCES_TABLE_ID, fields, row)
      if (!recordId) {
        syncErrors.push(`字段 ${rule.field} 写入飞书失败`)
      }
    }

    if (syncErrors.length > 0) {
      return res.status(500).json({ error: syncErrors.join('; ') })
    }

    // Trigger Prompt Refinement (shared prompt only; records already have their own contribution notes)
    const refineResult = await refinePromptWithExperiences()

    res.json({ success: true, rules, refineResult })
  })

  app.patch('/api/source-imports/duplicates/:duplicateId', requireAuth, requireRole('admin', 'sales'), (req, res) => {
    const duplicate = db.prepare('SELECT * FROM vehicle_source_duplicate_links WHERE id = ?').get(req.params.duplicateId)
    if (!duplicate) return res.status(404).json({ error: '同源重复建议不存在' })
    const resolution = compactText(req.body?.resolution)
    if (!['same_origin', 'not_duplicate', 'defer'].includes(resolution)) {
      return res.status(400).json({ error: '请选择有效处理方式' })
    }
    const now = new Date().toISOString()
    db.exec('BEGIN')
    try {
      db.prepare(`
        UPDATE vehicle_source_duplicate_links
        SET status = 'resolved', resolution = ?, confirmed_by = ?, updated_at = ?
        WHERE id = ?
      `).run(resolution, req.user.username, now, duplicate.id)
      if (resolution === 'same_origin') {
        db.prepare(`
          UPDATE vehicle_source_candidates
          SET canonical_action = 'same_origin_channel', review_status = ?
          WHERE id = ?
        `).run(REVIEW_STATUS.needsReview, duplicate.candidate_id)
        const candidate = db.prepare('SELECT c.*, b.supplier_name FROM vehicle_source_candidates c JOIN vehicle_source_import_batches b ON b.id = c.batch_id WHERE c.id = ?').get(duplicate.candidate_id)
        const matched = db.prepare('SELECT c.*, b.supplier_name FROM vehicle_source_candidates c JOIN vehicle_source_import_batches b ON b.id = c.batch_id WHERE c.id = ?').get(duplicate.matched_candidate_id)
        if (candidate && matched) {
          createRule(db, {
            ruleType: 'supplier_same_origin',
            scope: 'global',
            sourceKey: candidate.supplier_name,
            sourceValue: matched.supplier_name,
            targetField: 'canonicalAction',
            targetValue: 'same_origin_channel',
            metadata: { candidateId: Number(candidate.id), matchedCandidateId: Number(matched.id), score: Number(duplicate.score) },
            createdBy: req.user.username,
          })
        }
      }
      audit(db, 'duplicate', duplicate.id, 'resolve_duplicate', req.user.username, serializeDuplicate(duplicate), { resolution })
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    const updated = db.prepare(`
      SELECT d.*, 
             c1.model_name as candidate_model, c1.supplier_price as candidate_price, c1.currency as candidate_currency, b1.supplier_name as candidate_supplier,
             c2.model_name as matched_model, c2.supplier_price as matched_price, c2.currency as matched_currency, b2.supplier_name as matched_supplier
      FROM vehicle_source_duplicate_links d
      LEFT JOIN vehicle_source_candidates c1 ON c1.id = d.candidate_id
      LEFT JOIN vehicle_source_import_batches b1 ON b1.id = c1.batch_id
      LEFT JOIN vehicle_source_candidates c2 ON c2.id = d.matched_candidate_id
      LEFT JOIN vehicle_source_import_batches b2 ON b2.id = c2.batch_id
      WHERE d.id = ?
    `).get(duplicate.id)
    res.json({ duplicate: serializeDuplicate(updated) })
  })
}



async function syncSuppliersFromFeishu(db) {
  try {
    const args = [
      'base', '+record-list',
      '--base-token', FEISHU_BASE_TOKEN,
      '--table-id', FEISHU_SUPPLIERS_TABLE_ID,
      '--as', 'user',
      '--limit', '200',
      '--format', 'json'
    ]
    const result = execFileSync('lark-cli', args, { encoding: 'utf8', timeout: 15000 })
    const parsed = JSON.parse(result)
    if (!parsed.ok) {
      console.error('[Supplier Sync] Feishu response error:', parsed)
      return
    }
    const fields = parsed.data?.fields || []
    const records = parsed.data?.data || []
    const recordIds = parsed.data?.record_id_list || []

    const channelTypeMapReverse = { '源头供应商': 'primary_source', '渠道商': 'distributor', '代理商': 'agent', '其他': 'unknown' }

    const localSuppliers = db.prepare('SELECT * FROM vehicle_source_suppliers').all()
    const localMapByRecordId = new Map(localSuppliers.filter(s => s.feishu_record_id).map(s => [s.feishu_record_id, s]))
    const localMapByName = new Map(localSuppliers.map(s => [s.supplier_name, s]))

    const feishuRecordIds = new Set(recordIds)
    const feishuNames = new Set()

    for (let i = 0; i < records.length; i++) {
      const r = records[i]
      const recordId = recordIds[i]
      const vals = {}
      if (Array.isArray(r)) {
        fields.forEach((name, j) => { vals[name] = r[j] })
      }

      const supplierName = vals['Supplier Name'] || vals['供应商名称'] || ''
      if (!supplierName) continue
      feishuNames.add(supplierName)

      const contactName = vals['Contact Person'] || vals['联系人'] || ''
      const phone = vals['Phone'] || vals['电话'] || ''
      const wechat = vals['WeChat'] || vals['微信'] || ''
      const location = vals['Region'] || vals['区域'] || ''
      const channelTypeFeishu = vals['Channel Type'] || vals['渠道类型'] || '其他'
      const channelType = channelTypeMapReverse[channelTypeFeishu] || 'unknown'
      const status = vals['Status'] || vals['状态'] || 'Active'
      const isActive = status === 'Active' ? 1 : 0
      const notes = vals['Notes'] || vals['备注'] || ''
      const createdAt = vals['Created At'] || vals['创建时间'] || new Date().toISOString()
      const updatedAt = new Date().toISOString()

      const existing = localMapByRecordId.get(recordId) || localMapByName.get(supplierName)

      if (existing) {
        db.prepare(`
          UPDATE vehicle_source_suppliers SET
            supplier_name = ?, contact_name = ?, phone = ?, wechat = ?, location = ?,
            channel_type = ?, notes = ?, is_active = ?, updated_at = ?, feishu_record_id = ?
          WHERE id = ?
        `).run(supplierName, contactName, phone, wechat, location, channelType, notes, isActive, updatedAt, recordId, existing.id)
      } else {
        db.prepare(`
          INSERT INTO vehicle_source_suppliers (
            supplier_name, contact_name, phone, wechat, location,
            channel_type, notes, is_active, created_by, created_at, updated_at, feishu_record_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(supplierName, contactName, phone, wechat, location, channelType, notes, isActive, 'system', createdAt, updatedAt, recordId)
      }
    }

    // Delete local ones no longer in Feishu (both by record_id and orphan names)
    for (const local of localSuppliers) {
      const isRecordIdDeleted = local.feishu_record_id && !feishuRecordIds.has(local.feishu_record_id)
      const isOrphanNameDeleted = !local.feishu_record_id && !feishuNames.has(local.supplier_name)
      if (isRecordIdDeleted || isOrphanNameDeleted) {
        db.prepare('DELETE FROM vehicle_source_suppliers WHERE id = ?').run(local.id)
      }
    }
  } catch (err) {
    console.error('[Supplier Sync] Error syncing suppliers from Feishu:', err.message)
  }
}

function syncProfileToFeishuBase(db, profileId) { }

function syncSupplierToFeishuBase(db, supplierId) {
  const s = db.prepare('SELECT * FROM vehicle_source_suppliers WHERE id = ?').get(supplierId)
  if (!s) return
  const channelTypeMap = { unknown: '其他', primary_source: '源头供应商', distributor: '渠道商', agent: '代理商' }
  const regionOptions = ['重庆', '天津', '上海', '广州', '深圳', '北京', '武汉', '成都', '合肥']
  const location = regionOptions.includes(s.location || '') ? s.location : ''
  const channelType = channelTypeMap[s.channel_type] || '其他'
  const status = s.is_active ? 'Active' : 'Inactive'
  const fields = ['Supplier Name', 'Contact Person', 'Phone', 'WeChat', 'Region', 'Channel Type', 'Status', 'Notes', 'Created At']
  const row = [s.supplier_name || '', s.contact_name || '', s.phone || '', s.wechat || '', location, channelType, status, s.notes || '', s.created_at || '']

  if (s.feishu_record_id) {
    feishuUpdateRow(FEISHU_SUPPLIERS_TABLE_ID, s.feishu_record_id, fields, row)
    return
  }
  const recordId = feishuAppendRow(FEISHU_SUPPLIERS_TABLE_ID, fields, row)
  if (recordId) {
    db.prepare('UPDATE vehicle_source_suppliers SET feishu_record_id = ? WHERE id = ?').run(recordId, supplierId)
  }
}

function syncSnapshotToFeishuBase(db, candidateId, username) {
  const candidate = db.prepare('SELECT c.*, b.supplier_name FROM vehicle_source_candidates c JOIN vehicle_source_import_batches b ON b.id = c.batch_id WHERE c.id = ?').get(candidateId)
  if (!candidate) return
  const snapshot = db.prepare('SELECT * FROM vehicle_source_snapshots WHERE batch_id = ? ORDER BY id DESC LIMIT 1').get(candidate.batch_id)
  if (!snapshot) return
  const leadTime = candidate.preorder_min_days > 0 ? `${candidate.preorder_min_days}-${candidate.preorder_max_days}天` : ''
  const fields = ['Snapshot ID', 'Batch ID', 'Supplier', 'Snapshot Time', 'Version', 'Brand', 'Model', 'Year', 'Trim', 'Exterior Color', 'Interior Color', 'Stock Qty', 'Price EXW', 'Price FCA', 'Price FOB', 'Trade Term', 'Location', 'Lead Time', 'Change Status', 'Recorder', 'Approved At']
  const row = [`SNAP-${candidate.batch_id}-${candidate.id}-${Date.now()}`, `BATCH-${candidate.batch_id}`, candidate.supplier_name, snapshot.snapshot_time, snapshot.version_no, candidate.brand || '', candidate.model_name || '', candidate.year || '', candidate.trim_name || '', candidate.exterior_color || '', candidate.interior_color || '', candidate.stock_quantity || 0, candidate.price_exw || 0, candidate.price_fca || 0, candidate.price_fob || 0, candidate.trade_term || '', candidate.location || '', leadTime, candidate.change_status || 'new', username || '', new Date().toISOString()]
  feishuAppendRow(FEISHU_SNAPSHOTS_TABLE_ID, fields, row)
}

const FEISHU_BASE_TOKEN = 'Xvdfbpk7cadLrnsVCFFcHbhOnCb'
const FEISHU_VEHICLES_TABLE_ID = 'tblTKcuyW7AuZ9nd'
const FEISHU_PROFILES_TABLE_ID = 'tblMmmXZfuWXbsmw'
const FEISHU_SUPPLIERS_TABLE_ID = 'tblRnBLfMzZZQk7Z'
const FEISHU_SNAPSHOTS_TABLE_ID = 'tblKIte5bOq24B5q'
const FEISHU_EXPERIENCES_TABLE_ID = 'tblwWEYbWbV3WGlH'

function feishuAppendRow(tableId, fields, row) {
  const payload = JSON.stringify({ fields, rows: [row] })
  try {
    const result = execFileSync('lark-cli', [
      'base', '+record-batch-create',
      '--base-token', FEISHU_BASE_TOKEN,
      '--table-id', tableId,
      '--as', 'user',
      '--json', payload,
    ], { stdio: 'pipe', timeout: 30000, encoding: 'utf8' })
    const parsed = JSON.parse(result)
    if (parsed.ok && parsed.data?.record_id_list?.length > 0) {
      return parsed.data.record_id_list[0]
    }
    return null
  } catch (err) {
    const msg = err.stderr ? err.stderr.toString() : err.message
    console.error('[Feishu Append] Error:', msg.slice(0, 300))
    return null
  }
}

function feishuUpdateRow(tableId, recordId, fields, row) {
  const patch = {}
  fields.forEach((name, i) => { patch[name] = row[i] })
  const payload = JSON.stringify({ record_id_list: [recordId], patch })
  try {
    execFileSync('lark-cli', [
      'base', '+record-batch-update',
      '--base-token', FEISHU_BASE_TOKEN,
      '--table-id', tableId,
      '--as', 'user',
      '--json', payload,
    ], { stdio: 'pipe', timeout: 30000 })
    return true
  } catch (err) {
    const msg = err.stderr ? err.stderr.toString() : err.message
    console.error('[Feishu Update] Error:', msg.slice(0, 300))
    return false
  }
}

function syncCandidateToFeishuBase(db, candidateId, username) {
  const candidate = db.prepare('SELECT * FROM vehicle_source_candidates WHERE id = ?').get(candidateId)
  if (!candidate) return
  if (candidate.review_status !== 'approved') return

  const batch = db.prepare('SELECT * FROM vehicle_source_import_batches WHERE id = ?').get(candidate.batch_id)
  const supplierName = batch ? batch.supplier_name : '未知供应商'

  let energyType = ''
  let batteryKwh = null
  let rangeKm = null

  // 1. 查询相关的 confirmed/same_origin 同源关系，用来拼装 Public Notes 里的同源比价信息
  let parentNotes = ''
  let childNotes = ''
  try {
    const links = db.prepare(`
      SELECT d.*, 
             c1.model_name as candidate_model, c1.supplier_price as candidate_price, c1.currency as candidate_currency, b1.supplier_name as candidate_supplier, c1.feishu_record_id as candidate_feishu_id,
             c2.model_name as matched_model, c2.supplier_price as matched_price, c2.currency as matched_currency, b2.supplier_name as matched_supplier, c2.feishu_record_id as matched_feishu_id
      FROM vehicle_source_duplicate_links d
      LEFT JOIN vehicle_source_candidates c1 ON c1.id = d.candidate_id
      LEFT JOIN vehicle_source_import_batches b1 ON b1.id = c1.batch_id
      LEFT JOIN vehicle_source_candidates c2 ON c2.id = d.matched_candidate_id
      LEFT JOIN vehicle_source_import_batches b2 ON b2.id = c2.batch_id
      WHERE (d.candidate_id = ? OR d.matched_candidate_id = ?) AND d.resolution = 'same_origin'
    `).all(candidateId, candidateId)

    // 如果当前 candidate 是同源冗余车源：拼接它指向的那个主渠道
    if (candidate.canonical_action === 'same_origin_channel') {
      const parentLinks = links.filter(l => l.candidate_id === candidateId)
      if (parentLinks.length > 0) {
        const p = parentLinks[0]
        const matchedIdStr = p.matched_feishu_id ? `飞书 ID: ${p.matched_feishu_id}` : `本地车源 ID: ${p.matched_candidate_id}`
        parentNotes = `【同源冗余车源】主渠道指向：${p.matched_supplier || '未知渠道'} 的 ${p.matched_model || '未知车型'} (价格: ${p.matched_currency || 'USD'} ${p.matched_price || 0})，[关联 ${matchedIdStr}]。本记录不计入物理库存。`
      }
    } else {
      // 如果当前是正常入库的主车源：拼接它在底盘备份的所有同源低价/参考备选渠道
      const childLinks = links.filter(l => l.matched_candidate_id === candidateId)
      if (childLinks.length > 0) {
        const channelLines = childLinks.map(c => `${c.candidate_supplier || '未知供应商'}(${c.candidate_currency || 'USD'} ${c.candidate_price || 0})`)
        childNotes = `【同源备选渠道】${channelLines.join('；')}`
      }
    }
  } catch (e) {
    console.error('[Feishu Sync] Error resolving duplicate links metadata:', e.message)
  }

  // 拼装最终的 Notes 备注
  let publicNotes = candidate.notes || ''
  if (parentNotes) {
    publicNotes = publicNotes ? `${publicNotes}\n${parentNotes}` : parentNotes
  }
  if (childNotes) {
    publicNotes = publicNotes ? `${publicNotes}\n${childNotes}` : childNotes
  }

  // 如果是 same_origin_channel 冗余渠道，我们将 Is Listed 设为 false，防止在终端前台混淆上架
  const isListed = candidate.canonical_action !== 'same_origin_channel'

  const vehicleId = `EV-${Date.now().toString(36).toUpperCase()}-${candidateId}`
  const leadTime = candidate.preorder_min_days > 0
    ? `${candidate.preorder_min_days}-${candidate.preorder_max_days} days`
    : ''
  const status = candidate.stock_quantity > 0 ? 'In Stock' : 'Preorder'

  const fields = [
    'Vehicle ID', 'Brand', 'Model', 'Year', 'Trim',
    'Exterior Color', 'Interior Color', 'Stock Quantity',
    'Cost (EXW)', 'Cost (FOB)', 'Cost (FCA)',
    'Trade Term', 'Energy Type', 'Battery (kWh)', 'Range (km)',
    'Location', 'Supplier', 'Lead Time', 'Status', 'Recorder',
    'Public Notes', 'Is Listed',
  ]
  const row = [
    vehicleId, candidate.brand || '', candidate.model_name || '',
    candidate.year || '', candidate.trim_name || '',
    candidate.exterior_color || '', candidate.interior_color || '',
    candidate.stock_quantity || 0,
    candidate.price_exw || 0, candidate.price_fob || 0, candidate.price_fca || 0,
    candidate.trade_term || 'EXW',
    energyType, batteryKwh, rangeKm,
    candidate.location || '', supplierName, leadTime, status,
    username || '', publicNotes, isListed,
  ]

  const existingRecordId = candidate.feishu_record_id
  const hasValidFeishuId = existingRecordId && String(existingRecordId).startsWith('rec')

  if (hasValidFeishuId) {
    // Update existing Feishu record
    if (feishuUpdateRow(FEISHU_VEHICLES_TABLE_ID, existingRecordId, fields, row)) {
      console.log(`[Feishu Sync] Updated record for candidate ${candidateId}: ${existingRecordId}`)
    }
  } else {
    // Create new Feishu record
    const recordId = feishuAppendRow(FEISHU_VEHICLES_TABLE_ID, fields, row)
    if (recordId) {
      db.prepare('UPDATE vehicle_source_candidates SET feishu_record_id = ? WHERE id = ?').run(recordId, candidateId)
      console.log(`[Feishu Sync] Created record for candidate ${candidateId}: ${recordId}`)
    }
  }
}
