import re

with open('server/sourceImports.js', 'r') as f:
    content = f.read()

new_func = """async function callSourceImportAi({ filePath, file, text, context, mode, abortSignal }) {
  const config = getAiProviderConfig()
  if (!config.enabled) throw new Error(`未配置 ${config.provider} API Key，无法启用 AI 解析`)

  let experiences = []
  try {
    if (typeof loadPromptFromFeishu === 'function') {
      await loadPromptFromFeishu()
    }
    experiences = await fetchConfirmedExperiences()
  } catch (err) {
    console.error('[Prompt/Experience Fetch] Sync error before parse:', err.message)
  }

  let rawJson
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

  return {
    rawText: compactText(json.rawText || text || ''),
    parserNotes: compactText(json.parserNotes || ''),
    candidates: processedCandidates,
  }
}"""

old_func_pattern = re.compile(r'async function callSourceImportAi\(\{ filePath, file, text, context, mode, abortSignal \}\) \{.*?\n\}\n', re.DOTALL)
content = old_func_pattern.sub(new_func + '\n', content)

with open('server/sourceImports.js', 'w') as f:
    f.write(content)

