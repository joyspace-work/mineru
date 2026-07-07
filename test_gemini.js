import { readFileSync } from 'node:fs';

const apiKey = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_SOURCE_IMPORT_MODEL || 'gemini-2.5-flash';

console.log('Using Gemini Config (Direct Native API):');
console.log('Model:', model);
console.log('API Key length:', apiKey ? apiKey.length : 0);

if (!apiKey) {
  console.error('Error: GEMINI_API_KEY is not defined in env.');
  console.error('Please get a FREE API Key from Google AI Studio (https://aistudio.google.com/)');
  console.error('and add it to your .env file:');
  console.error('AI_PROVIDER=gemini');
  console.error('GEMINI_API_KEY=your_key_here');
  process.exit(1);
}

const imagePath = 'data/source-imports/8/1783397025145-d1ad4b30829a7c22a8aad57d4d60165d.png';
const base64Image = readFileSync(imagePath).toString('base64');

const prompt = [
  '你是车源导入解析助手。请把供应商发来的车源资料解析为严格 JSON。',
  '只输出一个 JSON 对象，不要输出解释文字。顶层必须包含 candidates 数组。',
  '顶层格式必须是：{"rawText":"","parserNotes":"","candidates":[...]}。',
  '字段必须使用：brand, modelName, year, trimName, exteriorColor, interiorColor, stockQuantity, supplierPrice, currency, tradeTerm, location, preorderMinDays, preorderMaxDays, canPreorder, notes, rawText, rawFields, confidence, uncertainFields。',
  '如果供应商把多个信息 write 在同一格或同一句话里，请按业务含义拆字段。',
  '如果价格口径不确定、车型库可能不匹配、颜色缩写不确定，请保留原文并把字段名写入 uncertainFields。',
  '不要编造看不到的信息；库存数量不明确时填 0；价格不明确时填 0。',
  `供应商：测试供应商`,
  `解析模式：image_ocr_and_semantic_parse`,
].join('\n\n');

// Build native Gemini payload
const requestBody = {
  contents: [
    {
      parts: [
        { text: prompt },
        {
          inlineData: {
            mimeType: 'image/png',
            data: base64Image
          }
        }
      ]
    }
  ],
  generationConfig: {
    responseMimeType: 'application/json',
  }
};

const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

console.log('Sending request to Gemini via Native API...');

try {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  console.log('Response status:', response.status, response.statusText);
  const body = await response.json();
  if (response.ok) {
    console.log('SUCCESS!');
    const contentText = body.candidates?.[0]?.content?.parts?.[0]?.text;
    console.log('Output length:', contentText ? contentText.length : 0);
    console.log('Response JSON parsed successfully:');
    try {
      const parsed = JSON.parse(contentText);
      console.log('Parsed candidates count:', parsed.candidates?.length);
      console.log('Sample Candidate:', JSON.stringify(parsed.candidates?.[0], null, 2));
    } catch (err) {
      console.log('Warning: Response text was not valid JSON:', err.message);
    }
    process.exit(0);
  } else {
    console.log('FAILED!');
    console.log('Error payload:', JSON.stringify(body, null, 2));
    process.exit(1);
  }
} catch (err) {
  console.error('Fetch error:', err);
  process.exit(1);
}
