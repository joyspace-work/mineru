import re

with open('src/App.tsx', 'r') as f:
    content = f.read()

# 1. Add importAbortController state
content = content.replace(
    '  const [refiningPrompt, setRefiningPrompt] = useState(false)',
    '  const [refiningPrompt, setRefiningPrompt] = useState(false)\n  const [importAbortController, setImportAbortController] = useState<AbortController | null>(null)'
)

# 2. Update uploadBatch
upload_batch_original = """  async function uploadBatch(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const form = new FormData()
      form.append('supplierName', supplierName)
      form.append('snapshotTime', snapshotTime)
      form.append('importedBy', importedBy)
      form.append('notes', notes)
      form.append('aiMode', effectiveAiMode)
      files.forEach((file) => form.append('files', file))
      const response = await api<{ batch: SourceImportBatch }>('/api/source-imports/batches', {
        method: 'POST',
        body: form,
      })
      setSupplierName('')
      setNotes('')
      setFiles([])
      setSelectedBatchId(response.batch.id)
      await loadList()
      await loadBatch(response.batch.id)
    } catch (uploadError) {
      setError(uploadError instanceof Error ? `导入失败: ${uploadError.message}` : '导入失败')
    } finally {
      setBusy(false)
    }
  }"""

upload_batch_new = """  async function uploadBatch(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const abortCtrl = new AbortController()
    setImportAbortController(abortCtrl)
    try {
      const form = new FormData()
      form.append('supplierName', supplierName)
      form.append('snapshotTime', snapshotTime)
      form.append('importedBy', importedBy)
      form.append('notes', notes)
      form.append('aiMode', effectiveAiMode)
      files.forEach((file) => form.append('files', file))
      const response = await api<{ batch: SourceImportBatch }>('/api/source-imports/batches', {
        method: 'POST',
        body: form,
        signal: abortCtrl.signal,
      })
      setSupplierName('')
      setNotes('')
      setFiles([])
      setSelectedBatchId(response.batch.id)
      await loadList()
      await loadBatch(response.batch.id)
    } catch (uploadError: any) {
      if (uploadError.name === 'AbortError') {
        setError('导入已取消')
      } else {
        setError(uploadError instanceof Error ? `导入失败: ${uploadError.message}` : '导入失败')
      }
    } finally {
      setBusy(false)
      setImportAbortController(null)
    }
  }"""

content = content.replace(upload_batch_original, upload_batch_new)

# 3. Update the button UI
button_original = """        <button disabled={busy || !supplierName || files.length === 0} type="submit">
          <Upload size={16} />
          {busy ? '导入中...' : '导入并解析'}
        </button>"""

button_new = """        <div style={{ display: 'flex', gap: '8px' }}>
          <button disabled={busy || !supplierName || files.length === 0} type="submit" style={{ flex: 1 }}>
            <Upload size={16} />
            {busy ? '导入中...' : '导入并解析'}
          </button>
          {busy && importAbortController && (
            <button 
              type="button" 
              onClick={() => importAbortController.abort()}
              style={{ background: '#dc3545', color: '#fff', border: 'none' }}
            >
              取消解析
            </button>
          )}
        </div>"""

content = content.replace(button_original, button_new)

with open('src/App.tsx', 'w') as f:
    f.write(content)

