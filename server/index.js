import bcrypt from 'bcryptjs'
import cookieParser from 'cookie-parser'
import express from 'express'
import jwt from 'jsonwebtoken'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataDir = resolve(__dirname, '../data')
mkdirSync(dataDir, { recursive: true })

const db = new DatabaseSync(resolve(dataDir, 'ev-export.db'))
const app = express()
const port = Number(process.env.API_PORT || 3001)
const jwtSecret = process.env.JWT_SECRET || 'local-development-secret-change-before-deploying'

const VEHICLE_STATUS = {
  inStock: 'in_stock',
  preorder: 'preorder',
  unavailable: 'temporarily_unavailable',
}

const QUOTE_REQUEST_STATUS = {
  pendingReview: 'pending_review',
  customerChanged: 'customer_changed',
  quoteSent: 'quote_sent',
  revisionRequested: 'revision_requested',
  quoteAccepted: 'quote_accepted',
  piPending: 'pi_pending',
  piConfirmed: 'pi_confirmed',
}

const QUOTE_VERSION_STATUS = {
  pendingCustomerReview: 'pending_customer_review',
  accepted: 'accepted',
  replaced: 'replaced',
}

const REVISION_STATUS = {
  pending: 'pending',
  processed: 'processed',
}

const legacyStatusMap = new Map([
  ['现车', VEHICLE_STATUS.inStock],
  ['可预订', VEHICLE_STATUS.preorder],
  ['暂时缺货', VEHICLE_STATUS.unavailable],
  ['待审核', QUOTE_REQUEST_STATUS.pendingReview],
  ['客户已修改需求', QUOTE_REQUEST_STATUS.customerChanged],
  ['报价待客户审核', QUOTE_REQUEST_STATUS.quoteSent],
  ['客户要求修改', QUOTE_REQUEST_STATUS.revisionRequested],
  ['报价已接受', QUOTE_REQUEST_STATUS.quoteAccepted],
  ['PI待确认', QUOTE_REQUEST_STATUS.piPending],
  ['PI已确认', QUOTE_REQUEST_STATUS.piConfirmed],
  ['待客户审核', QUOTE_VERSION_STATUS.pendingCustomerReview],
  ['已接受', QUOTE_VERSION_STATUS.accepted],
  ['已替代', QUOTE_VERSION_STATUS.replaced],
  ['待处理', REVISION_STATUS.pending],
  ['已处理', REVISION_STATUS.processed],
])

function normalizeStatus(value) {
  return legacyStatusMap.get(value) ?? value
}

app.use(express.json())
app.use(cookieParser())

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

  CREATE TABLE IF NOT EXISTS vehicles (
    id TEXT PRIMARY KEY,
    model TEXT NOT NULL,
    trim TEXT NOT NULL,
    year TEXT NOT NULL,
    color TEXT NOT NULL,
    location TEXT NOT NULL,
    status TEXT NOT NULL,
    stock_quantity INTEGER NOT NULL DEFAULT 1,
    preorder_min_days INTEGER NOT NULL DEFAULT 7,
    preorder_max_days INTEGER NOT NULL DEFAULT 14,
    available_colors TEXT NOT NULL DEFAULT '[]',
    stock_colors TEXT NOT NULL DEFAULT '[]',
    battery_capacity TEXT NOT NULL DEFAULT '',
    range_km INTEGER NOT NULL DEFAULT 0,
    drivetrain TEXT NOT NULL DEFAULT '',
    energy_type TEXT NOT NULL DEFAULT '纯电',
    image_url TEXT NOT NULL DEFAULT '',
    public_notes TEXT NOT NULL DEFAULT '',
    price_updated_at TEXT,
    price_valid_until TEXT,
    is_listed INTEGER NOT NULL DEFAULT 1,
    vin TEXT NOT NULL,
    cost REAL NOT NULL,
    partner_price REAL NOT NULL,
    customer_price REAL NOT NULL
  );

  CREATE TABLE IF NOT EXISTS quote_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_no TEXT UNIQUE,
    customer_id TEXT NOT NULL,
    vehicle_id TEXT NOT NULL,
    vehicle_model TEXT NOT NULL,
    base_price_snapshot REAL NOT NULL,
    quantity INTEGER NOT NULL,
    suggested_profit REAL NOT NULL DEFAULT 0,
    agreed_profit REAL,
    destination_port TEXT NOT NULL,
    trade_term TEXT NOT NULL,
    freight REAL NOT NULL DEFAULT 0,
    other_fees REAL NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending_review',
    pi_number TEXT,
    assigned_to TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS quote_request_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quote_request_id INTEGER NOT NULL,
    vehicle_id TEXT NOT NULL,
    vehicle_model TEXT NOT NULL,
    vehicle_trim TEXT NOT NULL,
    vehicle_color TEXT NOT NULL,
    base_price_snapshot REAL NOT NULL,
    quantity INTEGER NOT NULL,
    suggested_profit REAL NOT NULL DEFAULT 0,
    agreed_profit REAL,
    FOREIGN KEY (quote_request_id) REFERENCES quote_requests(id)
  );

  CREATE TABLE IF NOT EXISTS quote_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quote_request_id INTEGER NOT NULL,
    version_no INTEGER NOT NULL,
    trade_term TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending_customer_review',
    change_reason TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    accepted_at TEXT,
    UNIQUE (quote_request_id, version_no),
    FOREIGN KEY (quote_request_id) REFERENCES quote_requests(id)
  );

  CREATE TABLE IF NOT EXISTS quote_version_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quote_version_id INTEGER NOT NULL,
    vehicle_id TEXT NOT NULL,
    vehicle_model TEXT NOT NULL,
    vehicle_trim TEXT NOT NULL,
    vehicle_color TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    base_price REAL NOT NULL,
    shipping_fee REAL NOT NULL DEFAULT 0,
    financing_fee REAL NOT NULL DEFAULT 0,
    customer_deposit_rate REAL NOT NULL DEFAULT 20,
    supplier_payment_rate REAL NOT NULL DEFAULT 100,
    financing_days INTEGER NOT NULL DEFAULT 30,
    monthly_financing_rate REAL NOT NULL DEFAULT 1,
    advance_amount REAL NOT NULL DEFAULT 0,
    financing_calculated INTEGER NOT NULL DEFAULT 0,
    profit REAL NOT NULL,
    FOREIGN KEY (quote_version_id) REFERENCES quote_versions(id)
  );

  CREATE TABLE IF NOT EXISTS quote_version_fees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quote_version_id INTEGER NOT NULL,
    fee_name TEXT NOT NULL,
    amount REAL NOT NULL,
    category TEXT NOT NULL DEFAULT 'other',
    FOREIGN KEY (quote_version_id) REFERENCES quote_versions(id)
  );

  CREATE TABLE IF NOT EXISTS quote_revision_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quote_request_id INTEGER NOT NULL,
    quote_version_id INTEGER,
    message TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    FOREIGN KEY (quote_request_id) REFERENCES quote_requests(id)
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient_role TEXT NOT NULL,
    recipient_username TEXT,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    related_id INTEGER,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS supplier_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id TEXT NOT NULL,
    supplier_name TEXT NOT NULL,
    stock_quantity INTEGER NOT NULL DEFAULT 0,
    stock_colors TEXT NOT NULL DEFAULT '[]',
    preorder_min_days INTEGER NOT NULL DEFAULT 7,
    preorder_max_days INTEGER NOT NULL DEFAULT 14,
    can_preorder INTEGER NOT NULL DEFAULT 1,
    supplier_price REAL NOT NULL,
    created_by TEXT NOT NULL DEFAULT 'system',
    updated_by TEXT NOT NULL DEFAULT 'system',
    updated_at TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
  );

  CREATE TABLE IF NOT EXISTS vehicle_price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id TEXT NOT NULL,
    partner_price REAL NOT NULL,
    valid_from TEXT NOT NULL,
    valid_until TEXT NOT NULL,
    changed_by TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
  );
`)

const usersTableSql = String(
  db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get()?.sql ?? '',
)
const userColumns = db.prepare('PRAGMA table_info(users)').all()
if (
  !usersTableSql.includes("'sales'") ||
  !userColumns.some((column) => column.name === 'is_active') ||
  !userColumns.some((column) => column.name === 'created_at')
) {
  db.exec('BEGIN')
  try {
    db.exec(`
      ALTER TABLE users RENAME TO users_legacy;
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('admin', 'sales', 'partner', 'customer')),
        customer_id TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO users (
        id, username, password_hash, display_name, role, customer_id, is_active, created_at
      )
      SELECT id, username, password_hash, display_name, role, customer_id, 1, CURRENT_TIMESTAMP
      FROM users_legacy;
      DROP TABLE users_legacy;
    `)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

const quoteRequestColumns = db.prepare('PRAGMA table_info(quote_requests)').all()
if (!quoteRequestColumns.some((column) => column.name === 'assigned_to')) {
  db.exec('ALTER TABLE quote_requests ADD COLUMN assigned_to TEXT')
}

const notificationColumns = db.prepare('PRAGMA table_info(notifications)').all()
if (!notificationColumns.some((column) => column.name === 'recipient_username')) {
  db.exec('ALTER TABLE notifications ADD COLUMN recipient_username TEXT')
}

const vehicleColumns = db.prepare('PRAGMA table_info(vehicles)').all()
if (!vehicleColumns.some((column) => column.name === 'stock_quantity')) {
  db.exec('ALTER TABLE vehicles ADD COLUMN stock_quantity INTEGER NOT NULL DEFAULT 1')
}
const vehicleColumnMigrations = [
  ['preorder_min_days', 'INTEGER NOT NULL DEFAULT 7'],
  ['preorder_max_days', 'INTEGER NOT NULL DEFAULT 14'],
  ['available_colors', "TEXT NOT NULL DEFAULT '[]'"],
  ['stock_colors', "TEXT NOT NULL DEFAULT '[]'"],
  ['battery_capacity', "TEXT NOT NULL DEFAULT ''"],
  ['range_km', 'INTEGER NOT NULL DEFAULT 0'],
  ['drivetrain', "TEXT NOT NULL DEFAULT ''"],
  ['energy_type', "TEXT NOT NULL DEFAULT '纯电'"],
  ['image_url', "TEXT NOT NULL DEFAULT ''"],
  ['public_notes', "TEXT NOT NULL DEFAULT ''"],
  ['price_updated_at', 'TEXT'],
  ['price_valid_until', 'TEXT'],
  ['is_listed', 'INTEGER NOT NULL DEFAULT 1'],
]
for (const [name, definition] of vehicleColumnMigrations) {
  if (!vehicleColumns.some((column) => column.name === name)) {
    db.exec(`ALTER TABLE vehicles ADD COLUMN ${name} ${definition}`)
  }
}

const supplierSourceColumns = db.prepare('PRAGMA table_info(supplier_sources)').all()
if (!supplierSourceColumns.some((column) => column.name === 'can_preorder')) {
  db.exec('ALTER TABLE supplier_sources ADD COLUMN can_preorder INTEGER NOT NULL DEFAULT 1')
}
if (!supplierSourceColumns.some((column) => column.name === 'created_by')) {
  db.exec("ALTER TABLE supplier_sources ADD COLUMN created_by TEXT NOT NULL DEFAULT 'system'")
}
if (!supplierSourceColumns.some((column) => column.name === 'updated_by')) {
  db.exec("ALTER TABLE supplier_sources ADD COLUMN updated_by TEXT NOT NULL DEFAULT 'system'")
}

const quoteVersionItemColumns = db.prepare('PRAGMA table_info(quote_version_items)').all()
if (!quoteVersionItemColumns.some((column) => column.name === 'shipping_fee')) {
  db.exec('ALTER TABLE quote_version_items ADD COLUMN shipping_fee REAL NOT NULL DEFAULT 0')
}
if (!quoteVersionItemColumns.some((column) => column.name === 'financing_fee')) {
  db.exec('ALTER TABLE quote_version_items ADD COLUMN financing_fee REAL NOT NULL DEFAULT 0')
}
const financingColumnMigrations = [
  ['customer_deposit_rate', 'REAL NOT NULL DEFAULT 20'],
  ['supplier_payment_rate', 'REAL NOT NULL DEFAULT 100'],
  ['financing_days', 'INTEGER NOT NULL DEFAULT 30'],
  ['monthly_financing_rate', 'REAL NOT NULL DEFAULT 1'],
  ['advance_amount', 'REAL NOT NULL DEFAULT 0'],
  ['financing_calculated', 'INTEGER NOT NULL DEFAULT 0'],
]
for (const [name, definition] of financingColumnMigrations) {
  if (!quoteVersionItemColumns.some((column) => column.name === name)) {
    db.exec(`ALTER TABLE quote_version_items ADD COLUMN ${name} ${definition}`)
  }
}

for (const [legacy, code] of legacyStatusMap.entries()) {
  db.prepare('UPDATE vehicles SET status = ? WHERE status = ?').run(code, legacy)
  db.prepare('UPDATE quote_requests SET status = ? WHERE status = ?').run(code, legacy)
  db.prepare('UPDATE quote_versions SET status = ? WHERE status = ?').run(code, legacy)
  db.prepare('UPDATE quote_revision_requests SET status = ? WHERE status = ?').run(code, legacy)
}

const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count
if (userCount === 0) {
  const insertUser = db.prepare(`
    INSERT INTO users (username, password_hash, display_name, role, customer_id)
    VALUES (?, ?, ?, ?, ?)
  `)
  insertUser.run('admin', bcrypt.hashSync('Admin123!', 10), '中国管理员', 'admin', null)
  insertUser.run('partner', bcrypt.hashSync('Partner123!', 10), '埃塞俄比亚合伙人', 'partner', null)
  insertUser.run(
    'customer',
    bcrypt.hashSync('Customer123!', 10),
    'Addis Fleet Trading',
    'customer',
    'CUS-001',
  )
}

db.prepare(`
  UPDATE users
  SET customer_id = 'CUS-001'
  WHERE username = 'partner' AND customer_id IS NULL
`).run()

db.prepare(`
  INSERT OR IGNORE INTO users (
    username, password_hash, display_name, role, customer_id, is_active, created_at
  ) VALUES (?, ?, ?, 'sales', NULL, 1, ?)
`).run(
  'sales',
  bcrypt.hashSync('Sales123!', 10),
  '中国销售',
  new Date().toISOString(),
)

const vehicleCount = db.prepare('SELECT COUNT(*) AS count FROM vehicles').get().count
if (vehicleCount === 0) {
  const insertVehicle = db.prepare(`
    INSERT INTO vehicles (
      id, model, trim, year, color, location, status, stock_quantity, vin,
      cost, partner_price, customer_price
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const seedVehicles = [
    ['EV-001', 'BYD Song Plus EV', '旗舰型 605KM', '2026', '冰川蓝', '深圳仓', '可售', 6, 'LGXCE6CB8R0123456', 18100, 19600, 20800],
    ['EV-002', 'Geely Galaxy E5', '530KM 探索版', '2026', '云杉绿', '广州仓', '已预订', 2, 'L6T79D2E9R0098765', 14300, 15700, 16900],
    ['EV-003', 'Changan Deepal S07', '纯电 520 Pro', '2025', '月岩灰', '重庆仓', '整备中', 4, 'LS5A2DCE2R0556677', 16950, 18400, 19700],
  ]
  for (const vehicle of seedVehicles) insertVehicle.run(...vehicle)
}

db.prepare(`
  UPDATE vehicles
  SET stock_quantity = CASE id
    WHEN 'EV-001' THEN 6
    WHEN 'EV-002' THEN 2
    WHEN 'EV-003' THEN 4
    ELSE stock_quantity
  END
`).run()

const resourceDetails = {
  'EV-001': {
    preorderMin: 10,
    preorderMax: 15,
    availableColors: ['冰川蓝', '雪域白', '曜石黑', '山脉灰'],
    stockColors: [{ color: '冰川蓝', quantity: 2 }, { color: '雪域白', quantity: 4 }],
    battery: '87 kWh',
    range: 605,
    drivetrain: '前驱',
    updatedAt: '2026-06-09T00:00:00.000Z',
    validUntil: '2026-06-23T23:59:59.000Z',
  },
  'EV-002': {
    preorderMin: 7,
    preorderMax: 12,
    availableColors: ['云杉绿', '晨雾白', '星夜黑'],
    stockColors: [{ color: '云杉绿', quantity: 2 }],
    battery: '60.22 kWh',
    range: 530,
    drivetrain: '前驱',
    updatedAt: '2026-05-20T00:00:00.000Z',
    validUntil: '2026-06-03T23:59:59.000Z',
  },
  'EV-003': {
    preorderMin: 12,
    preorderMax: 18,
    availableColors: ['月岩灰', '星云青', '极宇黄', '冷星白'],
    stockColors: [{ color: '月岩灰', quantity: 4 }],
    battery: '68.8 kWh',
    range: 520,
    drivetrain: '后驱',
    updatedAt: '2026-06-08T00:00:00.000Z',
    validUntil: '2026-06-22T23:59:59.000Z',
  },
}
const updateResourceDetails = db.prepare(`
  UPDATE vehicles
  SET preorder_min_days = ?, preorder_max_days = ?, available_colors = ?,
      stock_colors = ?, battery_capacity = ?, range_km = ?, drivetrain = ?,
      price_updated_at = COALESCE(price_updated_at, ?),
      price_valid_until = COALESCE(price_valid_until, ?)
  WHERE id = ?
`)
for (const [vehicleId, details] of Object.entries(resourceDetails)) {
  updateResourceDetails.run(
    details.preorderMin,
    details.preorderMax,
    JSON.stringify(details.availableColors),
    JSON.stringify(details.stockColors),
    details.battery,
    details.range,
    details.drivetrain,
    details.updatedAt,
    details.validUntil,
    vehicleId,
  )
}

db.prepare('UPDATE vehicles SET status = ? WHERE stock_quantity > 0').run(VEHICLE_STATUS.inStock)

const insertResourceVariant = db.prepare(`
  INSERT OR IGNORE INTO vehicles (
    id, model, trim, year, color, location, status, stock_quantity,
    preorder_min_days, preorder_max_days, available_colors, stock_colors,
    battery_capacity, range_km, drivetrain, price_updated_at, price_valid_until,
    is_listed, vin, cost, partner_price, customer_price
  ) VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
`)
insertResourceVariant.run(
  'EV-004', 'BYD Song Plus EV', '尊贵型 520KM', '2026', '颜色可选', VEHICLE_STATUS.preorder, 0,
  8, 12, JSON.stringify(['雪域白', '曜石黑', '山脉灰']), JSON.stringify([]),
  '71.8 kWh', 520, '前驱', '2026-06-09T00:00:00.000Z', '2026-06-23T23:59:59.000Z',
  'LGXCE6CB8R0456789', 16900, 18400, 19600,
)
insertResourceVariant.run(
  'EV-005', 'Geely Galaxy E5', '440KM 启航版', '2026', '颜色可选', VEHICLE_STATUS.unavailable, 0,
  10, 15, JSON.stringify(['晨雾白', '星夜黑', '云杉绿']), JSON.stringify([]),
  '49.52 kWh', 440, '前驱', '2026-05-18T00:00:00.000Z', '2026-06-01T23:59:59.000Z',
  'L6T79D2E9R0123456', 12800, 14100, 15300,
)

const supplierSourceCount = db.prepare('SELECT COUNT(*) AS count FROM supplier_sources').get().count
if (supplierSourceCount === 0) {
  const insertSource = db.prepare(`
    INSERT INTO supplier_sources (
      vehicle_id, supplier_name, stock_quantity, stock_colors,
      preorder_min_days, preorder_max_days, supplier_price, updated_at, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const sourceRows = [
    ['EV-001', '华南新能源车源 A', 2, JSON.stringify([{ color: '冰川蓝', quantity: 2 }]), 10, 12, 18100, '2026-06-09T00:00:00.000Z', '现车信息已确认'],
    ['EV-001', '全国车源渠道 B', 4, JSON.stringify([{ color: '雪域白', quantity: 4 }]), 12, 15, 18250, '2026-06-08T00:00:00.000Z', '可追加预订'],
    ['EV-002', '吉利渠道 C', 2, JSON.stringify([{ color: '云杉绿', quantity: 2 }]), 7, 12, 14300, '2026-05-20T00:00:00.000Z', '价格需重新确认'],
    ['EV-003', '西南新能源渠道 D', 4, JSON.stringify([{ color: '月岩灰', quantity: 4 }]), 12, 18, 16950, '2026-06-08T00:00:00.000Z', '支持批量预订'],
  ]
  for (const source of sourceRows) insertSource.run(...source)
}

for (const vehicle of db.prepare('SELECT id FROM vehicles').all()) {
  syncVehicleAvailability(vehicle.id)
}

const priceHistoryCount = db.prepare('SELECT COUNT(*) AS count FROM vehicle_price_history').get().count
if (priceHistoryCount === 0) {
  const insertPriceHistory = db.prepare(`
    INSERT INTO vehicle_price_history (
      vehicle_id, partner_price, valid_from, valid_until, changed_by, notes
    ) VALUES (?, ?, ?, ?, 'system', '现有价格初始化')
  `)
  for (const vehicle of db.prepare('SELECT * FROM vehicles').all()) {
    const validFrom = vehicle.price_updated_at ?? new Date().toISOString()
    const validUntil = vehicle.price_valid_until
      ?? new Date(new Date(validFrom).getTime() + 14 * 24 * 60 * 60 * 1000).toISOString()
    insertPriceHistory.run(vehicle.id, vehicle.partner_price, validFrom, validUntil)
  }
}

const inquiries = [
  {
    id: 'INQ-202606-001',
    customerId: 'CUS-001',
    customer: 'Addis Fleet Trading',
    country: 'Ethiopia',
    demand: '纯电 SUV，续航 500KM 以上，右舵非必须',
    quantity: 3,
    budget: 'USD 18,000-21,000',
    owner: 'Ethiopia Team',
    status: '已报价',
  },
  {
    id: 'INQ-202606-002',
    customerId: 'CUS-002',
    customer: 'Green Ride Addis',
    country: 'Ethiopia',
    demand: '网约车用途，优先低维护成本',
    quantity: 8,
    budget: 'USD 14,000-16,000',
    owner: 'China Sales',
    status: '待报价',
  },
]

const quotes = [
  {
    id: 'QT-001-A',
    customerId: 'CUS-001',
    inquiryId: 'INQ-202606-001',
    version: '第 1 次报价',
    date: '2026-06-01',
    model: 'BYD Song Plus EV',
    term: 'FOB Shanghai',
    unitPrice: 18500,
    freight: 0,
    total: 55500,
    status: '已过期',
    reason: '首次估价，未含海运',
  },
  {
    id: 'QT-001-B',
    customerId: 'CUS-001',
    inquiryId: 'INQ-202606-001',
    version: '第 2 次报价',
    date: '2026-06-03',
    model: 'BYD Song Plus EV',
    term: 'CIF Djibouti',
    unitPrice: 18300,
    freight: 1200,
    total: 58500,
    status: '客户考虑中',
    reason: '客户要求含海运',
  },
  {
    id: 'QT-001-C',
    customerId: 'CUS-001',
    inquiryId: 'INQ-202606-001',
    version: '最终确认报价',
    date: '2026-06-05',
    model: 'BYD Song Plus EV',
    term: 'CIF Djibouti',
    unitPrice: 18100,
    freight: 1200,
    total: 57900,
    status: 'accepted',
    reason: '批量 3 台优惠',
  },
]

const orders = [
  {
    id: 'ORD-202606-001',
    customerId: 'CUS-001',
    customer: 'Addis Fleet Trading',
    partner: 'Ethiopia Team',
    model: 'BYD Song Plus EV x 3',
    total: 57900,
    depositDue: 15000,
    status: 'deposit_received',
    quoteId: 'QT-001-C',
    eta: '2026-07-18',
    internalProfit: 3600,
    payments: [
      { id: 'PAY-001', date: '2026-06-06', type: 'deposit', amount: 10000, currency: 'USD', method: 'Bank Transfer', proof: '已上传' },
      { id: 'PAY-002', date: '2026-06-08', type: 'deposit', amount: 5000, currency: 'USD', method: 'Bank Transfer', proof: '已上传' },
    ],
  },
  {
    id: 'ORD-202606-002',
    customerId: 'CUS-002',
    customer: 'Green Ride Addis',
    partner: 'Ethiopia Team',
    model: 'Geely Galaxy E5 x 2',
    total: 31800,
    depositDue: 8000,
    status: 'deposit_pending',
    quoteId: 'QT-DRAFT',
    eta: '待确认',
    internalProfit: 2400,
    payments: [],
  },
]

const logistics = [
  { step: '客户确认订单', date: '2026-06-05', status: 'done', owner: 'Ethiopia Team' },
  { step: '定金收齐', date: '2026-06-08', status: 'done', owner: 'Finance' },
  { step: '锁定库存车辆', date: '2026-06-09', status: 'active', owner: 'China Ops' },
  { step: '车辆检测与整备', date: '预计 2026-06-12', status: 'todo', owner: 'China Ops' },
  { step: '安排拖车到港口', date: '预计 2026-06-18', status: 'todo', owner: 'Logistics' },
  { step: '装船发运', date: '预计 2026-06-25', status: 'todo', owner: 'Logistics' },
]

const quoteRequestCount = db.prepare('SELECT COUNT(*) AS count FROM quote_requests').get().count
if (quoteRequestCount === 0) {
  db.prepare(`
    INSERT INTO quote_requests (
      request_no, customer_id, vehicle_id, vehicle_model, base_price_snapshot,
      quantity, suggested_profit, agreed_profit, destination_port, trade_term,
      freight, other_fees, notes, status, pi_number, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'QR-202606-001',
    'CUS-001',
    'EV-001',
    'BYD Song Plus EV',
    19600,
    3,
    500,
    null,
    'Djibouti',
    'CIF',
    0,
    0,
    '蓝色优先，需要随车充电设备',
    QUOTE_REQUEST_STATUS.pendingReview,
    null,
    'partner',
    '2026-06-08T08:00:00.000Z',
    '2026-06-08T08:00:00.000Z',
  )
}

const quoteRequestItemCount = db.prepare('SELECT COUNT(*) AS count FROM quote_request_items').get().count
if (quoteRequestItemCount === 0) {
  const legacyRequests = db.prepare('SELECT * FROM quote_requests ORDER BY id').all()
  const insertLegacyItem = db.prepare(`
    INSERT INTO quote_request_items (
      quote_request_id, vehicle_id, vehicle_model, vehicle_trim, vehicle_color,
      base_price_snapshot, quantity, suggested_profit, agreed_profit
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const request of legacyRequests) {
    const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(request.vehicle_id)
    insertLegacyItem.run(
      request.id,
      request.vehicle_id,
      request.vehicle_model,
      vehicle?.trim ?? '',
      vehicle?.color ?? '',
      request.base_price_snapshot,
      request.quantity,
      request.suggested_profit,
      request.agreed_profit,
    )
  }
}

function createToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role,
      customerId: user.customer_id,
    },
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
    req.user = {
      id: Number(user.id),
      username: user.username,
      displayName: user.display_name,
      role: user.role,
      customerId: user.customer_id,
    }
    next()
  } catch {
    res.status(401).json({ error: '请先登录' })
  }
}

function publicUser(user) {
  return {
    id: user.id === undefined ? undefined : Number(user.id),
    username: user.username,
    displayName: user.displayName ?? user.display_name,
    role: user.role,
    customerId: user.customerId ?? user.customer_id ?? null,
  }
}

function serializeStaffUser(user) {
  return {
    id: Number(user.id),
    username: user.username,
    displayName: user.display_name,
    role: user.role,
    isActive: Boolean(user.is_active),
    createdAt: user.created_at,
  }
}

function filterByCustomer(items, user) {
  return user.role === 'customer' || user.role === 'partner'
    ? items.filter((item) => item.customerId === user.customerId)
    : items
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: '当前账号没有此操作权限' })
    }
    next()
  }
}

function canManageQuoteRequest(user, request) {
  return user.role === 'admin' || (
    user.role === 'sales' &&
    request.assigned_to === user.username
  )
}

function serializeVehicle(row, role) {
  const priceValidUntil = row.price_valid_until
  const isPriceValid =
    Boolean(priceValidUntil) && new Date(priceValidUntil).getTime() >= Date.now()
  const base = {
    id: row.id,
    model: row.model,
    trim: row.trim,
    year: row.year,
    color: row.color,
    location: row.location,
    status: normalizeStatus(row.status),
    stockQuantity: Number(row.stock_quantity),
    preorderMinDays: Number(row.preorder_min_days),
    preorderMaxDays: Number(row.preorder_max_days),
    availableColors: JSON.parse(row.available_colors || '[]'),
    stockColors: JSON.parse(row.stock_colors || '[]'),
    batteryCapacity: row.battery_capacity,
    rangeKm: Number(row.range_km),
    drivetrain: row.drivetrain,
    energyType: row.energy_type,
    imageUrl: row.image_url,
    publicNotes: row.public_notes,
    priceUpdatedAt: row.price_updated_at,
    priceValidUntil,
    isPriceValid,
    isListed: Boolean(row.is_listed),
    vin: role === 'customer' ? `${row.vin.slice(0, 6)}******${row.vin.slice(-4)}` : row.vin,
  }
  if (role === 'admin' || role === 'sales') {
    const supplierSources = db
      .prepare('SELECT * FROM supplier_sources WHERE vehicle_id = ? ORDER BY supplier_price')
      .all(row.id)
      .map((source) => ({
        id: Number(source.id),
        supplierName: source.supplier_name,
        stockQuantity: Number(source.stock_quantity),
        stockColors: JSON.parse(source.stock_colors || '[]'),
        preorderMinDays: Number(source.preorder_min_days),
        preorderMaxDays: Number(source.preorder_max_days),
        canPreorder: Boolean(source.can_preorder),
        supplierPrice: Number(source.supplier_price),
        createdBy: source.created_by,
        updatedBy: source.updated_by,
        updatedAt: source.updated_at,
        notes: source.notes,
      }))
    const priceHistory = db
      .prepare('SELECT * FROM vehicle_price_history WHERE vehicle_id = ? ORDER BY id DESC')
      .all(row.id)
      .map((price) => ({
        id: Number(price.id),
        partnerPrice: Number(price.partner_price),
        validFrom: price.valid_from,
        validUntil: price.valid_until,
        changedBy: price.changed_by,
        notes: price.notes,
      }))
    return {
      ...base,
      cost: row.cost,
      visiblePrice: row.partner_price,
      priceLabel: '合作报价',
      supplierSources,
      priceHistory,
    }
  }
  if (role === 'partner') {
    return { ...base, visiblePrice: row.partner_price, priceLabel: '合作报价' }
  }
  return { ...base, visiblePrice: row.customer_price, priceLabel: '客户报价' }
}

function nextVehicleId() {
  const rows = db.prepare("SELECT id FROM vehicles WHERE id LIKE 'EV-%'").all()
  const maxId = rows.reduce((max, row) => {
    const number = Number(String(row.id).replace('EV-', ''))
    return Number.isFinite(number) ? Math.max(max, number) : max
  }, 0)
  return `EV-${String(maxId + 1).padStart(3, '0')}`
}

function syncVehicleAvailability(vehicleId) {
  const sources = db.prepare('SELECT * FROM supplier_sources WHERE vehicle_id = ?').all(vehicleId)
  const stockQuantity = sources.reduce((sum, source) => sum + Number(source.stock_quantity), 0)
  const colorTotals = new Map()
  for (const source of sources) {
    for (const entry of JSON.parse(source.stock_colors || '[]')) {
      colorTotals.set(entry.color, (colorTotals.get(entry.color) ?? 0) + Number(entry.quantity))
    }
  }
  const preorderSources = sources.filter((source) => Boolean(source.can_preorder))
  const status = stockQuantity > 0
    ? VEHICLE_STATUS.inStock
    : preorderSources.length > 0
      ? VEHICLE_STATUS.preorder
      : VEHICLE_STATUS.unavailable
  const preorderMinDays = preorderSources.length > 0
    ? Math.min(...preorderSources.map((source) => Number(source.preorder_min_days)))
    : 0
  const preorderMaxDays = preorderSources.length > 0
    ? Math.max(...preorderSources.map((source) => Number(source.preorder_max_days)))
    : 0
  const supplierPrices = sources.map((source) => Number(source.supplier_price)).filter((price) => price > 0)
  const cost = supplierPrices.length > 0 ? Math.min(...supplierPrices) : 0
  db.prepare(`
    UPDATE vehicles
    SET status = ?, stock_quantity = ?, stock_colors = ?,
        preorder_min_days = ?, preorder_max_days = ?, cost = ?
    WHERE id = ?
  `).run(
    status,
    stockQuantity,
    JSON.stringify([...colorTotals.entries()].map(([color, quantity]) => ({ color, quantity }))),
    preorderMinDays,
    preorderMaxDays,
    cost,
    vehicleId,
  )
}

function normalizeSourceInput(body) {
  const {
    supplierName,
    stockColors = [],
    canPreorder = true,
    preorderMinDays = 0,
    preorderMaxDays = 0,
    supplierPrice,
    notes = '',
  } = body ?? {}
  const normalizedSupplierName = String(supplierName ?? '').trim()
  const price = Number(supplierPrice)
  const colors = Array.isArray(stockColors)
    ? stockColors
      .map((entry) => ({
        color: String(entry?.color ?? '').trim(),
        quantity: Math.max(0, Math.floor(Number(entry?.quantity) || 0)),
        productionMonth: String(entry?.productionMonth ?? '').trim(),
      }))
      .filter((entry) => entry.color && entry.quantity > 0)
    : []
  const stockQuantity = colors.reduce((sum, entry) => sum + entry.quantity, 0)
  const minDays = Math.max(0, Math.floor(Number(preorderMinDays) || 0))
  const maxDays = Math.max(0, Math.floor(Number(preorderMaxDays) || 0))
  if (!normalizedSupplierName) throw new Error('请填写供应商名称')
  if (!Number.isFinite(price) || price <= 0) throw new Error('供应商价格必须大于 0')
  if (colors.some((entry) => !/^\d{4}-(0[1-9]|1[0-2])$/.test(entry.productionMonth))) {
    throw new Error('每个现车批次都需要填写正确的生产年月')
  }
  if (canPreorder && (minDays < 1 || maxDays < minDays)) {
    throw new Error('请填写正确的预订周期')
  }
  return {
    supplierName: normalizedSupplierName,
    supplierPrice: price,
    canPreorder: Boolean(canPreorder),
    preorderMinDays: canPreorder ? minDays : 0,
    preorderMaxDays: canPreorder ? maxDays : 0,
    stockColors: colors,
    stockQuantity,
    notes: String(notes ?? '').trim(),
  }
}

function serializeQuoteRequest(row, user) {
  const itemRows = db
    .prepare('SELECT * FROM quote_request_items WHERE quote_request_id = ? ORDER BY id')
    .all(row.id)
  const items = itemRows.map((item) => {
    const agreedProfit = item.agreed_profit === null ? null : Number(item.agreed_profit)
    const profitForCalculation = agreedProfit ?? Number(item.suggested_profit)
    const unitPrice = Number(item.base_price_snapshot) + profitForCalculation
    return {
      id: Number(item.id),
      vehicleId: item.vehicle_id,
      vehicleModel: item.vehicle_model,
      vehicleTrim: item.vehicle_trim,
      vehicleColor: item.vehicle_color,
      basePriceSnapshot: Number(item.base_price_snapshot),
      quantity: Number(item.quantity),
      suggestedProfit: Number(item.suggested_profit),
      agreedProfit,
      unitPrice,
      subtotal: unitPrice * Number(item.quantity),
    }
  })
  const vehicleSubtotal = items.reduce((sum, item) => sum + item.subtotal, 0)
  const total = vehicleSubtotal + Number(row.freight) + Number(row.other_fees)
  const versionRows = db
    .prepare('SELECT * FROM quote_versions WHERE quote_request_id = ? ORDER BY version_no DESC')
    .all(row.id)
  const versions = versionRows.map((version) => {
    const rawVersionItems = db
      .prepare('SELECT * FROM quote_version_items WHERE quote_version_id = ? ORDER BY id')
      .all(version.id)
    const fees = db
      .prepare('SELECT * FROM quote_version_fees WHERE quote_version_id = ? ORDER BY id')
      .all(version.id)
      .map((fee) => ({
        id: Number(fee.id),
        name: fee.fee_name,
        amount: Number(fee.amount),
        category: fee.category,
      }))
    const totalQuantity = rawVersionItems.reduce((sum, item) => sum + Number(item.quantity), 0) || 1
    const legacyShipping = fees
      .filter((fee) => fee.category === 'shipping' || fee.category === 'insurance')
      .reduce((sum, fee) => sum + fee.amount, 0)
    const legacyFinancing = fees
      .filter((fee) => fee.category === 'finance')
      .reduce((sum, fee) => sum + fee.amount, 0)
    const legacyFobExtras = fees
      .filter((fee) => !['shipping', 'insurance', 'finance'].includes(fee.category))
      .reduce((sum, fee) => sum + fee.amount, 0)
    const usesItemizedCharges = rawVersionItems.some(
      (item) => Number(item.shipping_fee) !== 0 || Number(item.financing_fee) !== 0,
    )
    const versionItems = rawVersionItems.map((item) => {
        const fobPrice =
          Number(item.base_price) + (usesItemizedCharges ? 0 : legacyFobExtras / totalQuantity)
        const shippingFee =
          Number(item.shipping_fee) || (usesItemizedCharges ? 0 : legacyShipping / totalQuantity)
        const financingFee =
          Number(item.financing_fee) || (usesItemizedCharges ? 0 : legacyFinancing / totalQuantity)
        const unitPrice = fobPrice + shippingFee + financingFee + Number(item.profit)
        const visibleItem = {
          id: Number(item.id),
          vehicleId: item.vehicle_id,
          vehicleModel: item.vehicle_model,
          vehicleTrim: item.vehicle_trim,
          vehicleColor: item.vehicle_color,
          quantity: Number(item.quantity),
          basePrice: fobPrice,
          fobPrice,
          shippingFee,
          financingFee,
          customerDepositRate: Number(item.customer_deposit_rate),
          financingDays: Number(item.financing_days),
          monthlyFinancingRate: Number(item.monthly_financing_rate),
          hasFinancingEstimate: Boolean(item.financing_calculated),
          profit: Number(item.profit),
          unitPrice,
          subtotal: unitPrice * Number(item.quantity),
        }
        if (user.role === 'admin' || user.role === 'sales') {
          return {
            ...visibleItem,
            supplierPaymentRate: Number(item.supplier_payment_rate),
            advanceAmount: Number(item.advance_amount),
          }
        }
        return visibleItem
      })
    return {
      id: Number(version.id),
      versionNo: Number(version.version_no),
      tradeTerm: version.trade_term,
      status: normalizeStatus(version.status),
      changeReason: version.change_reason,
      createdBy: version.created_by,
      createdAt: version.created_at,
      acceptedAt: version.accepted_at,
      items: versionItems,
      fees: usesItemizedCharges ? [] : fees,
      vehicleSubtotal: versionItems.reduce((sum, item) => sum + item.subtotal, 0),
      total:
        versionItems.reduce((sum, item) => sum + item.subtotal, 0),
      canAccept:
        (user.role === 'partner' || user.role === 'customer') &&
        row.customer_id === user.customerId &&
        normalizeStatus(version.status) === QUOTE_VERSION_STATUS.pendingCustomerReview,
    }
  })
  const revisionRequests = db
    .prepare('SELECT * FROM quote_revision_requests WHERE quote_request_id = ? ORDER BY id DESC')
    .all(row.id)
    .map((revision) => ({
      id: Number(revision.id),
      quoteVersionId: revision.quote_version_id === null ? null : Number(revision.quote_version_id),
      message: revision.message,
      createdBy: revision.created_by,
      createdAt: revision.created_at,
      status: normalizeStatus(revision.status),
    }))

  return {
    id: Number(row.id),
    requestNo: row.request_no,
    customerId: row.customer_id,
    vehicleId: row.vehicle_id,
    vehicleModel: items.length === 1 ? items[0].vehicleModel : `${items.length} 款车辆`,
    basePriceSnapshot: Number(row.base_price_snapshot),
    quantity: items.reduce((sum, item) => sum + item.quantity, 0),
    suggestedProfit: Number(row.suggested_profit),
    agreedProfit: row.agreed_profit === null ? null : Number(row.agreed_profit),
    items,
    versions,
    revisionRequests,
    destinationPort: row.destination_port,
    tradeTerm: row.trade_term,
    freight: Number(row.freight),
    otherFees: Number(row.other_fees),
    notes: row.notes,
    status: normalizeStatus(row.status),
    piNumber: row.pi_number,
    vehicleUnitPrice: items.length === 1 ? items[0].unitPrice : 0,
    total,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    assignedTo: row.assigned_to,
    canEditInquiry:
      (user.role === 'partner' || user.role === 'customer') &&
      row.customer_id === user.customerId &&
      normalizeStatus(row.status) !== QUOTE_REQUEST_STATUS.piConfirmed,
    canAssign: user.role === 'admin',
    canReview: canManageQuoteRequest(user, row) && normalizeStatus(row.status) === QUOTE_REQUEST_STATUS.pendingReview,
    canCreateVersion: canManageQuoteRequest(user, row) && normalizeStatus(row.status) !== QUOTE_REQUEST_STATUS.piConfirmed,
    canGeneratePi: canManageQuoteRequest(user, row) && normalizeStatus(row.status) === QUOTE_REQUEST_STATUS.quoteAccepted,
    canConfirmPi:
      (user.role === 'partner' || user.role === 'customer') &&
      row.customer_id === user.customerId &&
      normalizeStatus(row.status) === QUOTE_REQUEST_STATUS.piPending,
  }
}

function getVisibleQuoteRequests(user) {
  if (user.role === 'admin') {
    return db.prepare('SELECT * FROM quote_requests ORDER BY id DESC').all()
  }
  if (user.role === 'sales') {
    return db
      .prepare('SELECT * FROM quote_requests WHERE assigned_to = ? ORDER BY id DESC')
      .all(user.username)
  }
  return db
    .prepare('SELECT * FROM quote_requests WHERE customer_id = ? ORDER BY id DESC')
    .all(user.customerId)
}

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body ?? {}
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username)
  if (!user || !user.is_active || !bcrypt.compareSync(String(password ?? ''), user.password_hash)) {
    return res.status(401).json({ error: '账号或密码错误' })
  }
  const token = createToken(user)
  res.cookie('ev_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: 12 * 60 * 60 * 1000,
  })
  res.json({
    user: publicUser({
      username: user.username,
      displayName: user.display_name,
      role: user.role,
      customerId: user.customer_id,
    }),
  })
})

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie('ev_session')
  res.status(204).end()
})

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) })
})

app.post(
  '/api/users',
  requireAuth,
  requireRole('admin'),
  (req, res) => {
    const username = String(req.body?.username ?? '').trim().toLowerCase()
    const displayName = String(req.body?.displayName ?? '').trim()
    const password = String(req.body?.password ?? '')
    const role = String(req.body?.role ?? 'sales')
    if (!/^[a-z0-9._-]{3,30}$/.test(username)) {
      return res.status(400).json({ error: '账号需为 3-30 位英文、数字、点、下划线或横线' })
    }
    if (!displayName) return res.status(400).json({ error: '请填写员工姓名' })
    if (password.length < 8) return res.status(400).json({ error: '初始密码至少需要 8 位' })
    if (!['admin', 'sales'].includes(role)) {
      return res.status(400).json({ error: '员工角色只能是管理员或销售' })
    }
    try {
      db.prepare(`
        INSERT INTO users (
          username, password_hash, display_name, role, customer_id, is_active, created_at
        ) VALUES (?, ?, ?, ?, NULL, 1, ?)
      `).run(username, bcrypt.hashSync(password, 10), displayName, role, new Date().toISOString())
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) {
        return res.status(409).json({ error: '该登录账号已存在' })
      }
      throw error
    }
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username)
    res.status(201).json({ user: serializeStaffUser(user) })
  },
)

app.patch(
  '/api/users/:username',
  requireAuth,
  requireRole('admin'),
  (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(req.params.username)
    if (!user || !['admin', 'sales'].includes(user.role)) {
      return res.status(404).json({ error: '员工账号不存在' })
    }
    const displayName = String(req.body?.displayName ?? user.display_name).trim()
    const role = String(req.body?.role ?? user.role)
    const isActive = req.body?.isActive === undefined ? Boolean(user.is_active) : Boolean(req.body.isActive)
    if (!displayName) return res.status(400).json({ error: '请填写员工姓名' })
    if (!['admin', 'sales'].includes(role)) {
      return res.status(400).json({ error: '员工角色只能是管理员或销售' })
    }
    if (user.username === req.user.username && !isActive) {
      return res.status(409).json({ error: '不能停用当前登录账号' })
    }
    const activeAdminCount = Number(
      db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND is_active = 1").get().count,
    )
    if (user.role === 'admin' && user.is_active && (role !== 'admin' || !isActive) && activeAdminCount <= 1) {
      return res.status(409).json({ error: '系统至少需要保留一个启用的管理员账号' })
    }
    db.prepare(`
      UPDATE users SET display_name = ?, role = ?, is_active = ? WHERE id = ?
    `).run(displayName, role, isActive ? 1 : 0, user.id)
    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)
    res.json({ user: serializeStaffUser(updated) })
  },
)

app.post(
  '/api/users/:username/reset-password',
  requireAuth,
  requireRole('admin'),
  (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(req.params.username)
    if (!user || !['admin', 'sales'].includes(user.role)) {
      return res.status(404).json({ error: '员工账号不存在' })
    }
    const password = String(req.body?.password ?? '')
    if (password.length < 8) return res.status(400).json({ error: '新密码至少需要 8 位' })
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .run(bcrypt.hashSync(password, 10), user.id)
    res.status(204).end()
  },
)

app.post(
  '/api/vehicles',
  requireAuth,
  requireRole('admin', 'sales'),
  (req, res) => {
    const {
      brand,
      model,
      trim,
      year,
      energyType = '纯电',
      rangeKm = 0,
      batteryCapacity = '',
      drivetrain = '',
      availableColors = [],
      partnerPrice,
      imageUrl = '',
      publicNotes = '',
    } = req.body ?? {}
    const normalizedBrand = String(brand ?? '').trim()
    const normalizedModel = String(model ?? '').trim()
    const normalizedTrim = String(trim ?? '').trim()
    const normalizedYear = String(year ?? '').trim()
    const price = Number(partnerPrice)
    if (!normalizedBrand || !normalizedModel || !normalizedTrim || !normalizedYear) {
      return res.status(400).json({ error: '请填写品牌、车型、配置版本和年款' })
    }
    if (!Number.isFinite(price) || price <= 0) {
      return res.status(400).json({ error: '基础合作价必须大于 0' })
    }
    const colors = Array.isArray(availableColors)
      ? [...new Set(availableColors.map((color) => String(color).trim()).filter(Boolean))]
      : []
    const id = nextVehicleId()
    const now = new Date()
    const validUntil = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)
    db.prepare(`
      INSERT INTO vehicles (
        id, model, trim, year, color, location, status, stock_quantity,
        preorder_min_days, preorder_max_days, available_colors, stock_colors,
        battery_capacity, range_km, drivetrain, energy_type, image_url, public_notes,
        price_updated_at, price_valid_until, is_listed, vin, cost, partner_price, customer_price
      ) VALUES (?, ?, ?, ?, ?, '', ?, 0, 0, 0, ?, '[]', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 0, ?, ?)
    `).run(
      id,
      `${normalizedBrand} ${normalizedModel}`,
      normalizedTrim,
      normalizedYear,
      colors.length > 0 ? '颜色可选' : '待确认',
      VEHICLE_STATUS.unavailable,
      JSON.stringify(colors),
      String(batteryCapacity ?? '').trim(),
      Math.max(0, Number(rangeKm) || 0),
      String(drivetrain ?? '').trim(),
      String(energyType ?? '纯电').trim(),
      String(imageUrl ?? '').trim(),
      String(publicNotes ?? '').trim(),
      now.toISOString(),
      validUntil.toISOString(),
      `RESOURCE-${id}`,
      price,
      price,
    )
    db.prepare(`
      INSERT INTO vehicle_price_history (
        vehicle_id, partner_price, valid_from, valid_until, changed_by, notes
      ) VALUES (?, ?, ?, ?, ?, '首次录入')
    `).run(id, price, now.toISOString(), validUntil.toISOString(), req.user.username)
    const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(id)
    res.status(201).json({ vehicle: serializeVehicle(vehicle, req.user.role) })
  },
)

app.patch(
  '/api/vehicles/:vehicleId',
  requireAuth,
  requireRole('admin', 'sales'),
  (req, res) => {
    const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(req.params.vehicleId)
    if (!vehicle) return res.status(404).json({ error: '车辆配置不存在' })
    const {
      model,
      trim,
      year,
      energyType = '纯电',
      rangeKm = 0,
      batteryCapacity = '',
      drivetrain = '',
      availableColors = [],
      imageUrl = '',
      publicNotes = '',
    } = req.body ?? {}
    const normalizedModel = String(model ?? '').trim()
    const normalizedTrim = String(trim ?? '').trim()
    const normalizedYear = String(year ?? '').trim()
    if (!normalizedModel || !normalizedTrim || !normalizedYear) {
      return res.status(400).json({ error: '请填写车型、配置版本和年款' })
    }
    const colors = Array.isArray(availableColors)
      ? [...new Set(availableColors.map((color) => String(color).trim()).filter(Boolean))]
      : []
    db.prepare(`
      UPDATE vehicles
      SET model = ?, trim = ?, year = ?, color = ?, available_colors = ?,
          battery_capacity = ?, range_km = ?, drivetrain = ?, energy_type = ?,
          image_url = ?, public_notes = ?
      WHERE id = ?
    `).run(
      normalizedModel,
      normalizedTrim,
      normalizedYear,
      colors.length > 0 ? '颜色可选' : '待确认',
      JSON.stringify(colors),
      String(batteryCapacity ?? '').trim(),
      Math.max(0, Number(rangeKm) || 0),
      String(drivetrain ?? '').trim(),
      String(energyType ?? '纯电').trim(),
      String(imageUrl ?? '').trim(),
      String(publicNotes ?? '').trim(),
      vehicle.id,
    )
    const updated = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(vehicle.id)
    res.json({ vehicle: serializeVehicle(updated, req.user.role) })
  },
)

app.post(
  '/api/vehicles/:vehicleId/prices',
  requireAuth,
  requireRole('admin', 'sales'),
  (req, res) => {
    const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(req.params.vehicleId)
    if (!vehicle) return res.status(404).json({ error: '车辆配置不存在' })
    const price = Number(req.body?.partnerPrice)
    const notes = String(req.body?.notes ?? '').trim()
    if (!Number.isFinite(price) || price <= 0) {
      return res.status(400).json({ error: '基础合作价必须大于 0' })
    }
    const now = new Date()
    const validUntil = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)
    db.exec('BEGIN')
    try {
      db.prepare(`
        UPDATE vehicles
        SET partner_price = ?, price_updated_at = ?, price_valid_until = ?
        WHERE id = ?
      `).run(price, now.toISOString(), validUntil.toISOString(), vehicle.id)
      db.prepare(`
        INSERT INTO vehicle_price_history (
          vehicle_id, partner_price, valid_from, valid_until, changed_by, notes
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(vehicle.id, price, now.toISOString(), validUntil.toISOString(), req.user.username, notes)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    const updated = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(vehicle.id)
    res.status(201).json({ vehicle: serializeVehicle(updated, req.user.role) })
  },
)

app.patch(
  '/api/vehicles/:vehicleId/listing',
  requireAuth,
  requireRole('admin', 'sales'),
  (req, res) => {
    const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(req.params.vehicleId)
    if (!vehicle) return res.status(404).json({ error: '车辆配置不存在' })
    const isListed = Boolean(req.body?.isListed)
    db.prepare('UPDATE vehicles SET is_listed = ? WHERE id = ?').run(isListed ? 1 : 0, vehicle.id)
    const updated = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(vehicle.id)
    res.json({ vehicle: serializeVehicle(updated, req.user.role) })
  },
)

app.post(
  '/api/vehicles/:vehicleId/supplier-sources',
  requireAuth,
  requireRole('admin', 'sales'),
  (req, res) => {
    const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ? AND is_listed = 1').get(req.params.vehicleId)
    if (!vehicle) return res.status(404).json({ error: '车辆配置不存在或已下架' })
    let source
    try {
      source = normalizeSourceInput(req.body)
    } catch (error) {
      return res.status(400).json({ error: error.message })
    }
    db.prepare(`
      INSERT INTO supplier_sources (
        vehicle_id, supplier_name, stock_quantity, stock_colors,
        preorder_min_days, preorder_max_days, can_preorder,
        supplier_price, created_by, updated_by, updated_at, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      vehicle.id,
      source.supplierName,
      source.stockQuantity,
      JSON.stringify(source.stockColors),
      source.preorderMinDays,
      source.preorderMaxDays,
      source.canPreorder ? 1 : 0,
      source.supplierPrice,
      req.user.username,
      req.user.username,
      new Date().toISOString(),
      source.notes,
    )
    syncVehicleAvailability(vehicle.id)
    const updated = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(vehicle.id)
    res.status(201).json({ vehicle: serializeVehicle(updated, req.user.role) })
  },
)

app.patch(
  '/api/vehicles/:vehicleId/supplier-sources/:sourceId',
  requireAuth,
  requireRole('admin', 'sales'),
  (req, res) => {
    const sourceRow = db
      .prepare('SELECT * FROM supplier_sources WHERE id = ? AND vehicle_id = ?')
      .get(req.params.sourceId, req.params.vehicleId)
    if (!sourceRow) return res.status(404).json({ error: '供应商车源不存在' })
    let source
    try {
      source = normalizeSourceInput(req.body)
    } catch (error) {
      return res.status(400).json({ error: error.message })
    }
    db.prepare(`
      UPDATE supplier_sources
      SET supplier_name = ?, stock_quantity = ?, stock_colors = ?,
          preorder_min_days = ?, preorder_max_days = ?, can_preorder = ?,
          supplier_price = ?, updated_by = ?, updated_at = ?, notes = ?
      WHERE id = ? AND vehicle_id = ?
    `).run(
      source.supplierName,
      source.stockQuantity,
      JSON.stringify(source.stockColors),
      source.preorderMinDays,
      source.preorderMaxDays,
      source.canPreorder ? 1 : 0,
      source.supplierPrice,
      req.user.username,
      new Date().toISOString(),
      source.notes,
      sourceRow.id,
      sourceRow.vehicle_id,
    )
    syncVehicleAvailability(sourceRow.vehicle_id)
    const updated = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(sourceRow.vehicle_id)
    res.json({ vehicle: serializeVehicle(updated, req.user.role) })
  },
)

app.delete(
  '/api/vehicles/:vehicleId/supplier-sources/:sourceId',
  requireAuth,
  requireRole('admin', 'sales'),
  (req, res) => {
    const source = db
      .prepare('SELECT * FROM supplier_sources WHERE id = ? AND vehicle_id = ?')
      .get(req.params.sourceId, req.params.vehicleId)
    if (!source) return res.status(404).json({ error: '供应商车源不存在' })
    db.prepare('DELETE FROM supplier_sources WHERE id = ?').run(source.id)
    syncVehicleAvailability(source.vehicle_id)
    res.status(204).end()
  },
)

app.post(
  '/api/quote-requests',
  requireAuth,
  requireRole('partner', 'customer'),
  (req, res) => {
    const {
      items,
      destinationPort,
      tradeTerm,
      notes = '',
    } = req.body ?? {}
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: '请至少选择一款车辆' })
    }
    if (!String(destinationPort ?? '').trim() || !String(tradeTerm ?? '').trim()) {
      return res.status(400).json({ error: '请填写目的港和贸易条款' })
    }

    const now = new Date().toISOString()
    const normalizedItems = []
    for (const item of items) {
      const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ? AND is_listed = 1').get(item.vehicleId)
      const quantity = Number(item.quantity)
      const suggestedProfit = 0
      if (!vehicle) return res.status(404).json({ error: `车辆 ${item.vehicleId} 不存在或已下架` })
      if (!Number.isInteger(quantity) || quantity < 1) {
        return res.status(400).json({ error: `${vehicle.model} 的询价数量必须是大于 0 的整数` })
      }
      normalizedItems.push({ vehicle, quantity, suggestedProfit })
    }
    const firstItem = normalizedItems[0]
    db.exec('BEGIN')
    try {
      const result = db.prepare(`
        INSERT INTO quote_requests (
          customer_id, vehicle_id, vehicle_model, base_price_snapshot, quantity,
          suggested_profit, destination_port, trade_term, notes, status,
          created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        req.user.customerId,
        firstItem.vehicle.id,
        normalizedItems.length === 1 ? firstItem.vehicle.model : `${normalizedItems.length} 款车辆`,
        firstItem.vehicle.partner_price,
        normalizedItems.reduce((sum, item) => sum + item.quantity, 0),
        firstItem.suggestedProfit,
        String(destinationPort).trim(),
        String(tradeTerm).trim(),
        String(notes).trim(),
        QUOTE_REQUEST_STATUS.pendingReview,
        req.user.username,
        now,
        now,
      )
      const id = Number(result.lastInsertRowid)
      const requestNo = `QR-${new Date().getFullYear()}-${String(id).padStart(4, '0')}`
      db.prepare('UPDATE quote_requests SET request_no = ? WHERE id = ?').run(requestNo, id)
      const insertItem = db.prepare(`
        INSERT INTO quote_request_items (
          quote_request_id, vehicle_id, vehicle_model, vehicle_trim, vehicle_color,
          base_price_snapshot, quantity, suggested_profit
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const item of normalizedItems) {
        insertItem.run(
          id,
          item.vehicle.id,
          item.vehicle.model,
          item.vehicle.trim,
          item.vehicle.color,
          item.vehicle.partner_price,
          item.quantity,
          item.suggestedProfit,
        )
      }
      db.prepare(`
        INSERT INTO notifications (
          recipient_role, type, title, message, related_id, created_at
        ) VALUES ('admin', 'inquiry_created', ?, ?, ?, ?)
      `).run(
        `${requestNo} 收到新的询价`,
        '请查看车辆需求并分配负责人。',
        id,
        now,
      )
      db.exec('COMMIT')
      const row = db.prepare('SELECT * FROM quote_requests WHERE id = ?').get(id)
      res.status(201).json({ quoteRequest: serializeQuoteRequest(row, req.user) })
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  },
)

app.patch(
  '/api/quote-requests/:id/assignment',
  requireAuth,
  requireRole('admin'),
  (req, res) => {
    const request = db.prepare('SELECT * FROM quote_requests WHERE id = ?').get(req.params.id)
    if (!request) return res.status(404).json({ error: '询价不存在' })
    const assignedTo = String(req.body?.assignedTo ?? '').trim() || null
    if (assignedTo) {
      const assignee = db.prepare(`
        SELECT * FROM users
        WHERE username = ? AND role IN ('admin', 'sales') AND is_active = 1
      `).get(assignedTo)
      if (!assignee) return res.status(400).json({ error: '请选择一个启用的管理员或销售账号' })
    }
    const now = new Date().toISOString()
    db.prepare('UPDATE quote_requests SET assigned_to = ?, updated_at = ? WHERE id = ?')
      .run(assignedTo, now, request.id)
    if (assignedTo && assignedTo !== request.assigned_to) {
      db.prepare(`
        INSERT INTO notifications (
          recipient_role, recipient_username, type, title, message, related_id, created_at
        ) VALUES (
          (SELECT role FROM users WHERE username = ?), ?, 'inquiry_assigned', ?, ?, ?, ?
        )
      `).run(
        assignedTo,
        assignedTo,
        `${request.request_no} 已分配给你`,
        '请查看客户需求并跟进报价。',
        request.id,
        now,
      )
    }
    const updated = db.prepare('SELECT * FROM quote_requests WHERE id = ?').get(request.id)
    res.json({ quoteRequest: serializeQuoteRequest(updated, req.user) })
  },
)

app.patch(
  '/api/quote-requests/:id',
  requireAuth,
  requireRole('partner', 'customer'),
  (req, res) => {
    const request = db.prepare('SELECT * FROM quote_requests WHERE id = ?').get(req.params.id)
    if (!request || request.customer_id !== req.user.customerId) {
      return res.status(404).json({ error: '询价不存在' })
    }
    if (normalizeStatus(request.status) === QUOTE_REQUEST_STATUS.piConfirmed) {
      return res.status(409).json({ error: 'PI 已确认，需求变更需要重新发起询价' })
    }
    const versionCount = Number(
      db.prepare('SELECT COUNT(*) AS count FROM quote_versions WHERE quote_request_id = ?')
        .get(request.id).count,
    )

    const { items, destinationPort, tradeTerm, notes = '' } = req.body ?? {}
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: '请至少保留一款车辆' })
    }
    if (!String(destinationPort ?? '').trim() || !String(tradeTerm ?? '').trim()) {
      return res.status(400).json({ error: '请填写目的港和贸易条款' })
    }

    const normalizedItems = []
    const seenVehicles = new Set()
    for (const item of items) {
      const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ? AND is_listed = 1').get(item.vehicleId)
      const quantity = Number(item.quantity)
      if (!vehicle) return res.status(404).json({ error: `车辆 ${item.vehicleId} 不存在或已下架` })
      if (seenVehicles.has(vehicle.id)) {
        return res.status(400).json({ error: `${vehicle.model} 不能重复添加` })
      }
      if (!Number.isInteger(quantity) || quantity < 1) {
        return res.status(400).json({ error: `${vehicle.model} 的数量必须是大于 0 的整数` })
      }
      seenVehicles.add(vehicle.id)
      normalizedItems.push({ vehicle, quantity })
    }

    const firstItem = normalizedItems[0]
    const now = new Date().toISOString()
    const oldItems = db
      .prepare('SELECT vehicle_model, quantity FROM quote_request_items WHERE quote_request_id = ? ORDER BY id')
      .all(request.id)
    const oldSummary = oldItems.map((item) => `${item.vehicle_model} × ${item.quantity}`).join('、')
    const newSummary = normalizedItems.map((item) => `${item.vehicle.model} × ${item.quantity}`).join('、')
    const revisionMessage = versionCount > 0
      ? `客户直接修改需求：${oldSummary} → ${newSummary}；${request.trade_term} ${request.destination_port} → ${String(tradeTerm).trim()} ${String(destinationPort).trim()}`
      : `客户更新待报价需求：${oldSummary} → ${newSummary}`
    db.exec('BEGIN')
    try {
      db.prepare(`
        UPDATE quote_requests
        SET vehicle_id = ?, vehicle_model = ?, base_price_snapshot = ?,
            quantity = ?, destination_port = ?, trade_term = ?, notes = ?,
            status = ?, pi_number = NULL, updated_at = ?
        WHERE id = ?
      `).run(
        firstItem.vehicle.id,
        normalizedItems.length === 1 ? firstItem.vehicle.model : `${normalizedItems.length} 款车辆`,
        firstItem.vehicle.partner_price,
        normalizedItems.reduce((sum, item) => sum + item.quantity, 0),
        String(destinationPort).trim(),
        String(tradeTerm).trim(),
        String(notes).trim(),
        QUOTE_REQUEST_STATUS.customerChanged,
        now,
        request.id,
      )
      db.prepare('DELETE FROM quote_request_items WHERE quote_request_id = ?').run(request.id)
      const insertItem = db.prepare(`
        INSERT INTO quote_request_items (
          quote_request_id, vehicle_id, vehicle_model, vehicle_trim, vehicle_color,
          base_price_snapshot, quantity, suggested_profit
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0)
      `)
      for (const item of normalizedItems) {
        insertItem.run(
          request.id,
          item.vehicle.id,
          item.vehicle.model,
          item.vehicle.trim,
          item.vehicle.color,
          item.vehicle.partner_price,
          item.quantity,
        )
      }
      if (versionCount > 0) {
        db.prepare(`
          INSERT INTO quote_revision_requests (
            quote_request_id, quote_version_id, message, created_by, created_at, status
          ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          request.id,
          db.prepare('SELECT id FROM quote_versions WHERE quote_request_id = ? ORDER BY version_no DESC LIMIT 1').get(request.id)?.id ?? null,
          revisionMessage,
          req.user.username,
          now,
          REVISION_STATUS.pending,
        )
      }
      db.prepare(`
        INSERT INTO notifications (
          recipient_role, type, title, message, related_id, created_at
        ) VALUES ('admin', 'inquiry_changed', ?, ?, ?, ?)
      `).run(
        `${request.request_no} 客户修改了询价需求`,
        versionCount > 0 ? '原报价历史已保留，请根据新需求发布下一版报价。' : '请根据更新后的需求制作首次报价。',
        request.id,
        now,
      )
      if (request.assigned_to) {
        db.prepare(`
          INSERT INTO notifications (
            recipient_role, recipient_username, type, title, message, related_id, created_at
          ) VALUES (
            (SELECT role FROM users WHERE username = ?), ?, 'inquiry_changed', ?, ?, ?, ?
          )
        `).run(
          request.assigned_to,
          request.assigned_to,
          `${request.request_no} 客户修改了询价需求`,
          versionCount > 0 ? '原报价历史已保留，请发布下一版报价。' : '请根据更新后的需求制作首次报价。',
          request.id,
          now,
        )
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    const updated = db.prepare('SELECT * FROM quote_requests WHERE id = ?').get(request.id)
    res.json({ quoteRequest: serializeQuoteRequest(updated, req.user) })
  },
)

app.post(
  '/api/quote-requests/:id/versions',
  requireAuth,
  requireRole('admin', 'sales'),
  (req, res) => {
    const request = db.prepare('SELECT * FROM quote_requests WHERE id = ?').get(req.params.id)
    if (!request) return res.status(404).json({ error: '询价不存在' })
    if (!canManageQuoteRequest(req.user, request)) {
      return res.status(403).json({ error: '该询价尚未分配给当前账号' })
    }
    const { tradeTerm, items, changeReason = '' } = req.body ?? {}
    if (!String(tradeTerm ?? '').trim()) {
      return res.status(400).json({ error: '请选择 FOB、CIF 等贸易条款' })
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: '报价至少需要一款车辆' })
    }

    const normalizedItems = []
    for (const item of items) {
      const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(item.vehicleId)
      const quantity = Number(item.quantity)
      const fobPrice = Number(item.fobPrice)
      const shippingFee = Number(item.shippingFee ?? 0)
      const customerDepositRate = Number(item.customerDepositRate ?? 20)
      const supplierPaymentRate = Number(item.supplierPaymentRate ?? 100)
      const financingDays = Math.floor(Number(item.financingDays ?? 30))
      const monthlyFinancingRate = Number(item.monthlyFinancingRate ?? 1)
      const profit = Number(item.profit)
      if (!vehicle) return res.status(404).json({ error: `车辆 ${item.vehicleId} 不存在` })
      if (!Number.isInteger(quantity) || quantity < 1) {
        return res.status(400).json({ error: `${vehicle.model} 的数量无效` })
      }
      if (![fobPrice, shippingFee, customerDepositRate, supplierPaymentRate, monthlyFinancingRate, profit].every(Number.isFinite)) {
        return res.status(400).json({ error: `${vehicle.model} 的报价金额无效` })
      }
      if (
        customerDepositRate < 0 || customerDepositRate > 100 ||
        supplierPaymentRate < 0 || supplierPaymentRate > 100 ||
        financingDays < 0 || monthlyFinancingRate < 0
      ) {
        return res.status(400).json({ error: `${vehicle.model} 的融资参数无效` })
      }
      const requestItem = db
        .prepare('SELECT * FROM quote_request_items WHERE quote_request_id = ? AND vehicle_id = ?')
        .get(request.id, vehicle.id)
      const basePrice = Number(requestItem?.base_price_snapshot ?? vehicle.partner_price)
      const advanceAmount = Math.max(
        Number(vehicle.cost) * supplierPaymentRate / 100
          - basePrice * customerDepositRate / 100,
        0,
      )
      const financingFee = advanceAmount * monthlyFinancingRate / 100 * financingDays / 30
      normalizedItems.push({
        vehicle,
        quantity,
        fobPrice,
        shippingFee,
        financingFee,
        customerDepositRate,
        supplierPaymentRate,
        financingDays,
        monthlyFinancingRate,
        advanceAmount,
        profit,
        basePrice,
      })
    }

    const nextVersion =
      Number(
        db.prepare('SELECT COALESCE(MAX(version_no), 0) AS max_version FROM quote_versions WHERE quote_request_id = ?')
          .get(request.id).max_version,
      ) + 1
    const now = new Date().toISOString()
    db.exec('BEGIN')
    try {
      db.prepare(`
        UPDATE quote_versions SET status = ?
        WHERE quote_request_id = ? AND status = ?
      `).run(QUOTE_VERSION_STATUS.replaced, request.id, QUOTE_VERSION_STATUS.pendingCustomerReview)
      const versionResult = db.prepare(`
        INSERT INTO quote_versions (
          quote_request_id, version_no, trade_term, status, change_reason, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(request.id, nextVersion, String(tradeTerm).trim(), QUOTE_VERSION_STATUS.pendingCustomerReview, String(changeReason).trim(), req.user.username, now)
      const versionId = Number(versionResult.lastInsertRowid)
      const insertItem = db.prepare(`
        INSERT INTO quote_version_items (
          quote_version_id, vehicle_id, vehicle_model, vehicle_trim, vehicle_color,
          quantity, base_price, shipping_fee, financing_fee,
          customer_deposit_rate, supplier_payment_rate, financing_days,
          monthly_financing_rate, advance_amount, financing_calculated, profit
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      `)
      for (const item of normalizedItems) {
        insertItem.run(
          versionId,
          item.vehicle.id,
          item.vehicle.model,
          item.vehicle.trim,
          item.vehicle.color,
          item.quantity,
          item.fobPrice,
          item.shippingFee,
          item.financingFee,
          item.customerDepositRate,
          item.supplierPaymentRate,
          item.financingDays,
          item.monthlyFinancingRate,
          item.advanceAmount,
          item.profit,
        )
      }
      db.prepare(`
        UPDATE quote_requests SET status = ?, trade_term = ?, updated_at = ?
        WHERE id = ?
      `).run(QUOTE_REQUEST_STATUS.quoteSent, String(tradeTerm).trim(), now, request.id)
      db.prepare(`
        UPDATE quote_revision_requests SET status = ?
        WHERE quote_request_id = ? AND status = ?
      `).run(REVISION_STATUS.processed, request.id, REVISION_STATUS.pending)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    const updated = db.prepare('SELECT * FROM quote_requests WHERE id = ?').get(request.id)
    res.status(201).json({ quoteRequest: serializeQuoteRequest(updated, req.user) })
  },
)

app.post(
  '/api/quote-requests/:id/revision-requests',
  requireAuth,
  requireRole('partner', 'customer'),
  (req, res) => {
    const request = db.prepare('SELECT * FROM quote_requests WHERE id = ?').get(req.params.id)
    if (!request || request.customer_id !== req.user.customerId) {
      return res.status(404).json({ error: '询价不存在' })
    }
    const message = String(req.body?.message ?? '').trim()
    if (!message) return res.status(400).json({ error: '请填写需要修改的内容' })
    const versionId = req.body?.quoteVersionId === null ? null : Number(req.body?.quoteVersionId)
    db.prepare(`
      INSERT INTO quote_revision_requests (
        quote_request_id, quote_version_id, message, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?)
    `).run(request.id, Number.isFinite(versionId) ? versionId : null, message, req.user.username, new Date().toISOString())
    db.prepare(`
      UPDATE quote_requests SET status = ?, updated_at = ? WHERE id = ?
    `).run(QUOTE_REQUEST_STATUS.revisionRequested, new Date().toISOString(), request.id)
    if (request.assigned_to) {
      db.prepare(`
        INSERT INTO notifications (
          recipient_role, recipient_username, type, title, message, related_id, created_at
        ) VALUES (
          (SELECT role FROM users WHERE username = ?), ?, 'quote_revision_requested', ?, ?, ?, ?
        )
      `).run(
        request.assigned_to,
        request.assigned_to,
        `${request.request_no} 客户要求修改报价`,
        message,
        request.id,
        new Date().toISOString(),
      )
    }
    const updated = db.prepare('SELECT * FROM quote_requests WHERE id = ?').get(request.id)
    res.status(201).json({ quoteRequest: serializeQuoteRequest(updated, req.user) })
  },
)

app.post(
  '/api/quote-requests/:id/versions/:versionId/accept',
  requireAuth,
  requireRole('partner', 'customer'),
  (req, res) => {
    const request = db.prepare('SELECT * FROM quote_requests WHERE id = ?').get(req.params.id)
    const version = db.prepare('SELECT * FROM quote_versions WHERE id = ? AND quote_request_id = ?')
      .get(req.params.versionId, req.params.id)
    if (!request || request.customer_id !== req.user.customerId || !version) {
      return res.status(404).json({ error: '报价版本不存在' })
    }
    if (normalizeStatus(version.status) !== QUOTE_VERSION_STATUS.pendingCustomerReview) {
      return res.status(409).json({ error: '该报价版本当前不能接受' })
    }
    const now = new Date().toISOString()
    db.exec('BEGIN')
    try {
      db.prepare(`
        UPDATE quote_versions SET status = CASE WHEN id = ? THEN ? ELSE ? END,
          accepted_at = CASE WHEN id = ? THEN ? ELSE accepted_at END
        WHERE quote_request_id = ?
      `).run(version.id, QUOTE_VERSION_STATUS.accepted, QUOTE_VERSION_STATUS.replaced, version.id, now, request.id)
      db.prepare(`
        UPDATE quote_requests SET status = ?, updated_at = ? WHERE id = ?
      `).run(QUOTE_REQUEST_STATUS.quoteAccepted, now, request.id)
      if (request.assigned_to) {
        db.prepare(`
          INSERT INTO notifications (
            recipient_role, recipient_username, type, title, message, related_id, created_at
          ) VALUES (
            (SELECT role FROM users WHERE username = ?), ?, 'quote_accepted', ?, ?, ?, ?
          )
        `).run(
          request.assigned_to,
          request.assigned_to,
          `${request.request_no} 客户已接受报价`,
          `客户已接受 V${version.version_no}，可以继续生成 PI。`,
          request.id,
          now,
        )
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    const updated = db.prepare('SELECT * FROM quote_requests WHERE id = ?').get(request.id)
    res.json({ quoteRequest: serializeQuoteRequest(updated, req.user) })
  },
)

app.patch(
  '/api/quote-requests/:id/review',
  requireAuth,
  requireRole('admin', 'sales'),
  (req, res) => {
    const row = db.prepare('SELECT * FROM quote_requests WHERE id = ?').get(req.params.id)
    if (!row) return res.status(404).json({ error: '报价申请不存在' })
    if (!canManageQuoteRequest(req.user, row)) {
      return res.status(403).json({ error: '该询价尚未分配给当前账号' })
    }
    if (normalizeStatus(row.status) !== QUOTE_REQUEST_STATUS.pendingReview) {
      return res.status(409).json({ error: '当前状态不能重复确认利润' })
    }

    const itemProfits = Array.isArray(req.body?.itemProfits) ? req.body.itemProfits : []
    const freight = Number(req.body?.freight ?? 0)
    const otherFees = Number(req.body?.otherFees ?? 0)
    if (![freight, otherFees].every(Number.isFinite) || freight < 0 || otherFees < 0) {
      return res.status(400).json({ error: '利润和费用必须是有效的非负金额' })
    }
    const requestItems = db.prepare('SELECT * FROM quote_request_items WHERE quote_request_id = ?').all(row.id)
    if (itemProfits.length !== requestItems.length) {
      return res.status(400).json({ error: '请确认每一款车辆的利润' })
    }
    const updateItemProfit = db.prepare('UPDATE quote_request_items SET agreed_profit = ? WHERE id = ? AND quote_request_id = ?')
    for (const item of itemProfits) {
      const profit = Number(item.agreedProfit)
      if (!Number.isFinite(profit) || profit < 0) {
        return res.status(400).json({ error: '确认利润必须是有效的非负金额' })
      }
      updateItemProfit.run(profit, item.id, row.id)
    }

    db.prepare(`
      UPDATE quote_requests
      SET agreed_profit = NULL, freight = ?, other_fees = ?,
          status = '利润已确认', updated_at = ?
      WHERE id = ?
    `).run(freight, otherFees, new Date().toISOString(), req.params.id)
    const updated = db.prepare('SELECT * FROM quote_requests WHERE id = ?').get(req.params.id)
    res.json({ quoteRequest: serializeQuoteRequest(updated, req.user) })
  },
)

app.post(
  '/api/quote-requests/:id/generate-pi',
  requireAuth,
  requireRole('admin', 'sales'),
  (req, res) => {
    const row = db.prepare('SELECT * FROM quote_requests WHERE id = ?').get(req.params.id)
    if (!row) return res.status(404).json({ error: '报价申请不存在' })
    if (!canManageQuoteRequest(req.user, row)) {
      return res.status(403).json({ error: '该询价尚未分配给当前账号' })
    }
    if (normalizeStatus(row.status) !== QUOTE_REQUEST_STATUS.quoteAccepted) {
      return res.status(409).json({ error: '客户接受报价后才能生成 PI' })
    }
    const piNumber = `PI-${new Date().getFullYear()}-${String(row.id).padStart(4, '0')}`
    db.prepare(`
      UPDATE quote_requests
      SET pi_number = ?, status = ?, updated_at = ?
      WHERE id = ?
    `).run(piNumber, QUOTE_REQUEST_STATUS.piPending, new Date().toISOString(), req.params.id)
    const updated = db.prepare('SELECT * FROM quote_requests WHERE id = ?').get(req.params.id)
    res.json({ quoteRequest: serializeQuoteRequest(updated, req.user) })
  },
)

app.post(
  '/api/quote-requests/:id/confirm-pi',
  requireAuth,
  requireRole('partner', 'customer'),
  (req, res) => {
    const row = db.prepare('SELECT * FROM quote_requests WHERE id = ?').get(req.params.id)
    if (!row || row.customer_id !== req.user.customerId) {
      return res.status(404).json({ error: 'PI 不存在' })
    }
    if (normalizeStatus(row.status) !== QUOTE_REQUEST_STATUS.piPending) {
      return res.status(409).json({ error: '当前 PI 不能确认' })
    }
    db.prepare(`
      UPDATE quote_requests
      SET status = ?, updated_at = ?
      WHERE id = ?
    `).run(QUOTE_REQUEST_STATUS.piConfirmed, new Date().toISOString(), req.params.id)
    const updated = db.prepare('SELECT * FROM quote_requests WHERE id = ?').get(req.params.id)
    res.json({ quoteRequest: serializeQuoteRequest(updated, req.user) })
  },
)

app.get('/api/bootstrap', requireAuth, (req, res) => {
  const user = req.user
  const isInternal = user.role === 'admin' || user.role === 'sales'
  const vehicleRows = isInternal
    ? db.prepare('SELECT * FROM vehicles ORDER BY is_listed DESC, model, year DESC, trim').all()
    : db.prepare('SELECT * FROM vehicles WHERE is_listed = 1 ORDER BY model, year DESC, trim').all()
  const visibleOrders = (user.role === 'sales' ? [] : filterByCustomer(orders, user)).map((order) => {
    const { internalProfit, ...visibleOrder } = order
    if (user.role === 'admin') return { ...visibleOrder, internalProfit }
    if (user.role === 'customer') {
      return { ...visibleOrder, payments: order.payments.map(({ method, proof, ...payment }) => payment) }
    }
    return visibleOrder
  })

  res.json({
    user: publicUser(user),
    permissions: {
      canSeeCost: isInternal,
      canSeeAllCustomers: user.role === 'admin',
      canSeePaymentProof: user.role === 'admin' || user.role === 'partner',
      canManageUsers: user.role === 'admin',
      canManageVehicles: isInternal,
      canAssignInquiries: user.role === 'admin',
      canCreateQuotes: isInternal,
      canRequestQuote: user.role === 'partner' || user.role === 'customer',
    },
    vehicles: vehicleRows.map((vehicle) => serializeVehicle(vehicle, user.role)),
    inquiries: user.role === 'sales' ? [] : filterByCustomer(inquiries, user),
    quotes: user.role === 'sales' ? [] : filterByCustomer(quotes, user),
    quoteRequests: getVisibleQuoteRequests(user).map((row) =>
      serializeQuoteRequest(row, user),
    ),
    staffUsers:
      user.role === 'admin'
        ? db.prepare(`
            SELECT * FROM users
            WHERE role IN ('admin', 'sales')
            ORDER BY is_active DESC, role, display_name
          `).all().map(serializeStaffUser)
        : [],
    assignees:
      isInternal
        ? db.prepare(`
            SELECT * FROM users
            WHERE role IN ('admin', 'sales') AND is_active = 1
            ORDER BY role, display_name
          `).all().map(serializeStaffUser)
        : [],
    notifications:
      isInternal
        ? db.prepare(`
            SELECT id, type, title, message, related_id AS relatedId,
                   is_read AS isRead, created_at AS createdAt
            FROM notifications
            WHERE recipient_username = ?
               OR (recipient_username IS NULL AND recipient_role = ?)
            ORDER BY id DESC
            LIMIT 20
          `).all(user.username, user.role).map((notification) => ({
            ...notification,
            id: Number(notification.id),
            relatedId: notification.relatedId === null ? null : Number(notification.relatedId),
            isRead: Boolean(notification.isRead),
          }))
        : [],
    orders: visibleOrders,
    logistics,
  })
})

app.listen(port, '127.0.0.1', () => {
  console.log(`EV Export API listening on http://127.0.0.1:${port}`)
})
