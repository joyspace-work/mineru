/**
 * Gemini 结构化提取 — 包含多模态 Fallback
 * 
 * 流程：
 *   1. 优先使用文本模式处理 OCR 后的 Markdown
 *   2. 如果没有本地 OCR，自动 Fallback 到多模态 Vision 模式（直接读取图片/PDF，通过 Base64 发给 Gemini）
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');


// ──────────────────────────────────────────────
// 环境变量加载
// ──────────────────────────────────────────────
function loadEnv() {
  try {
    const envText = fs.readFileSync(path.join(PROJECT_ROOT, '.env'), 'utf-8');
    envText.split(/\r?\n/).forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const idx = trimmed.indexOf('=');
      if (idx <= 0) return;
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
      if (!process.env[key]) process.env[key] = value;
    });
  } catch {}
}
loadEnv();

// ──────────────────────────────────────────────
// 推断函数
// ──────────────────────────────────────────────
const TERM_PATTERN = /\b(EXW|FCA|FOB|CIF|CNF)\b/i;

const LOCATION_ALIASES = [
  ['霍尔果斯', ['霍尔果斯', 'Horgos', '果斯', '霍尔果']],
  ['南沙', ['南沙', 'Nansha']],
  ['上海', ['上海', 'Shanghai']],
  ['武汉', ['武汉', 'Wuhan']],
  ['湘潭', ['湘潭', 'Xiangtan']],
  ['山东', ['山东', 'Shandong']],
  ['重庆', ['重庆', 'Chongqing']],
  ['天津', ['天津', 'Tianjin']],
  ['广州', ['广州', 'Guangzhou']],
  ['深圳', ['深圳', 'Shenzhen']],
];

function inferTradeTerm(text) {
  const match = String(text || '').match(TERM_PATTERN);
  return match ? match[1].toUpperCase() : '';
}

function inferLocation(text) {
  const t = String(text || '');
  for (const [standard, aliases] of LOCATION_ALIASES) {
    if (aliases.some(a => t.toLowerCase().includes(String(a).toLowerCase()))) {
      return standard;
    }
  }
  return '';
}

function normalizeCurrency(value, context = '') {
  const text = `${value ?? ''} ${context}`.toLowerCase();
  if (text.includes('usd') || text.includes('美金') || text.includes('美元') || text.includes('$')) return 'USD';
  if (text.includes('rmb') || text.includes('cny') || text.includes('人民币')) return 'CNY';
  const price = parseFloat(String(value).replace(/[^0-9.]/g, '')) || 0;
  if (price >= 50000) return 'CNY';
  if (price > 0) return 'USD';
  return '';
}

function inferSupplierFromPath(filename) {
  const parts = filename.replace(/\.[^.]+$/, '').split('__');
  return parts.length >= 2 ? parts[1] : '';
}

function inferBrandFromPath(filename) {
  const parts = filename.replace(/\.[^.]+$/, '').split('__');
  return parts.length >= 1 ? parts[0] : '';
}

// ──────────────────────────────────────────────
// Gemini API 配置与请求
// ──────────────────────────────────────────────

function getApiConfig() {
  const provider = (process.env.AI_PROVIDER || 'gemini').toLowerCase();

  if (provider === 'gemini') {
    return {
      provider: 'gemini',
      apiKey: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_SOURCE_IMPORT_MODEL || 'gemini-2.5-flash',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    };
  }
  return {
    provider: 'openrouter',
    apiKey: process.env.OPENROUTER_API_KEY,
    model: process.env.OPENROUTER_SOURCE_IMPORT_MODEL || 'google/gemini-2.5-flash',
    baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
  };
}

function buildPrompt(text, supplierName, mode = 'text') {
  const mappingRules = `
🚨 核心原则 1：数据真实性与封闭性原则
- 数据 100% 忠于源头：所有解析并录入的数据，必须且只能完全来自原始输入，严禁编造或上网调研。如果原始数据中未提供官方建议指导价、成本价等信息，则必须留空为 null。
- 严禁汇率转换：根据车源上下文识别计价货币，直接填入对应字段（如 priceExw / priceFca / priceFob / priceCif 及其币种字段，不要自行折算汇率）。

🚨 核心原则 2：车型与品牌规范化原则（自动转译）
当你从中文车源中提取品牌（brand）和车型（modelName）时，必须使用下表自动将其转译为官方格式，绝对禁止直接写入中文车型名（如“海鸥”、“极氪001”）或中文品牌名：
| 原始中文品牌/车型 | 官方写入 brand | 官方写入 modelName |
| :--- | :--- | :--- |
| 问界 M9 | AITO | M9 |
| 比亚迪 海豚 / Dolphin | BYD | Dolphin |
| 比亚迪 汉 EV / Han EV | BYD | Han EV |
| 比亚迪 秦 PLUS / Qin PLUS EV | BYD | Qin PLUS EV |
| 比亚迪 海鸥 / Seagull | BYD | Seagull |
| 比亚迪 海豹 / Seal | BYD | Seal |
| 比亚迪 海狮05EV / 海狮 7 / 海狮07EV | BYD | Sealion 7 |
| 比亚迪 鲨鱼 / Shark / Shark 6 | BYD | Shark |
| 比亚迪 唐 L EV / Tang L EV | BYD | Tang L EV |
| 比亚迪 元 UP / Yuan UP | BYD | Yuan UP |
| 长安 糯玉米 / Lumin | Changan | Lumin |
| 长安启源 Q05 | Changan Nevo | Q05 |
| 深蓝 S05 | Deepal | S05 |
| 深蓝 S07 | Deepal | S07 |
| 东风 纳米01 / Nammi 01 | Dongfeng | Nammi 01 |
| 东风 锐骐6 EV / Rich 6 EV | Dongfeng | Rich 6 EV |
| 方程豹 豹3 / 钛3 / Ti 3 | Fangchengbao | Ti 3 |
| 方程豹 豹5 / Leopard 5 | Fangchengbao | Leopard 5 |
| 方程豹 豹7 / 钛7 / Ti 7 | Fangchengbao | Ti 7 |
| 方程豹 豹8 / Leopard 8 | Fangchengbao | Leopard 8 |
| 远程 星享V | Farizon | Xingxiang V |
| 广汽埃安 RT | GAC Aion | RT |
| 广汽埃安 V / Aion V | GAC Aion | V |
| 广汽埃安 i60 | GAC Aion | i60 |
| 埃安 Y Plus | GAC Motor | Aion Y Plus |
| 长城 炮 EV / Cannon EV | GWM | Cannon EV |
| 吉利 银河 E5 / Galaxy E5 | Geely | Galaxy E5 |
| 吉利 银河 M9 / Galaxy M9 | Geely | Galaxy M9 |
| 吉利 几何 / Geome / 熊猫 | Geely | Geome |
| 吉利 几何C / Geometry C | Geely | Geometry C |
| 红旗 E-HS9 | Hongqi | E-HS9 |
| 零跑 D19 | Leapmotor | D19 |
| 零跑 Lafa 5 | Leapmotor | Lafa 5 |
| 零跑 T03 | Leapmotor | T03 |
| 理想 L6 | Li Auto | L6 |
| 领徽 e7 | Linghui | e7 |
| 名爵 MG4 EV / MG4 EV | MG | MG4 EV |
| 雷达 RD6 | Radar | RD6 |
| 享界 S9 | Stelato | S9 |
| 坦克 500 / Tank 500 | Tank | 500 Hi4-T |
| 岚图 泰山 X8 | Voyah | Taishan X8 |
| 五菱 缤果 Plus | Wuling | Bingo Plus |
| 小鹏 G9 | XPENG | G9 |
| 小米 SU7 Ultra | Xiaomi | SU7 Ultra |
| 小米 YU7 | Xiaomi | YU7 |
| 极氪 001 | Zeekr | 001 |
| 极氪 9X | Zeekr | 9X |

🚨 核心原则 3：配色与阶梯价拆分规则
- 多配色拆分：如果颜色栏有多种配色（如 “3暖阳白/黑 + 13灰/黑”），必须拆分为多条独立的 JSON 记录，每条记录有自己对应的库存数量和颜色。
- 阶梯价格拆分：如果含有数量阶梯价格（如 “1台32000，5台31000”），必须拆分为独立的 JSON 记录，各自填写正确的起订量区间（minQuantity, maxQuantity）与单价价格。

🚨 核心原则 4：历史提取与修正经验
- 数量前缀剥离：如“110白”，提取数量 110，颜色 白。
- 配置版本与车型切分：将品牌名后的第一个型号作为 modelName，其余修饰描述作为 trimName。如在车型库中无法对应，trimName 直接留空为 null。
- 地理地名：提货地 location 仅填真实物理地名，必须剔除贸易前缀如“FCA/FOB/EXW/CIF”。必须保留完整地名修饰（如“霍尔果斯基地”不能缩写为“霍尔果斯”，“天津港”不能简写为“天津”）。
- 清洗非数字价格：如果指导价写着“底盘配置代号”非数字价格，官方指导价填 null，并把代号写到 notes 或 trimName 中。
- 价格数值清洗：价格必须剔除所有 ¥, $, 逗号（千分位）及空格等，直接转化为纯数字值。
- 货期 Lead Time 提取：若有包含交付月份，将其转换为 YYYY-MM-DD 格式（上旬/中旬/无具体日期填当月 15 号，下旬/月底填当月 28 号。下单等待周期如“6-8周”、“30天”等不要填在此处，而是填入 notes 或另外描述）。
`;

  return [
    '你是车源导入解析助手。请把供应商发来的车源资料解析为严格 JSON。',
    '只输出一个 JSON 对象，不要输出解释文字。顶层必须包含 candidates 数组。',
    '顶层格式必须是：{"rawText":"","parserNotes":"","candidates":[...]}。',
    '字段必须使用：brand, modelName, year, trimName, exteriorColor, interiorColor, stockQuantity, priceExw, priceExwCurrency, priceFca, priceFcaCurrency, priceFob, priceFobCurrency, officialPrice, location, preorderMinDays, preorderMaxDays, canPreorder, notes, rawText, rawFields, confidence, uncertainFields。',
    mappingRules,
    `供应商：${supplierName || '未知'}`,
    `解析模式：${mode}`,
    text ? `原始文本：\n${text.slice(0, 18000)}` : '',
  ].filter(Boolean).join('\n\n');
}

/**
 * 核心请求方法，支持多模态附件
 */
async function callGemini(text, supplierName, filePath = null) {
  const config = getApiConfig();
  if (!config.apiKey) {
    throw new Error(`❌ 未设置 API Key。请在 .env 中设置 GEMINI_API_KEY 或 OPENROUTER_API_KEY`);
  }

  const mode = filePath ? `multimodal (${path.extname(filePath)})` : 'text';
  const prompt = buildPrompt(text, supplierName, mode);

  // 1. 读取文件附件（如果存在）
  let inlineData = null;
  if (filePath && fs.existsSync(filePath)) {
    const ext = path.extname(filePath).toLowerCase();
    let mimeType = 'application/octet-stream';
    if (ext === '.pdf') mimeType = 'application/pdf';
    else if (ext === '.png') mimeType = 'image/png';
    else if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
    else if (ext === '.webp') mimeType = 'image/webp';

    const base64 = fs.readFileSync(filePath).toString('base64');
    inlineData = { mimeType, data: base64 };
  }

  if (config.provider === 'gemini') {
    // 官方 Gemini API
    const url = `${config.baseUrl}/models/${config.model}:generateContent?key=${config.apiKey}`;
    const parts = [{ text: prompt }];
    if (inlineData) {
      parts.push({ inlineData });
    }

    const body = {
      contents: [{ parts }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
      },
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180000);
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.error?.message || `HTTP ${resp.status}`);
      const responseText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return extractJsonObject(responseText);
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  } else {
    // OpenRouter (多模态只支持图片)
    const url = `${config.baseUrl}/chat/completions`;
    const content = [{ type: 'text', text: prompt }];

    if (inlineData && inlineData.mimeType.startsWith('image/')) {
      content.push({
        type: 'image_url',
        image_url: { url: `data:${inlineData.mimeType};base64,${inlineData.data}` },
      });
    }

    const body = {
      model: config.model,
      messages: [{ role: 'user', content }],
      max_tokens: 5000,
      response_format: { type: 'json_object' },
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180000);
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.error?.message || `HTTP ${resp.status}`);
      const responseText = data?.choices?.[0]?.message?.content || '';
      return extractJsonObject(responseText);
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  }
}

function extractJsonObject(text) {
  if (text && typeof text === 'object') return text;
  const value = String(text ?? '').trim();
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return extractJsonObject(fenced[1]);
    const start = value.indexOf('{');
    const end = value.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { return JSON.parse(value.slice(start, end + 1)); } catch { return null; }
    }
    return null;
  }
}

function postProcessCandidate(candidate, supplierName = '') {
  const fullText = JSON.stringify(candidate);

  if (!candidate.tradeTerm) candidate.tradeTerm = inferTradeTerm(fullText);
  if (!candidate.location) candidate.location = inferLocation(fullText);

  if (candidate.priceExw && !candidate.priceExwCurrency) {
    candidate.priceExwCurrency = normalizeCurrency(candidate.priceExw, fullText);
  }
  if (candidate.priceFob && !candidate.priceFobCurrency) {
    candidate.priceFobCurrency = normalizeCurrency(candidate.priceFob, fullText);
  }
  if (candidate.priceFca && !candidate.priceFcaCurrency) {
    candidate.priceFcaCurrency = normalizeCurrency(candidate.priceFca, fullText);
  }

  if (!candidate.supplierName) candidate.supplierName = supplierName;

  candidate.priceExw = parseFloat(candidate.priceExw) || 0;
  candidate.priceFob = parseFloat(candidate.priceFob) || 0;
  candidate.priceFca = parseFloat(candidate.priceFca) || 0;
  candidate.stockQuantity = Math.max(0, Math.floor(parseFloat(candidate.stockQuantity) || 0));

  return candidate;
}

async function processOcrOutput(ocrFilePath, sourceFileName) {
  const content = fs.readFileSync(ocrFilePath, 'utf-8');
  if (!content.trim()) return [];

  const supplier = inferSupplierFromPath(sourceFileName || path.basename(ocrFilePath));
  const brand = inferBrandFromPath(sourceFileName || path.basename(ocrFilePath));

  const result = await callGemini(content, supplier);
  if (!result || !result.candidates) return [];

  return result.candidates.map(c => {
    if (!c.brand && brand) c.brand = brand;
    return postProcessCandidate(c, supplier);
  });
}

/**
 * 多模态 Vision 模式：直接将原图/PDF 发给 Gemini
 */
async function processMultimodalFile(filePath) {
  const filename = path.basename(filePath);
  const supplier = inferSupplierFromPath(filename);
  const brand = inferBrandFromPath(filename);

  const result = await callGemini('请识别此附件文件内容。', supplier, filePath);
  if (!result || !result.candidates) return [];

  return result.candidates.map(c => {
    if (!c.brand && brand) c.brand = brand;
    return postProcessCandidate(c, supplier);
  });
}

async function processTextFile(textFilePath) {
  const content = fs.readFileSync(textFilePath, 'utf-8');
  if (!content.trim() || content.trim().length < 5) return [];
  
  const supplier = inferSupplierFromPath(path.basename(textFilePath));
  const brand = inferBrandFromPath(path.basename(textFilePath));

  const result = await callGemini(content, supplier);
  if (!result || !result.candidates) return [];

  return result.candidates.map(c => {
    if (!c.brand && brand) c.brand = brand;
    return postProcessCandidate(c, supplier);
  });
}

module.exports = {
  callGemini,
  buildPrompt,
  extractJsonObject,
  postProcessCandidate,
  processOcrOutput,
  processMultimodalFile,
  processTextFile,
  inferTradeTerm,
  inferLocation,
  normalizeCurrency,
  getApiConfig,
};
