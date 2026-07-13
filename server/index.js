import bcrypt from 'bcryptjs'
import cookieParser from 'cookie-parser'
import express from 'express'
import jwt from 'jsonwebtoken'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setupSourceImportWorkbench, initSourceImportTables } from './sourceImports.js'
import { runMigrations } from './migrations.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataDir = resolve(__dirname, '../data')
mkdirSync(dataDir, { recursive: true })

const db = new DatabaseSync(resolve(dataDir, 'ev-export.db'))
const app = express()
const port = Number(process.env.API_PORT || 3001)
const jwtSecret = process.env.JWT_SECRET || 'local-development-secret-change-before-deploying'

const FEISHU_BASE_TOKEN = process.env.FEISHU_BASE_TOKEN || 'Xvdfbpk7cadLrnsVCFFcHbhOnCb'
const FEISHU_VEHICLES_TABLE_ID = process.env.FEISHU_VEHICLES_TABLE_ID || 'tblTKcuyW7AuZ9nd'

app.use(express.json())
app.use(cookieParser())

// CORS - allow frontend to access API
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.header('Access-Control-Allow-Credentials', 'true')
  if (_req.method === 'OPTIONS') return res.status(204).end()
  console.log('[Global Request]', _req.method, _req.url)
  next()
})

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'sales', 'partner', 'customer')),
    customer_id TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`)

initSourceImportTables(db)
runMigrations(db)

const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count
if (userCount === 0) {
  const insertUser = db.prepare(`INSERT INTO users (username, password_hash, display_name, role, customer_id) VALUES (?, ?, ?, ?, ?)`)
  insertUser.run('admin', bcrypt.hashSync('Admin123!', 10), '中国管理员', 'admin', null)
  insertUser.run('partner', bcrypt.hashSync('Partner123!', 10), '埃塞俄比亚合伙人', 'partner', 'CUS-001')
  insertUser.run('customer', bcrypt.hashSync('Customer123!', 10), 'Addis Fleet Trading', 'customer', 'CUS-001')
  insertUser.run('sales', bcrypt.hashSync('Sales123!', 10), '中国销售', 'sales', null)
}

function createToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, displayName: user.display_name, role: user.role, customerId: user.customer_id },
    jwtSecret,
    { expiresIn: '12h' },
  )
}

function requireAuth(req, res, next) {
  try {
    const tokenUser = jwt.verify(req.cookies.ev_session, jwtSecret)
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(tokenUser.sub)
    if (!user || !user.is_active) {
      res.clearCookie('ev_session')
      return res.status(401).json({ error: '账号已停用或不存在' })
    }
    req.user = { id: Number(user.id), username: user.username, displayName: user.display_name, role: user.role, customerId: user.customer_id }
    next()
  } catch {
    res.status(401).json({ error: '请先登录' })
  }
}

function publicUser(user) {
  return { id: user.id === undefined ? undefined : Number(user.id), username: user.username, displayName: user.displayName ?? user.display_name, role: user.role, customerId: user.customerId ?? user.customer_id ?? null }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: '权限不足' })
    next()
  }
}

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body ?? {}
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username)
  if (!user || !user.is_active || !bcrypt.compareSync(String(password ?? ''), user.password_hash)) {
    return res.status(401).json({ error: '账号或密码错误' })
  }
  const token = createToken(user)
  res.cookie('ev_session', token, { httpOnly: true, sameSite: 'lax', secure: false, maxAge: 12 * 60 * 60 * 1000 })
  res.json({ user: publicUser({ id: user.id, username: user.username, displayName: user.display_name, role: user.role, customerId: user.customer_id }) })
})

app.post('/api/auth/logout', (_req, res) => { res.clearCookie('ev_session'); res.status(204).end() })
app.get('/api/auth/me', requireAuth, (req, res) => { res.json({ user: publicUser(req.user) }) })

app.get('/api/settings/exchange-rate', requireAuth, (req, res) => {
  const row = db.prepare("SELECT value FROM system_settings WHERE key = 'exchange_rate'").get()
  res.json({ exchangeRate: Number(row?.value ?? 7.2) })
})

app.post('/api/settings/exchange-rate', requireAuth, requireRole('admin', 'sales'), (req, res) => {
  const rate = Number(req.body?.exchangeRate)
  if (!rate || isNaN(rate) || rate <= 0) return res.status(400).json({ error: '请输入有效的正数汇率' })
  db.prepare("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('exchange_rate', ?)").run(String(rate))
  res.json({ exchangeRate: rate })
})

app.get('/api/feishu-vehicles', requireAuth, async (req, res) => {
  try {
    const result = execSync(
      `lark-cli base +record-list --base-token ${FEISHU_BASE_TOKEN} --table-id ${FEISHU_VEHICLES_TABLE_ID} --as user --limit 200 --format json`,
      { encoding: 'utf8', timeout: 30000 },
    )
    const parsed = JSON.parse(result)
    if (!parsed.ok) return res.status(500).json({ error: '飞书查询失败' })
    const isInternal = req.user.role === 'admin' || req.user.role === 'sales'
    const rawData = parsed.data?.data || []
    const fieldNames = parsed.data?.fields || []
    const vehicles = rawData.map((record) => {
      const fields = {}
      if (Array.isArray(record)) { fieldNames.forEach((name, i) => { fields[name] = record[i] }) }
      else if (record.fields) { Object.assign(fields, record.fields) }
      return {
        recordId: record._record_id || record.record_id || '',
        vehicleId: fields['Vehicle ID'] || '',
        brand: fields['Brand'] || '',
        model: fields['Model'] || '',
        year: fields['Year'] || '',
        trim: fields['Trim'] || '',
        exteriorColor: fields['Exterior Color'] || '',
        interiorColor: fields['Interior Color'] || '',
        stockQuantity: Number(fields['Stock Quantity']) || 0,
        costExw: isInternal ? (fields['Cost (EXW)'] ?? null) : null,
        costFob: isInternal ? (fields['Cost (FOB)'] ?? null) : null,
        costFca: isInternal ? (fields['Cost (FCA)'] ?? null) : null,
        tradeTerm: fields['Trade Term'] || '',
        energyType: fields['Energy Type'] || '',
        batteryKwh: fields['Battery (kWh)'] ? Number(fields['Battery (kWh)']) : null,
        rangeKm: fields['Range (km)'] ? Number(fields['Range (km)']) : null,
        location: fields['Location'] || '',
        supplier: fields['Supplier'] || '',
        leadTime: fields['Lead Time'] || '',
        status: fields['Status'] || '',
        recorder: fields['Recorder'] || '',
        publicNotes: fields['Public Notes'] || '',
        isListed: Boolean(fields['Is Listed']),
      }
    })
    res.json({ vehicles })
  } catch (err) {
    console.error('[Feishu] ERROR:', err.message)
    res.status(500).json({ error: '查询飞书车辆数据失败' })
  }
})

setupSourceImportWorkbench({ app, db, requireAuth, requireRole, dataDir })

app.get('/api/bootstrap', requireAuth, (req, res) => {
  const user = req.user
  const isInternal = user.role === 'admin' || user.role === 'sales'
  const rateRow = db.prepare("SELECT value FROM system_settings WHERE key = 'exchange_rate'").get()
  res.json({ user: publicUser(user), exchangeRate: Number(rateRow?.value ?? 7.2), permissions: { canSeeCost: isInternal } })
})

app.listen(port, '0.0.0.0', () => {
  console.log(`EV Export API listening on http://localhost:${port}`)
})
