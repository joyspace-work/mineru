const fs = require('fs');
const path = require('path');

const INPUT_DIR = path.join(__dirname, '../input');
const CLASSIFIED_DIR = path.join(INPUT_DIR, 'classified');

// ──────────────────────────────────────────────
// 分类规则：所有文件类型都保留，按扩展名分桶
// ──────────────────────────────────────────────
const BUCKETS = {
  images:       ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tiff', '.svg'],
  pdfs:         ['.pdf'],
  excels:       ['.xlsx', '.xls', '.csv'],
  documents:    ['.docx', '.doc', '.rtf'],
  presentations:['.pptx', '.ppt'],
  texts:        ['.txt', '.md'],
};

// 需要删除的：系统垃圾 + 视频文件（不需要）
const JUNK_NAMES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);
const JUNK_EXTENSIONS = new Set(['.db', '.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv']);

// Build reverse map: extension -> bucket
const EXT_TO_BUCKET = {};
for (const [bucket, exts] of Object.entries(BUCKETS)) {
  for (const ext of exts) {
    EXT_TO_BUCKET[ext] = bucket;
  }
}

// Create all target directories
for (const bucket of Object.keys(BUCKETS)) {
  fs.mkdirSync(path.join(CLASSIFIED_DIR, bucket), { recursive: true });
}
fs.mkdirSync(path.join(CLASSIFIED_DIR, 'other'), { recursive: true });

let stats = { deleted: 0, classified: 0, skipped: 0 };

function getRelativePrefix(filePath) {
  const rel = path.relative(INPUT_DIR, filePath);
  const parts = rel.split(path.sep);
  return parts.join('__');
}

function resolveCollision(destPath) {
  if (!fs.existsSync(destPath)) return destPath;
  const ext = path.extname(destPath);
  const base = path.basename(destPath, ext);
  const dir = path.dirname(destPath);
  let counter = 1;
  let newPath;
  do {
    newPath = path.join(dir, `${base}_${counter}${ext}`);
    counter++;
  } while (fs.existsSync(newPath));
  return newPath;
}

function walkDir(currentPath) {
  if (currentPath.includes('classified')) return;
  const entries = fs.readdirSync(currentPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(currentPath, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath);
    } else {
      processFile(fullPath, entry.name);
    }
  }
}

function processFile(filePath, fileName) {
  const ext = path.extname(fileName).toLowerCase();

  // 1. 只删系统垃圾文件
  if (JUNK_NAMES.has(fileName) || JUNK_EXTENSIONS.has(ext)) {
    console.log(`🗑️  Junk: ${path.relative(INPUT_DIR, filePath)}`);
    fs.unlinkSync(filePath);
    stats.deleted++;
    return;
  }

  // 2. 删除空的 "新建 文本文档.txt"
  if (fileName === '新建 文本文档.txt') {
    const fileStats = fs.statSync(filePath);
    if (fileStats.size === 0) {
      console.log(`🗑️  Empty placeholder: ${path.relative(INPUT_DIR, filePath)}`);
      fs.unlinkSync(filePath);
      stats.deleted++;
      return;
    }
  }

  // 3. 分类到对应桶，未知类型放 other/
  const bucket = EXT_TO_BUCKET[ext] || 'other';
  const prefixedName = getRelativePrefix(filePath);
  let destPath = path.join(CLASSIFIED_DIR, bucket, prefixedName);
  destPath = resolveCollision(destPath);

  console.log(`📁 ${bucket}: ${path.relative(INPUT_DIR, filePath)}`);
  fs.renameSync(filePath, destPath);
  stats.classified++;
}

console.log('🚀 Starting input cleaning and classification...\n');
walkDir(INPUT_DIR);

// Clean up empty source directories (not classified/)
function removeEmptyDirs(dir) {
  if (dir.includes('classified')) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      removeEmptyDirs(path.join(dir, entry.name));
    }
  }
  const remaining = fs.readdirSync(dir);
  if (remaining.length === 0 && dir !== INPUT_DIR) {
    fs.rmdirSync(dir);
  }
}
removeEmptyDirs(INPUT_DIR);

// Print summary
console.log(`\n✅ Classification complete!`);
console.log(`   Deleted (junk only): ${stats.deleted} files`);
console.log(`   Classified: ${stats.classified} files`);
console.log(`   Skipped: ${stats.skipped} files`);
console.log(`\n📂 Classified directories:`);
for (const bucket of [...Object.keys(BUCKETS), 'other']) {
  const dir = path.join(CLASSIFIED_DIR, bucket);
  if (fs.existsSync(dir)) {
    const count = fs.readdirSync(dir).length;
    if (count > 0) console.log(`   ${bucket}/: ${count} files`);
  }
}
