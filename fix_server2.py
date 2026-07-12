import re

with open('server/sourceImports.js', 'r') as f:
    content = f.read()

# Replace callSourceImportAi and insert fetchConfirmedExperiences
new_funcs = """async function fetchConfirmedExperiences() {
  try {
    const args = ['base', '+record-list', '--base-token', process.env.FEISHU_BASE_TOKEN || FEISHU_BASE_TOKEN, '--table-id', FEISHU_EXPERIENCES_TABLE_ID, '--as', 'user', '--limit', '200', '--format', 'json']
    const result = require('child_process').execFileSync('lark-cli', args, { encoding: 'utf8', timeout: 15000 })
    const parsed = JSON.parse(result)
    if (!parsed.ok) return []
    const fields = parsed.data?.fields || []
    const records = parsed.data?.data || []
    const experiences = records.map((r, i) => {
      const vals = {}
      if (Array.isArray(r)) fields.forEach((name, j) => { vals[name] = r[j] })
      return {
        field: vals['Field'] || vals['字段'] || '',
        originalValue: vals['Original Value'] || vals['原始值'] || '',
        correctedValue: vals['Corrected Value'] || vals['修正值'] || '',
        status: vals['Status'] ? (Array.isArray(vals['Status']) ? vals['Status'][0] : vals['Status']) : (vals['状态'] ? (Array.isArray(vals['状态']) ? vals['状态'][0] : vals['状态']) : 'pending'),
      }
    })
    return experiences.filter(e => e.status === 'confirmed')
  } catch (err) {
    console.error('[Experience Fetch] Error:', err.message)
    return []
  }
}

async function callSourceImportAi({ filePath, file, text, context, mode, abortSignal }) {
  const config = getAiProviderConfig()
  if (!config.enabled) throw new Error(`未配置 ${config.provider} API Key，无法启用 AI 解析`)

  let experienceRules = []
  try {
    if (typeof loadPromptFromFeishu === 'function') {
      await loadPromptFromFeishu()
    }
    experienceRules = await fetchConfirmedExperiences()
  } catch (err) {
    console.error('[Prompt/Experience Fetch] Sync error before parse:', err.message)
  }

  let rawJson
  const experiences = undefined
  if (config.provider === 'gemini') {
    rawJson = await callGeminiSourceImportAi({ filePath, file, text, context, mode, config, experiences, abortSignal })
  } else if (config.provider === 'openrouter') {
    rawJson = await callOpenRouterSourceImportAi({ filePath, file, text, context, mode, config, experiences, abortSignal })
  } else {
    rawJson = await callOpenAiSourceImportAi({ filePath, file, text, context, mode, config, experiences, abortSignal })
  }
  
  const json = normalizeAiParseEnvelope(rawJson)
  if (!json || !Array.isArray(json.candidates)) {
    throw new Error('AI 返回格式无效，未得到候选车源数组')
  }

  const processedCandidates = json.candidates
    .map((candidate, index) => sanitizeAiCandidate(candidate, index, context))
    .filter(candidateHasBusinessSignal)

  if (experienceRules.length > 0) {
    for (const rule of experienceRules) {
      if (!rule.field || !rule.originalValue || !rule.correctedValue) continue
      for (const candidate of processedCandidates) {
        if (candidate[rule.field] !== undefined && candidate[rule.field] !== null) {
          const currentVal = String(candidate[rule.field]).trim()
          const targetVal = String(rule.originalValue).trim()
          if (currentVal === targetVal || (currentVal.length > 2 && targetVal.length > 2 && (currentVal.includes(targetVal) || targetVal.includes(currentVal)))) {
            process.stderr.write(`[Experience Override] Corrected candidate [${rule.field}] from ${currentVal} to ${rule.correctedValue}\\n`)
            candidate[rule.field] = rule.correctedValue
          }
        }
      }
    }
  }

  return {
    rawText: compactText(json.rawText || text || ''),
    parserNotes: compactText(json.parserNotes || ''),
    candidates: processedCandidates,
  }
}
"""

old_func_pattern = re.compile(r'async function callSourceImportAi\(\{ filePath, file, text, context, mode \}\) \{.*?\n\}\n', re.DOTALL)
content = old_func_pattern.sub(new_funcs, content)

with open('server/sourceImports.js', 'w') as f:
    f.write(content)

