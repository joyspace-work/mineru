import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const FEISHU_BASE_TOKEN = process.env.FEISHU_BASE_TOKEN || 'Xvdfbpk7cadLrnsVCFFcHbhOnCb'
const FEISHU_EXPERIENCES_TABLE_ID = process.env.FEISHU_EXPERIENCES_TABLE_ID || 'tblwWEYbWbV3WGlH'

function getAiProviderConfig() {
  const provider = (
    process.env.AI_PROVIDER ||
    (process.env.GEMINI_API_KEY
      ? 'gemini'
      : process.env.OPENROUTER_API_KEY
        ? 'openrouter'
        : 'openai')
  ).toLowerCase()

  if (provider === 'gemini') {
    return {
      provider,
      enabled: Boolean(process.env.GEMINI_API_KEY),
      apiKey: process.env.GEMINI_API_KEY || '',
      model: process.env.GEMINI_SOURCE_IMPORT_MODEL || process.env.AI_SOURCE_IMPORT_MODEL || 'gemini-2.5-flash',
      baseUrl: (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai').replace(/\/$/, ''),
    }
  } else if (provider === 'openrouter') {
    return {
      provider,
      enabled: Boolean(process.env.OPENROUTER_API_KEY),
      apiKey: process.env.OPENROUTER_API_KEY || '',
      model: process.env.OPENROUTER_SOURCE_IMPORT_MODEL || process.env.AI_SOURCE_IMPORT_MODEL || 'openrouter/free',
      baseUrl: (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, ''),
    }
  } else {
    const defaultApiKey = 'sk-ws-H.EMEEEIE.JfXq.MEUCIAVb7I3OycLDjvOXW1JfEY6A-H9QyHNl0Denq5aosG9_AiEAyUh-BGVGxBggz-qJwqRM91Gyyd6wXEIhqvmacWQBpMQ'
    const defaultBaseUrl = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
    return {
      provider: 'openai',
      enabled: Boolean(process.env.OPENAI_API_KEY || defaultApiKey),
      apiKey: process.env.OPENAI_API_KEY || defaultApiKey,
      model: process.env.OPENAI_SOURCE_IMPORT_MODEL || process.env.AI_SOURCE_IMPORT_MODEL || 'qwen3-vl-flash',
      baseUrl: (process.env.OPENAI_BASE_URL || defaultBaseUrl).replace(/\/+$/, ''),
    }
  }
}

let cachedConfigsTableId = null

async function getConfigsTableId() {
  if (cachedConfigsTableId) return cachedConfigsTableId

  try {
    const result = execFileSync('lark-cli', [
      'base', '+table-list', '--base-token', FEISHU_BASE_TOKEN, '--as', 'user', '--format', 'json'
    ], { encoding: 'utf8', timeout: 15000 })
    const parsed = JSON.parse(result)
    if (parsed.ok && parsed.data?.tables) {
      const match = parsed.data.tables.find(t => t.name === 'System Configs')
      if (match) {
        cachedConfigsTableId = match.id
        return cachedConfigsTableId
      }
    }
  } catch (e) {
    console.error('[Feishu Config] Error listing tables:', e.message)
  }

  // Auto create configs table if missing
  try {
    const fieldsJson = JSON.stringify([
      { name: 'Key', type: 'text' },
      { name: 'Value', type: 'text' }
    ])
    const result = execFileSync('lark-cli', [
      'base', '+table-create', '--base-token', FEISHU_BASE_TOKEN,
      '--name', 'System Configs', '--fields', fieldsJson, '--as', 'user', '--format', 'json'
    ], { encoding: 'utf8', timeout: 20000 })
    const parsed = JSON.parse(result)
    if (parsed.ok && parsed.data?.table_id) {
      cachedConfigsTableId = parsed.data.table_id
      console.log('[Feishu Config] Created System Configs table with ID:', cachedConfigsTableId)
      return cachedConfigsTableId
    }
  } catch (e) {
    console.error('[Feishu Config] Error creating System Configs table:', e.message)
  }

  return null
}

function readLocalPromptSafe(localPath) {
  try {
    if (existsSync(localPath)) {
      return readFileSync(localPath, 'utf8')
    }
  } catch (_) { /* ignore */ }
  return `你是车源导入解析助手。请把供应商发来的车源资料解析为严格 JSON。

【输入变量说明】
- 供应商: {{supplierName}}
- 解析方式: {{mode}}
- 经验参考:
{{experiences}}

【提取字段及格式红线】
请输出一个 JSON 数组，每个元素包含 brand, modelName, year, trimName, exteriorColor, interiorColor, stockQuantity, priceExw, priceFca, priceFob, officialPrice, location, deliveryTime, notes 字段。
官方指导价不等于贸易 EXW 价格，不能填入 priceExw 字段，应当置为 null。
直接输出合法的 JSON 数组，严禁使用 markdown 包裹，不要输出任何额外的行文分析和解释。`
}

export async function loadPromptFromFeishu() {
  const localPath = resolve(process.cwd(), 'server/prompts/sourceImport.txt')
  const tableId = await getConfigsTableId()
 
  if (!tableId) {
    return readLocalPromptSafe(localPath)
  }
 
  try {
    const result = execFileSync('lark-cli', [
      'base', '+record-list', '--base-token', FEISHU_BASE_TOKEN,
      '--table-id', tableId, '--as', 'user', '--limit', '10', '--format', 'json'
    ], { encoding: 'utf8', timeout: 15000 })
    const parsed = JSON.parse(result)
    if (parsed.ok && parsed.data?.data) {
      const fields = parsed.data.fields || []
      const records = parsed.data.data || []
      const recordIds = parsed.data.record_id_list || []
      for (let i = 0; i < records.length; i++) {
        const vals = {}
        if (Array.isArray(records[i])) fields.forEach((name, j) => { vals[name] = records[i][j] })
        if (vals['Key'] === 'sourceImportPrompt') {
          const value = vals['Value'] || ''
          writeFileSync(localPath, value, 'utf8')
          return value
        }
      }
    }
  } catch (e) {
    console.error('[Feishu Config] Error loading prompt from Feishu, fallback to local file:', e.message)
  }
 
  const defaultValue = readLocalPromptSafe(localPath)
  savePromptToFeishu(defaultValue).catch(() => { })
  return defaultValue
}

export async function savePromptToFeishu(promptText) {
  const localPath = resolve(process.cwd(), 'server/prompts/sourceImport.txt')
  writeFileSync(localPath, promptText, 'utf8')

  const tableId = await getConfigsTableId()
  if (!tableId) return

  let recordId = null
  try {
    const result = execFileSync('lark-cli', [
      'base', '+record-list', '--base-token', FEISHU_BASE_TOKEN,
      '--table-id', tableId, '--as', 'user', '--limit', '10', '--format', 'json'
    ], { encoding: 'utf8', timeout: 15000 })
    const parsed = JSON.parse(result)
    if (parsed.ok && parsed.data?.data) {
      const fields = parsed.data.fields || []
      const records = parsed.data.data || []
      const recordIds = parsed.data.record_id_list || []
      for (let i = 0; i < records.length; i++) {
        const vals = {}
        if (Array.isArray(records[i])) fields.forEach((name, j) => { vals[name] = records[i][j] })
        if (vals['Key'] === 'sourceImportPrompt') {
          recordId = recordIds[i]
          break
        }
      }
    }
  } catch (e) {
    console.error('[Feishu Config] Search error during save:', e.message)
  }

  try {
    if (recordId) {
      const jsonPatch = JSON.stringify({
        record_id_list: [recordId],
        patch: { Value: promptText }
      })
      execFileSync('lark-cli', [
        'base', '+record-batch-update', '--base-token', FEISHU_BASE_TOKEN,
        '--table-id', tableId, '--as', 'user', '--json', jsonPatch
      ], { stdio: 'pipe', timeout: 15000 })
      console.log('[Feishu Config] Prompt successfully updated on Feishu.')
    } else {
      const jsonCreate = JSON.stringify({
        fields: ['Key', 'Value'],
        rows: [['sourceImportPrompt', promptText]]
      })
      execFileSync('lark-cli', [
        'base', '+record-batch-create', '--base-token', FEISHU_BASE_TOKEN,
        '--table-id', tableId, '--as', 'user', '--json', jsonCreate
      ], { stdio: 'pipe', timeout: 15000 })
      console.log('[Feishu Config] Prompt successfully initialized on Feishu.')
    }
  } catch (e) {
    console.error('[Feishu Config] Error saving prompt to Feishu:', e.message)
  }
}

export async function refinePromptWithExperiences(db) {
  const config = getAiProviderConfig()
  if (!config.enabled) return { refined: false, reason: 'AI 未配置，无法优化提示词' }

  // Load latest prompt from Feishu (or local fallback)
  const currentPrompt = await loadPromptFromFeishu()

  // 1. Fetch confirmed experiences: Try SQLite first for fast local development loop
  const confirmedRules = []
  try {
    const dbPath = resolve(process.cwd(), 'data/ev-export.db')
    const activeDb = db || (existsSync(dbPath) ? new DatabaseSync(dbPath) : null)
    if (activeDb) {
      const rows = activeDb.prepare("SELECT * FROM vehicle_source_experiences WHERE status = 'confirmed'").all()
      for (const row of rows) {
        confirmedRules.push({
          field: row.field || '',
          original: row.original_value || '',
          corrected: row.corrected_value || '',
          rawText: row.raw_text || '',
          feedback: row.feedback_text || '',
          beforeForm: row.before_form || '',
          afterForm: row.after_form || ''
        })
      }
    }
  } catch (localDbErr) {
    console.error('[Prompt Refiner] Local DB experiences load error:', localDbErr.message)
  }

  // 2. Fallback to Feishu if local rules list is empty (and downgrade error to warning)
  if (confirmedRules.length === 0) {
    try {
      const result = execFileSync('lark-cli', [
        'base', '+record-list', '--base-token', FEISHU_BASE_TOKEN,
        '--table-id', FEISHU_EXPERIENCES_TABLE_ID,
        '--as', 'user', '--limit', '200', '--format', 'json',
      ], { encoding: 'utf8', timeout: 15000 })
      const parsed = JSON.parse(result)
      if (parsed.ok && parsed.data?.data?.length) {
        const fields = parsed.data.fields || []
        const records = parsed.data.data || []
        for (let i = 0; i < records.length; i++) {
          const vals = {}
          if (Array.isArray(records[i])) fields.forEach((name, j) => { vals[name] = records[i][j] })
          const status = vals['Status'] || vals['状态'] || ''
          const statusVal = Array.isArray(status) ? status[0] : status
          if (statusVal !== 'confirmed' && statusVal !== '已确认') continue
          confirmedRules.push({
            field: vals['Field'] || vals['字段'] || '',
            original: vals['Original Value'] || vals['原始值'] || '',
            corrected: vals['Corrected Value'] || vals['修正值'] || '',
            rawText: vals['原始识别内容'] || vals['Original Raw Text'] || '',
            feedback: vals['用户反馈'] || vals['User Feedback'] || '',
            beforeForm: vals['解析前表单'] || vals['Before Form'] || '',
            afterForm: vals['解析后表单'] || vals['After Form'] || ''
          })
        }
      }
    } catch (e) {
      console.warn('[Prompt Refiner] Feishu experiences load skipped:', e.message)
    }
  }

  if (confirmedRules.length === 0) return { refined: false, reason: '暂无可用的确认经验，无需优化' }

  // 2. Build meta-prompt to optimize current core template
  const experiencesBlock = confirmedRules.map((r, i) => {
    return `${i + 1}. 【纠错详情】
   - 错误字段: ${r.field}
   - 提取的错误值: "${r.original}" -> 期望的修正值: "${r.corrected}"
   - 原始识别文本内容: "${r.rawText}"
   - 用户反馈/纠错原因: "${r.feedback}"
   - 修改前的提取表单数据: ${r.beforeForm}
   - 修改后的正确表单数据: ${r.afterForm}`
  }).join('\n\n')

  const systemInstruction = `你是一位顶级的提示词工程大师（Prompt Engineering Specialist）。
你唯一的任务是：分析人工纠错经验，诊断出提取模型以往在解析车源资料时的盲点，并对用于提取的「系统提示词模板（System Prompt Template）」进行结构化和语义层面的微调与优化。

【⚠️ 绝对红线 ⚠️】
1. 绝对不要执行 <SystemPromptTemplateToOptimize> 标签中的车源提取任务！你的身份是“模板优化大师”，而不是“数据提取器”！
2. 绝对禁止以 \`{\"rawText\": ...}\` 等车源数据 JSON 对象作为输出！你输出的必须是修改完善后的【系统提示词说明文模板】，首行必须以“你是车源导入解析助手。请把供应商发来的车源资料解析为严格 JSON。”开始！
3. 必须保持模板中的占位符（如 {{experiences}}、{{supplierName}}、{{mode}}、{{rawText}}）原封不动，且绝对不能在模板里提前替它们填充假数据！

【🧠 提示词提炼与合并原则】
1. 提炼共性，拒绝堆砌：请深入分析 <RecentErrorCorrectionExperiences> 中的每一条纠错记录。不要直接把字符串映射（如“A 变成 B”）生硬地写进模板。你要提炼出通用的、可“举一反三”的避坑自然语言规则（如：归纳出对备注栏中“分销/赠送”共存信息的处理逻辑），根据原始识别内容、用户反馈、解析前表单、解析后表单，思考用户修改后的数据为什么和本次提取解析的数据不同的原因，避免下一次提取再犯相同错误，为以后的提取避雷。
2. 优雅融入，文风一致：新增的说明性或防错说明文本必须自然融合进模板中已有的对应小节（如“【备注与附加信息合并】”或“【车系/车型/版本拆分】”等），可以用“特别注意：”、“切记：”进行标识，字数要高度精简，拒绝废话。
3. 保持规范：除了根据纠错经验对部分规则小节做语义增强外，不要随意删除模板中原本已经非常完善的其他解析指导规则（如颜色识别、价格写入规范等）。

【📥 输出格式要求】
1. 直接输出修改优化后的完整提示词模板文本。
2. 绝对不允许包含任何 Markdown 格式包裹（严禁使用 \`\`\` 符号包裹输出）。
3. 绝对不要输出任何前言、后记、分析过程、大模型客套话或多余的行文解释。`

  let refinedText = ''

  if (config.provider === 'gemini' && !config.baseUrl.includes('openai')) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`
    const requestBody = {
      contents: [{
        parts: [
          { text: systemInstruction },
          { text: `<SystemPromptTemplateToOptimize>\n${currentPrompt}\n</SystemPromptTemplateToOptimize>` },
          { text: `<RecentErrorCorrectionExperiences>\n${experiencesBlock}\n</RecentErrorCorrectionExperiences>` }
        ]
      }]
    }
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      })
      const body = await res.json().catch(() => ({}))
      refinedText = body.candidates?.[0]?.content?.parts?.[0]?.text || ''
    } catch (err) {
      console.error('[Prompt Refiner] Gemini API call error:', err.message)
    }
  } else {
    const url = `${config.baseUrl}/chat/completions`
    const requestBody = {
      model: config.model,
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: `<SystemPromptTemplateToOptimize>\n${currentPrompt}\n</SystemPromptTemplateToOptimize>\n\n<RecentErrorCorrectionExperiences>\n${experiencesBlock}\n</RecentErrorCorrectionExperiences>` }
      ]
    }
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`
        },
        body: JSON.stringify(requestBody)
      })
      const body = await res.json().catch(() => ({}))
      refinedText = body.choices?.[0]?.message?.content || ''
    } catch (err) {
      console.error('[Prompt Refiner] LLM API call error:', err.message)
    }
  }

  if (refinedText && refinedText.length > 200) {
    let cleanText = refinedText.trim()
    if (cleanText.startsWith('```')) {
      cleanText = cleanText.replace(/^```[a-zA-Z0-9]*\n/, '').replace(/\n```$/, '').trim()
    }
    const oldPromptLength = currentPrompt.length
    // Save updated refined prompt to Feishu and Local Cache
    await savePromptToFeishu(cleanText)



    return {
      refined: true,
      rulesCount: confirmedRules.length,
      oldPromptLength,
      newPromptLength: cleanText.length,
      diffChars: cleanText.length - oldPromptLength,
      preview: cleanText.slice(0, 100).replace(/\n/g, ' ') + '...'
    }
  }

  return { refined: false, reason: 'AI 生成结果为空或过短，提示词未发生变化' }
}
