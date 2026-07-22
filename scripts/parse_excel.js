/**
 * Excel 解析器 — 从 xlsx/xls/csv 中提取结构化行数据
 * 
 * 核心逻辑来自原工程 sourceImports.js 的表头别名映射
 * 输入：input/classified/excels/ 目录中的文件
 * 输出：output/parsed/excels/ 目录中的 JSON
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const PROJECT_ROOT = path.join(__dirname, '..');
const EXCELS_DIR = path.join(PROJECT_ROOT, 'input/classified/excels');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'output/parsed/excels');

// ──────────────────────────────────────────────
// 表头别名映射（来自原工程，60+ 组映射）
// ──────────────────────────────────────────────
const HEADER_ALIASES = {
  // brand
  '品牌': 'brand', '车辆品牌': 'brand', 'brand': 'brand', '厂商': 'brand',
  // modelName
  '车型': 'modelName', '型号': 'modelName', '车款': 'modelName', 'model': 'modelName',
  '产品名称': 'modelName', '产品': 'modelName', '车辆名称': 'modelName',
  // trimName
  '配置': 'trimName', '版本': 'trimName', '款型': 'trimName', 'trim': 'trimName',
  '规格': 'trimName', '车型版本': 'trimName', '配置版本': 'trimName',
  // year
  '年款': 'year', '年份': 'year', 'year': 'year', '款': 'year',
  // manufactureDate
  'manufacture_date': 'manufactureDate', 'manufacturedate': 'manufactureDate',
  'production_date': 'manufactureDate', 'productiondate': 'manufactureDate',
  'time': 'manufactureDate', '制造日期': 'manufactureDate', '生产日期': 'manufactureDate',
  '出厂日期': 'manufactureDate', '生产时间': 'manufactureDate', '制造时间': 'manufactureDate',
  '出厂时间': 'manufactureDate',
  // priceExw
  '出厂价': 'priceExw', 'EXW': 'priceExw', 'exw': 'priceExw', 'exw价格': 'priceExw',
  '出厂报价': 'priceExw', '工厂价': 'priceExw', '裸车价': 'priceExw',
  '不含税价': 'priceExw', '含税价': 'priceExw', '指导价': 'priceExw',
  '车辆价格': 'priceExw', '单价': 'priceExw', '价格': 'priceExw',
  'price': 'priceExw',
  // priceFob
  'FOB': 'priceFob', 'fob': 'priceFob', 'FOB价格': 'priceFob', 'fob价格': 'priceFob',
  'FOB价': 'priceFob', '离岸价': 'priceFob',
  // priceFca
  'FCA': 'priceFca', 'fca': 'priceFca', 'FCA价格': 'priceFca',
  // priceCif
  'CIF': 'priceCif', 'cif': 'priceCif', 'CIF价格': 'priceCif', '到岸价': 'priceCif',
  // currency
  '币种': 'currency', 'currency': 'currency',
  // color
  '颜色': 'color', '车身颜色': 'color', '外观颜色': 'color', 'color': 'color',
  // interiorColor
  '内饰颜色': 'interiorColor', '内饰': 'interiorColor',
  // batteryCapacity
  '电池容量': 'batteryCapacity', '电池': 'batteryCapacity', 'battery': 'batteryCapacity',
  '电量': 'batteryCapacity',
  // range
  '续航': 'range', '续航里程': 'range', 'CLTC': 'range', 'range': 'range',
  '纯电续航': 'range', '续航(km)': 'range',
  // location
  '提货地': 'location', '发货地': 'location', '仓库': 'location', '地点': 'location',
  '发运地': 'location', '出发港': 'location', '港口': 'location',
  // quantity / inventory
  '库存': 'quantity', '数量': 'quantity', '台数': 'quantity', '可订数量': 'quantity',
  'qty': 'quantity', '在库数量': 'quantity', '现货': 'quantity',
  // notes
  '备注': 'notes', '说明': 'notes', 'notes': 'notes', 'remark': 'notes',
  // supplier
  '供应商': 'supplierName', '经销商': 'supplierName', '报价方': 'supplierName',
  // vin
  'VIN': 'vin', 'vin': 'vin', '车架号': 'vin',
  // driveType
  '驱动': 'driveType', '驱动方式': 'driveType', '两驱': 'driveType', '四驱': 'driveType',
  // tradeTerms
  '贸易条款': 'tradeTerms', '贸易方式': 'tradeTerms',
  // steeringPosition
  '左右舵': 'steeringPosition', '方向盘': 'steeringPosition',
};

// 标准字段列表
const STANDARD_FIELDS = [
  'brand', 'modelName', 'trimName', 'year', 'manufactureDate',
  'priceExw', 'priceFob', 'priceFca', 'priceCif', 'currency',
  'color', 'interiorColor', 'batteryCapacity', 'range',
  'location', 'quantity', 'notes', 'supplierName',
  'vin', 'driveType', 'tradeTerms', 'steeringPosition',
];

/**
 * 规范化列名
 */
function normalizeHeaderCell(raw) {
  if (!raw) return null;
  const cleaned = String(raw).trim()
    .replace(/\s+/g, '')
    .replace(/[（）]/g, s => s === '（' ? '(' : ')')
    .replace(/\n/g, '');
  // Exact match
  if (HEADER_ALIASES[cleaned]) return HEADER_ALIASES[cleaned];
  // Case-insensitive
  const lower = cleaned.toLowerCase();
  for (const [alias, field] of Object.entries(HEADER_ALIASES)) {
    if (alias.toLowerCase() === lower) return field;
  }
  // Partial match
  for (const [alias, field] of Object.entries(HEADER_ALIASES)) {
    if (cleaned.includes(alias) || alias.includes(cleaned)) return field;
  }
  return null;
}

/**
 * 推断供应商名（从文件名中的路径提取）
 */
function inferSupplier(filename) {
  // 文件名格式：品牌__供应商__子目录__文件名.xlsx
  const parts = filename.replace(/\.[^.]+$/, '').split('__');
  if (parts.length >= 2) return parts[1];
  return '';
}

/**
 * 推断品牌（从文件名中的路径提取）
 */
function inferBrand(filename) {
  const parts = filename.replace(/\.[^.]+$/, '').split('__');
  if (parts.length >= 1) return parts[0];
  return '';
}

/**
 * 解析单个 Excel 文件
 */
function parseExcelFile(filePath) {
  const workbook = XLSX.readFile(filePath, { type: 'file', cellDates: true });
  const filename = path.basename(filePath);
  const supplier = inferSupplier(filename);
  const brand = inferBrand(filename);
  const allRows = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    if (jsonData.length < 2) continue;

    // Find header row (first row with ≥3 recognizable headers)
    let headerRowIdx = -1;
    let headerMap = {};

    for (let i = 0; i < Math.min(10, jsonData.length); i++) {
      const row = jsonData[i];
      const mapped = {};
      let matchCount = 0;
      for (let j = 0; j < row.length; j++) {
        const field = normalizeHeaderCell(row[j]);
        if (field) {
          mapped[j] = field;
          matchCount++;
        }
      }
      if (matchCount >= 2) {
        headerRowIdx = i;
        headerMap = mapped;
        break;
      }
    }

    if (headerRowIdx < 0) {
      // No recognizable headers — treat as raw text for Gemini
      allRows.push({
        _source: filePath,
        _sheet: sheetName,
        _type: 'unstructured',
        _rawText: jsonData.map(r => r.join('\t')).join('\n'),
        brand: brand || '',
        supplierName: supplier || '',
      });
      continue;
    }

    // Parse data rows
    for (let i = headerRowIdx + 1; i < jsonData.length; i++) {
      const row = jsonData[i];
      if (!row || row.every(c => !c && c !== 0)) continue;

      const candidate = {
        _source: filePath,
        _sheet: sheetName,
        _rowNum: i + 1,
        _type: 'structured',
      };

      for (const [colIdx, field] of Object.entries(headerMap)) {
        const value = row[parseInt(colIdx)];
        if (value !== undefined && value !== null && value !== '') {
          candidate[field] = typeof value === 'number' ? value : String(value).trim();
        }
      }

      // Fill defaults from path
      if (!candidate.brand) candidate.brand = brand;
      if (!candidate.supplierName) candidate.supplierName = supplier;

      // Skip empty rows (no price or model info)
      if (!candidate.modelName && !candidate.priceExw && !candidate.priceFob && !candidate.trimName) {
        continue;
      }

      allRows.push(candidate);
    }
  }

  return allRows;
}

/**
 * 批量处理 excels 目录
 */
function processAllExcels() {
  if (!fs.existsSync(EXCELS_DIR)) {
    console.log('⚠️  No excels directory found');
    return [];
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const files = fs.readdirSync(EXCELS_DIR).filter(f => /\.(xlsx|xls|csv)$/i.test(f));
  const allResults = [];

  console.log(`\n📊 Processing ${files.length} Excel files...\n`);

  for (const file of files) {
    const filePath = path.join(EXCELS_DIR, file);
    try {
      const rows = parseExcelFile(filePath);
      console.log(`  ✅ ${file}: ${rows.length} rows`);

      // Save per-file JSON
      const outputPath = path.join(OUTPUT_DIR, file.replace(/\.[^.]+$/, '.json'));
      fs.writeFileSync(outputPath, JSON.stringify(rows, null, 2), 'utf-8');

      allResults.push({
        source: filePath,
        outputPath,
        rowCount: rows.length,
        rows,
      });
    } catch (err) {
      console.error(`  ❌ ${file}: ${err.message}`);
    }
  }

  // Write combined manifest
  const manifestPath = path.join(OUTPUT_DIR, 'manifest.json');
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

// Run if called directly
if (require.main === module) {
  processAllExcels();
}

module.exports = {
  parseExcelFile,
  processAllExcels,
  HEADER_ALIASES,
  STANDARD_FIELDS,
  normalizeHeaderCell,
};
