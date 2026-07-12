import re

with open('server/sourceImports.js', 'r') as f:
    content = f.read()

# 1. Update callOpenRouterSourceImportAi
content = content.replace(
    'async function callOpenRouterSourceImportAi({ filePath, file, text, context, mode, config, experiences }) {',
    'async function callOpenRouterSourceImportAi({ filePath, file, text, context, mode, config, experiences, abortSignal }) {'
)
content = content.replace(
    'const timeoutId = setTimeout(() => controller.abort(), 300000)',
    'const timeoutId = setTimeout(() => controller.abort(), 300000)\n  const onExternalAbort = () => {\n    clearTimeout(timeoutId)\n    controller.abort()\n  }\n  if (abortSignal) abortSignal.addEventListener(\'abort\', onExternalAbort)'
)
content = content.replace(
    '  } catch (error) {\n    clearTimeout(timeoutId)\n    if (error.name === \'AbortError\') throw new Error(\'OpenRouter AI 解析超时，请稍后重试或更换更稳定的视觉模型\')\n    throw error\n  } finally {\n    clearTimeout(timeoutId)\n  }',
    '  } catch (error) {\n    if (abortSignal) abortSignal.removeEventListener(\'abort\', onExternalAbort)\n    clearTimeout(timeoutId)\n    if (error.name === \'AbortError\') throw new Error(\'OpenRouter AI 解析超时或已取消\')\n    throw error\n  } finally {\n    if (abortSignal) abortSignal.removeEventListener(\'abort\', onExternalAbort)\n    clearTimeout(timeoutId)\n  }'
)

# 2. Update callOpenAiSourceImportAi
content = content.replace(
    'async function callOpenAiSourceImportAi({ filePath, file, text, context, mode, config, experiences }) {',
    'async function callOpenAiSourceImportAi({ filePath, file, text, context, mode, config, experiences, abortSignal }) {'
)
content = content.replace(
    'const timeoutId = setTimeout(() => controller.abort(), 300000)\n  let response',
    'const timeoutId = setTimeout(() => controller.abort(), 300000)\n  const onExternalAbort = () => {\n    clearTimeout(timeoutId)\n    controller.abort()\n  }\n  if (abortSignal) abortSignal.addEventListener(\'abort\', onExternalAbort)\n  let response'
)
content = content.replace(
    '  } catch (error) {\n    clearTimeout(timeoutId)\n    if (error.name === \'AbortError\') throw new Error(\'AI 解析超时，请稍后重试或使用更小的图片\')\n    throw error\n  }\n  clearTimeout(timeoutId)',
    '  } catch (error) {\n    if (abortSignal) abortSignal.removeEventListener(\'abort\', onExternalAbort)\n    clearTimeout(timeoutId)\n    if (error.name === \'AbortError\') throw new Error(\'AI 解析超时或已取消\')\n    throw error\n  }\n  if (abortSignal) abortSignal.removeEventListener(\'abort\', onExternalAbort)\n  clearTimeout(timeoutId)'
)

# 3. Update callGeminiSourceImportAi
content = content.replace(
    'async function callGeminiSourceImportAi({ filePath, file, text, context, mode, config, experiences }) {',
    'async function callGeminiSourceImportAi({ filePath, file, text, context, mode, config, experiences, abortSignal }) {'
)
content = content.replace(
    'const timeoutId = setTimeout(() => controller.abort(), 180000)\n  let response',
    'const timeoutId = setTimeout(() => controller.abort(), 180000)\n  const onExternalAbort = () => {\n    clearTimeout(timeoutId)\n    controller.abort()\n  }\n  if (abortSignal) abortSignal.addEventListener(\'abort\', onExternalAbort)\n  let response'
)
content = content.replace(
    '  } catch (error) {\n    if (error.name === \'AbortError\') throw new Error(\'Gemini AI 解析超时，请稍后重试\')\n    throw error\n  } finally {\n    clearTimeout(timeoutId)\n  }',
    '  } catch (error) {\n    if (abortSignal) abortSignal.removeEventListener(\'abort\', onExternalAbort)\n    if (error.name === \'AbortError\') throw new Error(\'Gemini AI 解析超时或已取消\')\n    throw error\n  } finally {\n    if (abortSignal) abortSignal.removeEventListener(\'abort\', onExternalAbort)\n    clearTimeout(timeoutId)\n  }'
)

# 4. Add fetchConfirmedExperiences & update callSourceImportAi
experiences_func = """
async function fetchConfirmedExperiences() {
  try {
    const args = ['base', '+record-list', '--base-token', process.env.FEISHU_BASE_TOKEN || FEISHU_BASE_TOKEN, '--table-id', FEISHU_EXPERIENCES_TABLE_ID, '--as', 'user', '--limit', '200', '--format', 'json']
    const result = execFileSync('lark-cli', args, { encoding: 'utf8', timeout: 15000 })
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

"""

call_source_import_ai_original = """async function callSourceImportAi({ filePath, file, text, context, mode }) {
  const config = getAiProviderConfig()
  if (!config.enabled) throw new Error(`未配置 ${config.provider} API Key，无法启用 AI 解析`)

  // 每次解析前，先从飞书拉取并同步最新的核心提示词模板至本地
  try {
    await loadPromptFromFeishu()
  } catch (err) {
    console.error('[Prompt Fetch] Sync error before parse:', err.message)
  }

  let rawJson
  const experiences = undefined
  if (config.provider === 'gemini') {
    rawJson = await callGeminiSourceImportAi({ filePath, file, text, context, mode, config, experiences })
  } else if (config.provider === 'openrouter') {
    rawJson = await callOpenRouterSourceImportAi({ filePath, file, text, context, mode, config, experiences })
  } else {
    rawJson = await callOpenAiSourceImportAi({ filePath, file, text, context, mode, config, experiences })
  }
  
  const json = normalizeAiParseEnvelope(rawJson)
  if (!json || !Array.isArray(json.candidates)) {
    throw new Error('AI 返回格式无效，未得到候选车源数组')
  }

  const processedCandidates = json.candidates
    .map((candidate, index) => sanitizeAiCandidate(candidate, index, context))
    .filter(candidateHasBusinessSignal)

  // 后置兜底经验匹配已完整删除，一切交由大解析系统提示词自进化与重构规则决定

  return {"""

call_source_import_ai_new = experiences_func + """async function callSourceImportAi({ filePath, file, text, context, mode, abortSignal }) {
  const config = getAiProviderConfig()
  if (!config.enabled) throw new Error(`未配置 ${config.provider} API Key，无法启用 AI 解析`)

  // 每次解析前，先从飞书拉取最新提示词，并拉取所有状态为 confirmed 的经验用作代码兜底
  let experienceRules = []
  try {
    await loadPromptFromFeishu()
    experienceRules = await fetchConfirmedExperiences()
  } catch (err) {
    console.error('[Prompt/Experience Fetch] Sync error before parse:', err.message)
  }

  let rawJson
  const experiences = undefined // 交由大解析系统提示词自进化与重构规则决定，此处不注入文本
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

  // 恢复后置兜底经验匹配（第二道防线）
  if (experienceRules.length > 0) {
    for (const rule of experienceRules) {
      if (!rule.field || !rule.originalValue || !rule.correctedValue) continue
      for (const candidate of processedCandidates) {
        if (candidate[rule.field] !== undefined && candidate[rule.field] !== null) {
          const currentVal = String(candidate[rule.field]).trim()
          const targetVal = String(rule.originalValue).trim()
          // 若 AI 解析的字段值与经验的 originalValue 完全匹配，或互相包含且长度>2，则强行覆写
          if (currentVal === targetVal || (currentVal.length > 2 && targetVal.length > 2 && (currentVal.includes(targetVal) || targetVal.includes(currentVal)))) {
            process.stderr.write(`[Experience Override] Corrected candidate [${rule.field}] from ${currentVal} to ${rule.correctedValue}\\n`)
            candidate[rule.field] = rule.correctedValue
          }
        }
      }
    }
  }

  return {"""

content = content.replace(call_source_import_ai_original, call_source_import_ai_new)

# 5. Update parseFileWithOptionalAi
content = content.replace(
    'async function parseFileWithOptionalAi({ file, storedPath, extension, context, aiMode }) {',
    'async function parseFileWithOptionalAi({ file, storedPath, extension, context, aiMode, abortSignal }) {'
)
content = content.replace(
    '      mode: [\'.xlsx\', \'.xls\', \'.txt\'].includes(extension) ? \'text_or_table_semantic_parse\' : \'image_ocr_and_semantic_parse\',\n    })',
    '      mode: [\'.xlsx\', \'.xls\', \'.txt\'].includes(extension) ? \'text_or_table_semantic_parse\' : \'image_ocr_and_semantic_parse\',\n      abortSignal\n    })'
)

# 6. Update POST /api/source-imports/batches
content = content.replace(
    "      db.exec('ROLLBACK')\n      throw error\n    }\n\n    const batchDir = resolve(sourceImportDir, String(batchId))",
    "      db.exec('ROLLBACK')\n      throw error\n    }\n\n    const abortController = new AbortController()\n    const onClientDisconnect = () => {\n      console.log(`[API] Client disconnected, aborting AI parse request for batch ${batchId}...`)\n      abortController.abort()\n    }\n    req.on('close', onClientDisconnect)\n\n    const batchDir = resolve(sourceImportDir, String(batchId))"
)
content = content.replace(
    '          extension,\n          context: parserContext,\n          aiMode,\n        }))\n        parsedCandidatesForName.push(...parsed.candidates)',
    '          extension,\n          context: parserContext,\n          aiMode,\n          abortSignal: abortController.signal\n        }))\n        parsedCandidatesForName.push(...parsed.candidates)'
)

with open('server/sourceImports.js', 'w') as f:
    f.write(content)
