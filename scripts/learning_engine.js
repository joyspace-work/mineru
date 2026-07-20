/**
 * 自学习规则引擎 — 识别纠错经验积累系统
 * 
 * 设计思路（来自原工程 vehicle_source_rules 的纯 JSON 重构版）：
 * 
 * 1. AI 首次识别 → 输出 candidates JSON
 * 2. 人工审核修正 → 调用 addCorrection() 记录修正
 * 3. 相同错误累计 ≥ N 次 → 自动升级为正式规则
 * 4. 下次识别时 → applyRules() 自动修正，不再依赖 AI
 * 
 * 数据存储：纯 JSON 文件，无数据库
 *   - data/corrections.json   — 原始修正记录
 *   - data/rules.json         — 正式生效的修正规则
 *   - data/rules_pending.json — 待确认的规则建议
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');
const CORRECTIONS_FILE = path.join(DATA_DIR, 'corrections.json');
const RULES_FILE = path.join(DATA_DIR, 'rules.json');
const PENDING_FILE = path.join(DATA_DIR, 'rules_pending.json');

// 自动升级阈值：同一修正出现 N 次后自动生效
const AUTO_PROMOTE_THRESHOLD = 3;

// ──────────────────────────────────────────────
// 数据读写
// ──────────────────────────────────────────────
function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadJson(filePath, defaultValue = []) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return defaultValue;
  }
}

function saveJson(filePath, data) {
  ensureDataDir();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ──────────────────────────────────────────────
// 修正记录
// ──────────────────────────────────────────────

/**
 * 记录一次人工修正
 * @param {Object} correction
 * @param {string} correction.field     — 修正的字段名 (brand, modelName, trimName, etc.)
 * @param {string} correction.before    — AI 识别的原始值
 * @param {string} correction.after     — 人工修正后的值
 * @param {string} correction.supplier  — 供应商名（可选，用于供应商级别规则）
 * @param {string} correction.context   — 上下文信息（文件名、备注等）
 */
function addCorrection(correction) {
  const corrections = loadJson(CORRECTIONS_FILE);
  const record = {
    id: corrections.length + 1,
    field: correction.field,
    before: correction.before,
    after: correction.after,
    supplier: correction.supplier || '',
    context: correction.context || '',
    timestamp: new Date().toISOString(),
  };
  corrections.push(record);
  saveJson(CORRECTIONS_FILE, corrections);

  // 检查是否需要生成/升级规则建议
  promoteIfReady(record);
  return record;
}

/**
 * 检查同一修正是否达到自动升级阈值
 */
function promoteIfReady(correction) {
  const corrections = loadJson(CORRECTIONS_FILE);
  const pending = loadJson(PENDING_FILE);
  const rules = loadJson(RULES_FILE);

  // 计算同一 field+before+after 的出现次数
  const key = `${correction.field}::${correction.before}::${correction.after}`;
  const count = corrections.filter(
    c => c.field === correction.field && c.before === correction.before && c.after === correction.after
  ).length;

  // 已经是正式规则？跳过
  if (rules.some(r => r.key === key)) return;

  const suggestion = {
    key,
    field: correction.field,
    before: correction.before,
    after: correction.after,
    supplier: correction.supplier || '',
    scope: correction.supplier ? 'supplier' : 'global',
    evidenceCount: count,
    status: count >= AUTO_PROMOTE_THRESHOLD ? 'auto_promoted' : 'pending',
    firstSeen: corrections.find(
      c => c.field === correction.field && c.before === correction.before && c.after === correction.after
    )?.timestamp,
    lastSeen: correction.timestamp || new Date().toISOString(),
  };

  // 更新或新增 pending
  const idx = pending.findIndex(p => p.key === key);
  if (idx >= 0) {
    pending[idx] = { ...pending[idx], ...suggestion };
  } else {
    pending.push(suggestion);
  }
  saveJson(PENDING_FILE, pending);

  // 达到阈值 → 自动升级为正式规则
  if (count >= AUTO_PROMOTE_THRESHOLD) {
    const rule = {
      id: rules.length + 1,
      key,
      field: correction.field,
      match: correction.before,
      replace: correction.after,
      scope: correction.supplier ? 'supplier' : 'global',
      supplier: correction.supplier || '',
      source: 'auto_promoted',
      evidenceCount: count,
      createdAt: new Date().toISOString(),
      active: true,
    };
    rules.push(rule);
    saveJson(RULES_FILE, rules);
    console.log(`📚 Rule auto-promoted: "${correction.before}" → "${correction.after}" (${correction.field}, ${count} occurrences)`);
  }
}

// ──────────────────────────────────────────────
// 手动管理规则
// ──────────────────────────────────────────────

/**
 * 手动确认一条 pending 规则
 */
function confirmRule(key) {
  const pending = loadJson(PENDING_FILE);
  const rules = loadJson(RULES_FILE);
  const item = pending.find(p => p.key === key);
  if (!item) return null;

  item.status = 'confirmed';
  saveJson(PENDING_FILE, pending);

  if (!rules.some(r => r.key === key)) {
    rules.push({
      id: rules.length + 1,
      key,
      field: item.field,
      match: item.before,
      replace: item.after,
      scope: item.scope,
      supplier: item.supplier,
      source: 'human_confirmed',
      evidenceCount: item.evidenceCount,
      createdAt: new Date().toISOString(),
      active: true,
    });
    saveJson(RULES_FILE, rules);
  }
  return item;
}

/**
 * 手动添加一条规则（无需等待积累）
 */
function addManualRule({ field, match, replace, supplier, scope }) {
  const rules = loadJson(RULES_FILE);
  const key = `${field}::${match}::${replace}`;
  if (rules.some(r => r.key === key)) return null;

  const rule = {
    id: rules.length + 1,
    key,
    field,
    match,
    replace,
    scope: scope || (supplier ? 'supplier' : 'global'),
    supplier: supplier || '',
    source: 'manual',
    evidenceCount: 0,
    createdAt: new Date().toISOString(),
    active: true,
  };
  rules.push(rule);
  saveJson(RULES_FILE, rules);
  return rule;
}

// ──────────────────────────────────────────────
// 应用规则（识别后处理）
// ──────────────────────────────────────────────

/**
 * 对一条 candidate 应用所有活跃规则
 * @param {Object} candidate — AI 识别输出的单条记录
 * @param {string} supplier  — 当前供应商名
 * @returns {{ candidate: Object, appliedRules: string[] }}
 */
function applyRules(candidate, supplier = '') {
  const rules = loadJson(RULES_FILE).filter(r => r.active);
  const appliedRules = [];

  for (const rule of rules) {
    // 范围检查：supplier 级别的规则只对该供应商生效
    if (rule.scope === 'supplier' && rule.supplier && rule.supplier !== supplier) continue;

    const fieldValue = candidate[rule.field];
    if (typeof fieldValue === 'string' && fieldValue === rule.match) {
      candidate[rule.field] = rule.replace;
      appliedRules.push(`${rule.field}: "${rule.match}" → "${rule.replace}" (rule#${rule.id})`);
    }
  }

  if (appliedRules.length > 0) {
    candidate._appliedRules = appliedRules;
    candidate.notes = [candidate.notes, `自动修正: ${appliedRules.join('; ')}`].filter(Boolean).join('；');
  }

  return { candidate, appliedRules };
}

/**
 * 批量应用规则
 */
function applyRulesToBatch(candidates, supplier = '') {
  return candidates.map(c => applyRules(c, supplier));
}

// ──────────────────────────────────────────────
// 统计与查看
// ──────────────────────────────────────────────

function getStats() {
  const corrections = loadJson(CORRECTIONS_FILE);
  const rules = loadJson(RULES_FILE);
  const pending = loadJson(PENDING_FILE);
  return {
    totalCorrections: corrections.length,
    activeRules: rules.filter(r => r.active).length,
    pendingSuggestions: pending.filter(p => p.status === 'pending').length,
    autoPromoted: rules.filter(r => r.source === 'auto_promoted').length,
    humanConfirmed: rules.filter(r => r.source === 'human_confirmed' || r.source === 'manual').length,
  };
}

module.exports = {
  addCorrection,
  confirmRule,
  addManualRule,
  applyRules,
  applyRulesToBatch,
  getStats,
  loadJson,
  saveJson,
  CORRECTIONS_FILE,
  RULES_FILE,
  PENDING_FILE,
};
