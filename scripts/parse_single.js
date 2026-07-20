/**
 * 原子脚本：供 n8n 节点调用解析单个 Excel 文件
 */
const parseExcel = require('./parse_excel');

// 容错处理：在不同 Node/Hermes 运行时下，第一个参数可能是 argv[1] 或 argv[2]
let filePath = process.argv[2];
if (!filePath || filePath.startsWith('-')) {
  filePath = process.argv[1];
}

if (!filePath) {
  console.error(JSON.stringify({ error: "No file path provided" }));
  process.exit(1);
}

try {
  const result = parseExcel.parseExcelFile(filePath);
  console.log(JSON.stringify(result));
} catch (err) {
  console.error(JSON.stringify({ error: err.message, filePath }));
  process.exit(1);
}
