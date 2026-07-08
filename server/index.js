import bcrypt from 'bcryptjs'
import cookieParser from 'cookie-parser'
import express from 'express'
import jwt from 'jsonwebtoken'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setupSourceImportWorkbench } from './sourceImports.js'
import { runMigrations } from './migrations.js'

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

const COOPERATION_PRICE_MARKUP_USD = 100

function calculateCooperationPrice(supplierPrice) {
  const price = Number(supplierPrice)
  return Number.isFinite(price) && price > 0 ? price + COOPERATION_PRICE_MARKUP_USD : 0
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
    profile_id INTEGER,
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

  CREATE TABLE IF NOT EXISTS vehicle_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brand TEXT NOT NULL,
    model TEXT NOT NULL,
    year TEXT NOT NULL,
    trim TEXT NOT NULL,
    energy_type TEXT NOT NULL DEFAULT '纯电',
    battery_capacity TEXT NOT NULL DEFAULT '',
    range_km INTEGER NOT NULL DEFAULT 0,
    drivetrain TEXT NOT NULL DEFAULT '',
    body_type TEXT NOT NULL DEFAULT '',
    dimensions TEXT NOT NULL DEFAULT '',
    wheelbase TEXT NOT NULL DEFAULT '',
    motor_power TEXT NOT NULL DEFAULT '',
    seats TEXT NOT NULL DEFAULT '',
    fast_charge_time TEXT NOT NULL DEFAULT '',
    slow_charge_time TEXT NOT NULL DEFAULT '',
    official_price TEXT NOT NULL DEFAULT '',
    features TEXT NOT NULL DEFAULT '',
    source_url TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (brand, model, year, trim)
  );

  CREATE TABLE IF NOT EXISTS vehicle_profile_specs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL,
    group_name TEXT NOT NULL,
    spec_name TEXT NOT NULL,
    spec_value TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    source_name TEXT NOT NULL DEFAULT '',
    source_url TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (profile_id) REFERENCES vehicle_profiles(id),
    UNIQUE (profile_id, group_name, spec_name)
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

  CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`)

// Run all pending schema migrations (idempotent, records applied migrations in schema_versions)
runMigrations(db)

// Backfill profile_id for any vehicles that were added before the profile system existed.
// This is data-backfill logic (not schema migration) so it runs on every startup but is O(0) once done.
const vehiclesMissingProfiles = db.prepare('SELECT * FROM vehicles WHERE profile_id IS NULL').all()
if (vehiclesMissingProfiles.length > 0) {
  const now = new Date().toISOString()
  const findProfile = db.prepare(`
    SELECT * FROM vehicle_profiles
    WHERE brand = ? AND model = ? AND year = ? AND trim = ?
  `)
  const insertProfile = db.prepare(`
    INSERT INTO vehicle_profiles (
      brand, model, year, trim, energy_type, battery_capacity, range_km,
      drivetrain, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const updateVehicleProfile = db.prepare('UPDATE vehicles SET profile_id = ? WHERE id = ?')
  db.exec('BEGIN')
  try {
    for (const vehicle of vehiclesMissingProfiles) {
      const modelParts = String(vehicle.model).trim().split(/\s+/)
      const guessedBrand = modelParts[0] || 'Unknown'
      const guessedModel = modelParts.slice(1).join(' ') || vehicle.model
      let profile = findProfile.get(guessedBrand, guessedModel, vehicle.year, vehicle.trim)
      if (!profile) {
        const result = insertProfile.run(
          guessedBrand,
          guessedModel,
          vehicle.year,
          vehicle.trim,
          vehicle.energy_type || '纯电',
          vehicle.battery_capacity || '',
          Number(vehicle.range_km) || 0,
          vehicle.drivetrain || '',
          vehicle.public_notes || '',
          now,
          now,
        )
        profile = { id: result.lastInsertRowid }
      }
      updateVehicleProfile.run(profile.id, vehicle.id)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}



function commonEvSuvSpecs({
  brand,
  model,
  version,
  level,
  price,
  dimensions,
  wheelbase,
  seats = '5 座',
  bodyStructure = '5 门 5 座 SUV',
  motorPower,
  motorTorque = '',
  drivetrain,
  batteryCapacity,
  range,
  batteryType,
  fastCharge = '',
  slowCharge = '',
  energyConsumption = '',
  maxSpeed = '',
  sunroof = '以实车配置为准',
  wheelSize = '以实车配置为准',
  driverAssist = '以版本配置为准',
  panoramicCamera = '以版本配置为准',
  seatFeatures = '以版本配置为准',
  audio = '以版本配置为准',
  ota = '支持',
}) {
  return [
    ['基础信息', '品牌', brand],
    ['基础信息', '车型', model],
    ['基础信息', '版本', version],
    ['基础信息', '能源类型', '纯电'],
    ['基础信息', '级别', level],
    ['基础信息', '国内指导价参考', price],
    ['车身', '长宽高', dimensions],
    ['车身', '轴距', wheelbase],
    ['车身', '车身结构', bodyStructure],
    ['车身', '座位数', seats],
    ['动力', '电机功率', motorPower],
    ['动力', '电机扭矩', motorTorque || '以公开配置为准'],
    ['动力', '驱动方式', drivetrain],
    ['电池/续航', '电池容量', batteryCapacity],
    ['电池/续航', 'CLTC 续航', range],
    ['电池/续航', '电池类型', batteryType],
    ['充电', '快充时间', fastCharge || '以公开配置为准'],
    ['充电', '慢充时间', slowCharge || '以公开配置为准'],
    ['能耗', '百公里耗电', energyConsumption || '以公开配置为准'],
    ['性能', '最高车速', maxSpeed || '以公开配置为准'],
    ['底盘/转向', '前悬架', '麦弗逊式独立悬架'],
    ['底盘/转向', '后悬架', '多连杆式独立悬架'],
    ['底盘/转向', '转向助力', '电动助力'],
    ['底盘/转向', '车体结构', '承载式'],
    ['制动/轮胎', '前制动器', '通风盘式'],
    ['制动/轮胎', '后制动器', '盘式'],
    ['制动/轮胎', '驻车制动', '电子驻车'],
    ['制动/轮胎', '轮毂/轮胎规格', wheelSize],
    ['外部配置', '天窗类型', sunroof],
    ['外部配置', '车顶行李架', '以版本配置为准'],
    ['安全配置', '主动刹车 AEB', '以版本配置为准'],
    ['安全配置', '车身稳定控制', '标配'],
    ['安全配置', '胎压监测', '胎压显示'],
    ['辅助驾驶', '驾驶辅助级别', driverAssist],
    ['辅助驾驶', '自适应巡航', '以版本配置为准'],
    ['辅助驾驶', '360 全景影像', panoramicCamera],
    ['座舱/舒适', '中控屏', '以实车配置为准'],
    ['座舱/舒适', '车联网/OTA', ota],
    ['座舱/舒适', '座椅功能', seatFeatures],
    ['座舱/舒适', '音响', audio],
  ]
}

const officialProfileSeeds = [
  { brand: 'BYD', model: 'Song Plus EV', year: '2025', trim: 'EV 520KM 豪华型', energyType: '纯电', batteryCapacity: '71.8 kWh', rangeKm: 520, drivetrain: '前置前驱', sourceUrl: 'https://auto.ifeng.com/c/8cB5Xo5a8xI', notes: '2025款宋PLUS EV官方/主流公开资料版本' },
  { brand: 'BYD', model: 'Song Plus EV', year: '2025', trim: 'EV 520KM 尊贵型', energyType: '纯电', batteryCapacity: '71.8 kWh', rangeKm: 520, drivetrain: '前置前驱', sourceUrl: 'https://auto.ifeng.com/c/8cB5Xo5a8xI', notes: '2025款宋PLUS EV官方/主流公开资料版本' },
  { brand: 'BYD', model: 'Song Plus EV', year: '2025', trim: 'EV 605KM 旗舰型', energyType: '纯电', batteryCapacity: '87.04 kWh', rangeKm: 605, drivetrain: '前置前驱', sourceUrl: 'https://auto.ifeng.com/c/8cB5Xo5a8xI', notes: '2025款宋PLUS EV官方/主流公开资料版本' },
  { brand: 'Geely', model: 'Galaxy E5', year: '2026', trim: '530KM 启航版', energyType: '纯电', batteryCapacity: '60.22 kWh', rangeKm: 530, drivetrain: '前驱', sourceUrl: 'https://chejiahao.m.autohome.com.cn/info/21218270', notes: '2026款银河E5公开上市版本' },
  { brand: 'Geely', model: 'Galaxy E5', year: '2026', trim: '530KM 探索版', energyType: '纯电', batteryCapacity: '60.22 kWh', rangeKm: 530, drivetrain: '前驱', sourceUrl: 'https://chejiahao.m.autohome.com.cn/info/21218270', notes: '2026款银河E5公开上市版本' },
  { brand: 'Geely', model: 'Galaxy E5', year: '2026', trim: '610KM 远航版', energyType: '纯电', batteryCapacity: '68.39 kWh', rangeKm: 610, drivetrain: '前驱', sourceUrl: 'https://chejiahao.m.autohome.com.cn/info/21218270', notes: '2026款银河E5公开上市版本' },
  { brand: 'Geely', model: 'Galaxy E5', year: '2026', trim: '610KM 探索+版', energyType: '纯电', batteryCapacity: '68.39 kWh', rangeKm: 610, drivetrain: '前驱', sourceUrl: 'https://chejiahao.m.autohome.com.cn/info/21218270', notes: '2026款银河E5公开上市版本' },
  { brand: 'Geely', model: 'Galaxy E5', year: '2026', trim: '610KM 星舰版', energyType: '纯电', batteryCapacity: '68.39 kWh', rangeKm: 610, drivetrain: '前驱', sourceUrl: 'https://chejiahao.m.autohome.com.cn/info/21218270', notes: '2026款银河E5公开上市版本' },
  { brand: 'Changan', model: 'Deepal S07', year: '2025', trim: '520Max 深蓝智驾AD PRO纯电版', energyType: '纯电', batteryCapacity: '68.82 kWh', rangeKm: 520, drivetrain: '后置后驱', sourceUrl: 'https://car.autohome.com.cn/config/spec/71632.html', notes: '2025款深蓝S07纯电公开资料版本' },
  { brand: 'Changan', model: 'Deepal S07', year: '2025', trim: '628Max 乾崑智驾ADS SE纯电版', energyType: '纯电', batteryCapacity: '79.97 kWh', rangeKm: 628, drivetrain: '后置后驱', sourceUrl: 'https://price.pcauto.com.cn/m132566/config.html', notes: '2025款深蓝S07纯电公开资料版本' },
  { brand: 'Changan', model: 'Deepal S07', year: '2026', trim: '550Max 华为乾崑ADS SE版', energyType: '纯电', batteryCapacity: '以官方配置为准', rangeKm: 550, drivetrain: '后置后驱', sourceUrl: 'https://www.qichejingwei.com/brand/range_diff-1118.html', notes: '2026款深蓝S07公开资料版本' },
  { brand: 'Changan', model: 'Deepal S07', year: '2026', trim: '550Ultra 华为乾崑ADS SE版', energyType: '纯电', batteryCapacity: '以官方配置为准', rangeKm: 550, drivetrain: '后置后驱', sourceUrl: 'https://www.qichejingwei.com/brand/range_diff-1118.html', notes: '2026款深蓝S07公开资料版本' },
  { brand: 'Changan', model: 'Deepal S07', year: '2026', trim: '630Max 华为乾崑ADS SE版', energyType: '纯电', batteryCapacity: '以官方配置为准', rangeKm: 630, drivetrain: '后置后驱', sourceUrl: 'https://www.qichejingwei.com/brand/range_diff-1118.html', notes: '2026款深蓝S07公开资料版本' },
  { brand: 'Changan', model: 'Deepal S07', year: '2026', trim: '630Ultra 华为乾崑ADS SE版', energyType: '纯电', batteryCapacity: '以官方配置为准', rangeKm: 630, drivetrain: '后置后驱', sourceUrl: 'https://www.qichejingwei.com/brand/range_diff-1118.html', notes: '2026款深蓝S07公开资料版本' },
  { brand: 'Changan', model: 'Deepal S07', year: '2026', trim: '630Max+ 华为乾崑激光版', energyType: '纯电', batteryCapacity: '以官方配置为准', rangeKm: 630, drivetrain: '后置后驱', sourceUrl: 'https://www.qichejingwei.com/brand/range_diff-1118.html', notes: '2026款深蓝S07公开资料版本' },
  { brand: 'Changan', model: 'Deepal S07', year: '2026', trim: '630Ultra 华为乾崑激光版', energyType: '纯电', batteryCapacity: '以官方配置为准', rangeKm: 630, drivetrain: '后置后驱', sourceUrl: 'https://www.qichejingwei.com/brand/range_diff-1118.html', notes: '2026款深蓝S07公开资料版本' },
]

const sampleProfileSpecs = [
  {
    match: { brand: 'BYD', model: 'Song Plus EV', trimIncludes: '605' },
    sourceName: '汽车之家 / 智车派 / BitAuto',
    sourceUrl: 'https://car.autohome.com.cn/config/spec/71481.html',
    specs: [
      ['基础信息', '品牌', 'BYD / 比亚迪'],
      ['基础信息', '车型', 'Song Plus EV / 宋PLUS EV'],
      ['基础信息', '版本', '605km 旗舰型'],
      ['基础信息', '能源类型', '纯电'],
      ['基础信息', '级别', '紧凑型 SUV'],
      ['基础信息', '国内指导价参考', '17.58 万元'],
      ['车身', '长宽高', '4785 × 1890 × 1660 mm'],
      ['车身', '轴距', '2765 mm'],
      ['车身', '座位数', '5 座'],
      ['动力', '电机功率', '160 kW'],
      ['动力', '驱动方式', '前置前驱'],
      ['电池/续航', '电池容量', '87.04 kWh'],
      ['电池/续航', 'CLTC 续航', '605 km'],
      ['电池/续航', '电池类型', '磷酸铁锂刀片电池'],
      ['充电', '快充', '30%-80% 约 30 分钟'],
      ['充电', '快充功率', '最大约 140 kW'],
      ['能耗', '百公里耗电', '约 13.7 kWh/100km'],
      ['性能', '最高车速', '175 km/h'],
      ['性能', '0-50km/h 加速', '约 4 秒'],
      ['底盘/转向', '前悬架', '麦弗逊式独立悬架'],
      ['底盘/转向', '后悬架', '多连杆式独立悬架'],
      ['底盘/转向', '转向助力', '电动助力'],
      ['底盘/转向', '车体结构', '承载式'],
      ['制动/轮胎', '前制动器', '通风盘式'],
      ['制动/轮胎', '后制动器', '盘式'],
      ['制动/轮胎', '驻车制动', '电子驻车'],
      ['安全配置', '主动刹车', '标配/以实车配置为准'],
      ['安全配置', '车身稳定控制', '标配'],
      ['安全配置', '胎压监测', '胎压显示'],
      ['辅助驾驶', '驾驶辅助级别', 'L2 级辅助驾驶（以版本配置为准）'],
      ['辅助驾驶', '自适应巡航', '标配/以实车配置为准'],
      ['辅助驾驶', '360 全景影像', '标配/以实车配置为准'],
      ['座舱/舒适', '中控屏', '旋转中控大屏（尺寸以实车配置为准）'],
      ['座舱/舒适', '车联网/OTA', '支持'],
      ['座舱/舒适', '热泵空调', '支持'],
    ],
  },
  {
    match: { brand: 'BYD', model: 'Song Plus EV', trimIncludes: '520' },
    sourceName: '公开参数页整理',
    sourceUrl: 'https://car.autohome.com.cn/config/series/5761.html',
    specs: [
      ['基础信息', '品牌', 'BYD / 比亚迪'],
      ['基础信息', '车型', 'Song Plus EV / 宋PLUS EV'],
      ['基础信息', '版本', '520km 版本'],
      ['基础信息', '能源类型', '纯电'],
      ['基础信息', '级别', '紧凑型 SUV'],
      ['车身', '长宽高', '4785 × 1890 × 1660 mm'],
      ['车身', '轴距', '2765 mm'],
      ['车身', '座位数', '5 座'],
      ['动力', '电机功率', '150 kW'],
      ['动力', '驱动方式', '前置前驱'],
      ['电池/续航', '电池容量', '71.8 kWh'],
      ['电池/续航', 'CLTC 续航', '520 km'],
      ['电池/续航', '电池类型', '磷酸铁锂刀片电池'],
      ['充电', '快充', '30%-80% 约 30 分钟'],
      ['充电', '快充功率', '最大约 90 kW'],
      ['能耗', '百公里耗电', '约 13.7 kWh/100km'],
      ['性能', '最高车速', '175 km/h'],
      ['性能', '0-50km/h 加速', '约 4 秒'],
      ['底盘/转向', '前悬架', '麦弗逊式独立悬架'],
      ['底盘/转向', '后悬架', '多连杆式独立悬架'],
      ['底盘/转向', '转向助力', '电动助力'],
      ['底盘/转向', '车体结构', '承载式'],
      ['制动/轮胎', '前制动器', '通风盘式'],
      ['制动/轮胎', '后制动器', '盘式'],
      ['制动/轮胎', '驻车制动', '电子驻车'],
      ['安全配置', '主动刹车', '标配/以实车配置为准'],
      ['安全配置', '车身稳定控制', '标配'],
      ['安全配置', '胎压监测', '胎压显示'],
      ['辅助驾驶', '驾驶辅助级别', 'L2 级辅助驾驶（以版本配置为准）'],
      ['辅助驾驶', '自适应巡航', '标配/以实车配置为准'],
      ['辅助驾驶', '360 全景影像', '标配/以实车配置为准'],
      ['座舱/舒适', '中控屏', '旋转中控大屏（尺寸以实车配置为准）'],
      ['座舱/舒适', '车联网/OTA', '支持'],
      ['座舱/舒适', '热泵空调', '支持'],
    ],
  },
  {
    match: { brand: 'Changan', model: 'Deepal S07' },
    sourceName: '新出行 / 汽车之家 / Changan Europe',
    sourceUrl: 'https://car.autohome.com.cn/config/spec/71635.html',
    specs: [
      ['基础信息', '品牌', 'Changan Deepal / 长安深蓝'],
      ['基础信息', '车型', 'Deepal S07 / 深蓝 S07'],
      ['基础信息', '版本', '520 Pro / 520Max Pro'],
      ['基础信息', '能源类型', '纯电'],
      ['基础信息', '级别', '中型 SUV'],
      ['基础信息', '国内指导价参考', '17.99 万元左右'],
      ['车身', '长宽高', '4750 × 1930 × 1625 mm'],
      ['车身', '轴距', '2900 mm'],
      ['车身', '座位数', '5 座'],
      ['动力', '电机功率', '190 kW'],
      ['动力', '电机马力', '258 Ps'],
      ['动力', '驱动方式', '后置后驱'],
      ['电池/续航', '电池容量', '68.82 kWh'],
      ['电池/续航', 'CLTC 续航', '520 km'],
      ['电池/续航', '电池类型', '磷酸铁锂电池'],
      ['充电', '快充时间', '约 0.25 小时'],
      ['充电', '快充电量范围', '30%-80%'],
      ['性能', '最高车速', '180 km/h'],
      ['底盘/转向', '前悬架', '麦弗逊式独立悬架'],
      ['底盘/转向', '后悬架', 'H 臂多连杆独立悬架'],
      ['底盘/转向', '转向助力', '电动助力'],
      ['底盘/转向', '车体结构', '承载式'],
      ['制动/轮胎', '前制动器', '通风盘式'],
      ['制动/轮胎', '后制动器', '盘式'],
      ['制动/轮胎', '驻车制动', '电子驻车'],
      ['安全配置', '主动刹车', '标配/以实车配置为准'],
      ['安全配置', '车道偏离预警', '标配/以实车配置为准'],
      ['安全配置', '车身稳定控制', '标配'],
      ['安全配置', '胎压监测', '胎压显示'],
      ['辅助驾驶', '驾驶辅助级别', 'L2 级辅助驾驶（以版本配置为准）'],
      ['辅助驾驶', '自适应巡航', '标配/以实车配置为准'],
      ['辅助驾驶', '360 全景影像', '标配/以实车配置为准'],
      ['座舱/舒适', '中控屏', '悬浮式中控屏（尺寸以实车配置为准）'],
      ['座舱/舒适', '车联网/OTA', '支持'],
      ['座舱/舒适', '座椅功能', '加热/通风按版本配置'],
    ],
  },
  {
    match: { brand: 'Geely', model: 'Galaxy E5', trimIncludes: '530' },
    sourceName: '吉利银河官网 / 官方配置表 / 汽车之家',
    sourceUrl: 'https://www.galaxy-geely.com/E5',
    specs: [
      ['基础信息', '品牌', 'Geely Galaxy / 吉利银河'],
      ['基础信息', '车型', 'Galaxy E5 / 银河 E5'],
      ['基础信息', '版本', '530km 探索版'],
      ['基础信息', '能源类型', '纯电'],
      ['基础信息', '级别', '紧凑型 SUV'],
      ['基础信息', '国内指导价参考', '11.98 万元'],
      ['车身', '长宽高', '4615 × 1901 × 1670 mm'],
      ['车身', '轴距', '2750 mm'],
      ['车身', '车身结构', '5 门 5 座 SUV'],
      ['动力', '电机功率', '160 kW'],
      ['动力', '电机扭矩', '320 N·m'],
      ['动力', '驱动方式', '前驱'],
      ['电池/续航', '电池容量', '60.22 kWh'],
      ['电池/续航', 'CLTC 续航', '530 km'],
      ['电池/续航', '电池类型', '磷酸铁锂电池'],
      ['能耗', '百公里耗电', '约 12.1 kWh/100km'],
      ['配置', '代表配置', '全景天窗、16 扬声器、前排座椅加热/通风、50W 无线充、L2 辅助驾驶、AEB'],
      ['充电', '快充时间', '约 0.33 小时'],
      ['充电', '慢充时间', '约 9 小时'],
      ['性能', '最高车速', '175 km/h'],
      ['底盘/转向', '前悬架', '麦弗逊式独立悬架'],
      ['底盘/转向', '后悬架', '多连杆式独立悬架'],
      ['底盘/转向', '转向助力', '电动助力'],
      ['底盘/转向', '车体结构', '承载式'],
      ['制动/轮胎', '前制动器', '通风盘式'],
      ['制动/轮胎', '后制动器', '盘式'],
      ['制动/轮胎', '驻车制动', '电子驻车'],
      ['安全配置', '主动刹车 AEB', '标配/以实车配置为准'],
      ['安全配置', '车身稳定控制', '标配'],
      ['安全配置', '胎压监测', '胎压显示'],
      ['辅助驾驶', '驾驶辅助级别', 'L2 级辅助驾驶（以版本配置为准）'],
      ['辅助驾驶', '360 全景影像', '标配/以实车配置为准'],
      ['座舱/舒适', '中控屏', 'Flyme Auto 智能座舱大屏（以实车配置为准）'],
      ['座舱/舒适', '车联网/OTA', '支持'],
      ['座舱/舒适', '无线充电', '50W（以版本配置为准）'],
      ['座舱/舒适', '音响', '16 扬声器（以版本配置为准）'],
    ],
  },
  {
    match: { brand: 'Geely', model: 'Galaxy E5', trimIncludes: '440' },
    sourceName: '吉利银河官方配置表',
    sourceUrl: 'https://global.geely.com/-/media/project/web-portal/parallel-car/e5/geely-galaxy-e5-specification-table.pdf',
    specs: [
      ['基础信息', '品牌', 'Geely Galaxy / 吉利银河'],
      ['基础信息', '车型', 'Galaxy E5 / 银河 E5'],
      ['基础信息', '版本', '440km 版本'],
      ['基础信息', '能源类型', '纯电'],
      ['基础信息', '级别', '紧凑型 SUV'],
      ['车身', '长宽高', '4615 × 1901 × 1670 mm'],
      ['车身', '轴距', '2750 mm'],
      ['车身', '车身结构', '5 门 5 座 SUV'],
      ['动力', '电机功率', '160 kW'],
      ['动力', '电机扭矩', '320 N·m'],
      ['动力', '驱动方式', '前驱'],
      ['电池/续航', '电池容量', '49.52 kWh'],
      ['电池/续航', 'CLTC 续航', '440 km'],
      ['电池/续航', '电池类型', '磷酸铁锂电池'],
      ['能耗', '百公里耗电', '约 11.9 kWh/100km'],
      ['充电', '快充时间', '约 0.33 小时'],
      ['充电', '慢充时间', '约 9 小时'],
      ['性能', '最高车速', '175 km/h'],
      ['底盘/转向', '前悬架', '麦弗逊式独立悬架'],
      ['底盘/转向', '后悬架', '多连杆式独立悬架'],
      ['底盘/转向', '转向助力', '电动助力'],
      ['底盘/转向', '车体结构', '承载式'],
      ['制动/轮胎', '前制动器', '通风盘式'],
      ['制动/轮胎', '后制动器', '盘式'],
      ['制动/轮胎', '驻车制动', '电子驻车'],
      ['安全配置', '主动刹车 AEB', '按版本配置'],
      ['安全配置', '车身稳定控制', '标配'],
      ['安全配置', '胎压监测', '胎压显示'],
      ['辅助驾驶', '驾驶辅助级别', '按版本配置'],
      ['辅助驾驶', '360 全景影像', '按版本配置'],
      ['座舱/舒适', '中控屏', 'Flyme Auto 智能座舱大屏（以实车配置为准）'],
      ['座舱/舒适', '车联网/OTA', '支持'],
    ],
  },
  ...officialProfileSeeds.map((profile) => ({
    match: { brand: profile.brand, model: profile.model, year: profile.year, trim: profile.trim },
    sourceName: profile.notes,
    sourceUrl: profile.sourceUrl,
    specs: commonEvSuvSpecs({
      brand: `${profile.brand}${profile.brand === 'BYD' ? ' / 比亚迪' : profile.brand === 'Geely' ? ' Galaxy / 吉利银河' : ' Deepal / 长安深蓝'}`,
      model: profile.model,
      version: `${profile.year} ${profile.trim}`,
      level: profile.model === 'Deepal S07' ? '中型 SUV' : '紧凑型 SUV',
      price: profile.trim.includes('豪华') ? '14.98 万元左右'
        : profile.trim.includes('尊贵') ? '15.98 万元左右'
          : profile.trim.includes('605') ? '17.58 万元左右'
            : profile.trim.includes('610') ? '12.58-14.58 万元区间（按版本）'
              : profile.trim.includes('630') ? '16.49-17.49 万元区间（按版本）'
                : '以官方上市价格为准',
      dimensions: profile.model === 'Song Plus EV'
        ? '4785 × 1890 × 1660 mm'
        : profile.model === 'Deepal S07'
          ? '4750 × 1930 × 1625 mm'
          : '4615 × 1901 × 1670 mm',
      wheelbase: profile.model === 'Deepal S07' ? '2900 mm' : profile.model === 'Song Plus EV' ? '2765 mm' : '2750 mm',
      motorPower: profile.model === 'Deepal S07' ? (profile.trim.includes('630') ? '200 kW' : '190 kW') : profile.model === 'Song Plus EV' ? (profile.trim.includes('605') ? '160 kW' : '150 kW') : '160 kW',
      motorTorque: profile.model === 'Galaxy E5' ? '320 N·m' : '以官方配置为准',
      drivetrain: profile.drivetrain,
      batteryCapacity: profile.batteryCapacity,
      range: `${profile.rangeKm} km`,
      batteryType: profile.model === 'Song Plus EV' ? '磷酸铁锂刀片电池' : '磷酸铁锂电池',
      fastCharge: profile.model === 'Deepal S07' ? '约 0.25 小时' : '约 0.33-0.5 小时',
      slowCharge: '以官方配置为准',
      energyConsumption: profile.model === 'Galaxy E5' ? (profile.trim.includes('610') ? '以官方配置为准' : '约 12 kWh/100km') : '以官方配置为准',
      maxSpeed: profile.model === 'Deepal S07' ? '180 km/h' : '175 km/h',
      sunroof: profile.model === 'Galaxy E5'
        ? '全景天窗（以版本配置为准）'
        : '全景天窗/可开启全景天窗以版本配置为准',
      wheelSize: profile.model === 'Galaxy E5' ? '18/19 英寸（以版本配置为准）' : '以版本配置为准',
      driverAssist: profile.model === 'Deepal S07'
        ? (profile.trim.includes('乾崑') || profile.trim.includes('华为') ? '华为乾崑智驾/ADS SE（以版本配置为准）' : '深蓝智驾 AD PRO')
        : 'L2 级辅助驾驶（以版本配置为准）',
      panoramicCamera: profile.trim.includes('豪华') || profile.trim.includes('启航') ? '以版本配置为准' : '标配/以实车配置为准',
      seatFeatures: profile.trim.includes('星舰') || profile.trim.includes('Ultra') ? '加热/通风/按摩按版本配置' : '加热/通风按版本配置',
      audio: profile.trim.includes('星舰') || profile.trim.includes('探索') ? '高阶音响按版本配置' : '以版本配置为准',
    }),
  })),
]

function seedOfficialVehicleProfiles() {
  const now = new Date().toISOString()
  const insertProfile = db.prepare(`
    INSERT OR IGNORE INTO vehicle_profiles (
      brand, model, year, trim, energy_type, battery_capacity, range_km,
      drivetrain, source_url, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  db.exec('BEGIN')
  try {
    for (const profile of officialProfileSeeds) {
      insertProfile.run(
        profile.brand,
        profile.model,
        profile.year,
        profile.trim,
        profile.energyType,
        profile.batteryCapacity,
        profile.rangeKm,
        profile.drivetrain,
        profile.sourceUrl,
        profile.notes,
        now,
        now,
      )
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function seedVehicleProfileSpecs() {
  const now = new Date().toISOString()
  const profiles = db.prepare('SELECT * FROM vehicle_profiles').all()
  const insertSpec = db.prepare(`
    INSERT OR IGNORE INTO vehicle_profile_specs (
      profile_id, group_name, spec_name, spec_value, sort_order, source_name, source_url, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  db.exec('BEGIN')
  try {
    for (const profile of profiles) {
      const matched = sampleProfileSpecs.find((sample) =>
        profile.brand === sample.match.brand &&
        profile.model === sample.match.model &&
        (!sample.match.year || String(profile.year) === sample.match.year) &&
        (!sample.match.trim || String(profile.trim) === sample.match.trim) &&
        (!sample.match.trimIncludes || String(profile.trim).includes(sample.match.trimIncludes)),
      )
      if (!matched) continue
      matched.specs.forEach(([groupName, specName, specValue], index) => {
        if (groupName === '基础信息') return
        insertSpec.run(
          profile.id,
          groupName,
          specName,
          specValue,
          index + 1,
          matched.sourceName,
          matched.sourceUrl,
          now,
          now,
        )
      })
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

seedOfficialVehicleProfiles()
seedVehicleProfileSpecs()

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

function serializeVehicleProfile(row) {
  const specs = db.prepare(`
    SELECT * FROM vehicle_profile_specs
    WHERE profile_id = ?
    ORDER BY sort_order, id
  `).all(row.id).map((spec) => ({
    id: Number(spec.id),
    groupName: spec.group_name,
    name: spec.spec_name,
    value: spec.spec_value,
    sortOrder: Number(spec.sort_order),
    sourceName: spec.source_name,
    sourceUrl: spec.source_url,
    updatedAt: spec.updated_at,
  }))
  return {
    id: Number(row.id),
    brand: row.brand,
    model: row.model,
    year: row.year,
    trim: row.trim,
    energyType: row.energy_type,
    batteryCapacity: row.battery_capacity,
    rangeKm: Number(row.range_km),
    drivetrain: row.drivetrain,
    bodyType: row.body_type,
    dimensions: row.dimensions,
    wheelbase: row.wheelbase,
    motorPower: row.motor_power,
    seats: row.seats,
    fastChargeTime: row.fast_charge_time,
    slowChargeTime: row.slow_charge_time,
    officialPrice: row.official_price,
    features: row.features,
    sourceUrl: row.source_url,
    notes: row.notes,
    specs,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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

function normalizeVehicleProfileInput(body) {
  const profile = {
    brand: String(body?.brand ?? '').trim(),
    model: String(body?.model ?? '').trim(),
    year: String(body?.year ?? '').trim(),
    trim: String(body?.trim ?? '').trim(),
    energyType: String(body?.energyType ?? body?.energy_type ?? '纯电').trim() || '纯电',
    batteryCapacity: String(body?.batteryCapacity ?? body?.battery_capacity ?? '').trim(),
    rangeKm: Math.max(0, Number(body?.rangeKm ?? body?.range_km) || 0),
    drivetrain: String(body?.drivetrain ?? '').trim(),
    bodyType: String(body?.bodyType ?? body?.body_type ?? '').trim(),
    dimensions: String(body?.dimensions ?? '').trim(),
    wheelbase: String(body?.wheelbase ?? '').trim(),
    motorPower: String(body?.motorPower ?? body?.motor_power ?? '').trim(),
    seats: String(body?.seats ?? '').trim(),
    fastChargeTime: String(body?.fastChargeTime ?? body?.fast_charge_time ?? '').trim(),
    slowChargeTime: String(body?.slowChargeTime ?? body?.slow_charge_time ?? '').trim(),
    officialPrice: String(body?.officialPrice ?? body?.official_price ?? '').trim(),
    features: String(body?.features ?? '').trim(),
    sourceUrl: String(body?.sourceUrl ?? body?.source_url ?? '').trim(),
    notes: String(body?.notes ?? '').trim(),
  }
  if (!profile.brand || !profile.model || !profile.year || !profile.trim) {
    throw new Error('请填写品牌、车型、年款和配置版本')
  }
  return profile
}

function parseCsvLine(line) {
  const cells = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const next = line[index + 1]
    if (char === '"' && quoted && next === '"') {
      cell += '"'
      index += 1
    } else if (char === '"') {
      quoted = !quoted
    } else if (char === ',' && !quoted) {
      cells.push(cell.trim())
      cell = ''
    } else {
      cell += char
    }
  }
  cells.push(cell.trim())
  return cells
}

function normalizeCsvHeader(header) {
  return String(header).trim().toLowerCase().replace(/\s+/g, '')
}

const profileCsvHeaderMap = new Map([
  ['brand', 'brand'],
  ['品牌', 'brand'],
  ['model', 'model'],
  ['车型', 'model'],
  ['year', 'year'],
  ['年款', 'year'],
  ['trim', 'trim'],
  ['version', 'trim'],
  ['配置', 'trim'],
  ['版本', 'trim'],
  ['配置版本', 'trim'],
  ['energytype', 'energyType'],
  ['能源类型', 'energyType'],
  ['batterycapacity', 'batteryCapacity'],
  ['电池容量', 'batteryCapacity'],
  ['rangekm', 'rangeKm'],
  ['续航', 'rangeKm'],
  ['续航里程', 'rangeKm'],
  ['drivetrain', 'drivetrain'],
  ['驱动方式', 'drivetrain'],
  ['bodytype', 'bodyType'],
  ['车身结构', 'bodyType'],
  ['dimensions', 'dimensions'],
  ['长宽高', 'dimensions'],
  ['wheelbase', 'wheelbase'],
  ['轴距', 'wheelbase'],
  ['motorpower', 'motorPower'],
  ['电机功率', 'motorPower'],
  ['seats', 'seats'],
  ['座位数', 'seats'],
  ['fastchargetime', 'fastChargeTime'],
  ['快充时间', 'fastChargeTime'],
  ['slowchargetime', 'slowChargeTime'],
  ['慢充时间', 'slowChargeTime'],
  ['officialprice', 'officialPrice'],
  ['官方指导价', 'officialPrice'],
  ['features', 'features'],
  ['主要配置', 'features'],
  ['sourceurl', 'sourceUrl'],
  ['资料来源', 'sourceUrl'],
  ['notes', 'notes'],
  ['备注', 'notes'],
])

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
  const profileRow = row.profile_id
    ? db.prepare('SELECT * FROM vehicle_profiles WHERE id = ?').get(row.profile_id)
    : null
  const priceValidUntil = row.price_valid_until
  const isPriceValid =
    Boolean(priceValidUntil) && new Date(priceValidUntil).getTime() >= Date.now()
  const base = {
    id: row.id,
    profileId: row.profile_id ? Number(row.profile_id) : null,
    profile: profileRow ? serializeVehicleProfile(profileRow) : null,
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
    canSeePrice: role === 'admin' || role === 'sales' || role === 'partner',
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
        priceExw: source.price_exw ? Number(source.price_exw) : null,
        priceExwCurrency: source.price_exw_currency,
        priceFca: source.price_fca ? Number(source.price_fca) : null,
        priceFcaCurrency: source.price_fca_currency,
        priceFob: source.price_fob ? Number(source.price_fob) : null,
        priceFobCurrency: source.price_fob_currency,
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
      costExw: row.cost_exw ? Number(row.cost_exw) : null,
      costExwCurrency: row.cost_exw_currency,
      costFca: row.cost_fca ? Number(row.cost_fca) : null,
      costFcaCurrency: row.cost_fca_currency,
      costFob: row.cost_fob ? Number(row.cost_fob) : null,
      costFobCurrency: row.cost_fob_currency,
      visiblePrice: row.partner_price,
      partnerPriceExw: row.partner_price_exw ? Number(row.partner_price_exw) : null,
      partnerPriceFca: row.partner_price_fca ? Number(row.partner_price_fca) : null,
      partnerPriceFob: row.partner_price_fob ? Number(row.partner_price_fob) : null,
      customerPriceExw: row.customer_price_exw ? Number(row.customer_price_exw) : null,
      customerPriceFca: row.customer_price_fca ? Number(row.customer_price_fca) : null,
      customerPriceFob: row.customer_price_fob ? Number(row.customer_price_fob) : null,
      priceLabel: '合作报价',
      supplierSources,
      priceHistory,
    }
  }
  if (role === 'partner') {
    return {
      ...base,
      visiblePrice: row.partner_price,
      partnerPriceExw: row.partner_price_exw ? Number(row.partner_price_exw) : null,
      partnerPriceFca: row.partner_price_fca ? Number(row.partner_price_fca) : null,
      partnerPriceFob: row.partner_price_fob ? Number(row.partner_price_fob) : null,
      priceLabel: '合作报价'
    }
  }
  return {
    ...base,
    visiblePrice: 0,
    customerPriceExw: row.customer_price_exw ? Number(row.customer_price_exw) : null,
    customerPriceFca: row.customer_price_fca ? Number(row.customer_price_fca) : null,
    customerPriceFob: row.customer_price_fob ? Number(row.customer_price_fob) : null,
    priceLabel: '指导价'
  }
}

function nextVehicleId() {
  const rows = db.prepare("SELECT id FROM vehicles WHERE id LIKE 'EV-%'").all()
  const maxId = rows.reduce((max, row) => {
    const number = Number(String(row.id).replace('EV-', ''))
    return Number.isFinite(number) ? Math.max(max, number) : max
  }, 0)
  return `EV-${String(maxId + 1).padStart(3, '0')}`
}

function syncVehicleAvailability(vehicleId, changedBy = 'system', priceNote = '') {
  const sources = db.prepare('SELECT * FROM supplier_sources WHERE vehicle_id = ?').all(vehicleId)
  const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(vehicleId)
  if (!vehicle) return
  const stockQuantity = sources.reduce((sum, source) => sum + Number(source.stock_quantity), 0)
  const colorTotals = new Map()
  for (const source of sources) {
    let parsedColors = []
    try {
      parsedColors = JSON.parse(source.stock_colors || '[]')
    } catch (e) {
      parsedColors = []
    }
    for (const entry of parsedColors) {
      if (entry && entry.color) {
        colorTotals.set(entry.color, (colorTotals.get(entry.color) ?? 0) + Number(entry.quantity || 0))
      }
    }
  }
  const preorderSources = sources.filter((source) => Boolean(source.can_preorder))
  const status = stockQuantity > 0
    ? VEHICLE_STATUS.inStock
    : preorderSources.length > 0
      ? VEHICLE_STATUS.preorder
      : VEHICLE_STATUS.unavailable
  const preorderMinDays = preorderSources.length > 0
    ? Math.min(...preorderSources.map((source) => Number(source.preorder_min_days || 0)))
    : 0
  const preorderMaxDays = preorderSources.length > 0
    ? Math.max(...preorderSources.map((source) => Number(source.preorder_max_days || 0)))
    : 0

  const exwSources = sources.map((s) => ({ price: Number(s.price_exw), currency: s.price_exw_currency || 'USD' })).filter((s) => s.price > 0)
  const fcaSources = sources.map((s) => ({ price: Number(s.price_fca), currency: s.price_fca_currency || 'USD' })).filter((s) => s.price > 0)
  const fobSources = sources.map((s) => ({ price: Number(s.price_fob), currency: s.price_fob_currency || 'USD' })).filter((s) => s.price > 0)

  const rateRow = db.prepare("SELECT value FROM system_settings WHERE key = 'exchange_rate'").get()
  const exchangeRate = Number(rateRow?.value ?? 7.2)

  function toUsd(price, currency) {
    if (currency === 'CNY') return price / exchangeRate
    return price
  }

  function lowestSource(sourceRows) {
    if (sourceRows.length === 0) return { price: 0, currency: 'USD' }
    return sourceRows.reduce((min, s) => {
      return toUsd(s.price, s.currency) < toUsd(min.price, min.currency) ? s : min
    }, sourceRows[0])
  }

  function cooperationPriceFor(price, currency) {
    if (price <= 0) return 0
    return currency === 'CNY'
      ? price + COOPERATION_PRICE_MARKUP_USD * exchangeRate
      : price + COOPERATION_PRICE_MARKUP_USD
  }

  const lowestExw = lowestSource(exwSources)
  const lowestFca = lowestSource(fcaSources)
  const lowestFob = lowestSource(fobSources)
  const lowestExwCost = lowestExw.price
  const lowestExwCurrency = lowestExw.currency
  const lowestFcaCost = lowestFca.price
  const lowestFcaCurrency = lowestFca.currency
  const lowestFobCost = lowestFob.price
  const lowestFobCurrency = lowestFob.currency
  const partnerPriceExw = cooperationPriceFor(lowestExwCost, lowestExwCurrency)
  const partnerPriceFca = cooperationPriceFor(lowestFcaCost, lowestFcaCurrency)
  const partnerPriceFob = cooperationPriceFor(lowestFobCost, lowestFobCurrency)

  const cost = lowestExwCost > 0 ? lowestExwCost : (lowestFcaCost > 0 ? lowestFcaCost : (lowestFobCost > 0 ? lowestFobCost : 0))
  const cooperationPrice = partnerPriceExw > 0 ? partnerPriceExw : (partnerPriceFca > 0 ? partnerPriceFca : (partnerPriceFob > 0 ? partnerPriceFob : 0))
  const now = new Date()
  const validUntil = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)

  // Update vehicle
  db.prepare(`
    UPDATE vehicles
    SET status = ?, stock_quantity = ?, stock_colors = ?,
        preorder_min_days = ?, preorder_max_days = ?, cost = ?,
        partner_price = CASE WHEN ? > 0 THEN ? ELSE partner_price END,
        customer_price = CASE WHEN ? > 0 THEN ? ELSE customer_price END,
        cost_exw = ?, cost_exw_currency = ?,
        cost_fca = ?, cost_fca_currency = ?,
        cost_fob = ?, cost_fob_currency = ?,
        partner_price_exw = ?, partner_price_fca = ?, partner_price_fob = ?,
        customer_price_exw = ?, customer_price_fca = ?, customer_price_fob = ?,
        price_updated_at = CASE WHEN ? > 0 THEN ? ELSE price_updated_at END,
        price_valid_until = CASE WHEN ? > 0 THEN ? ELSE price_valid_until END
    WHERE id = ?
  `).run(
    status,
    stockQuantity,
    JSON.stringify([...colorTotals.entries()].map(([color, quantity]) => ({ color, quantity }))),
    preorderMinDays,
    preorderMaxDays,
    cost,
    cooperationPrice,
    cooperationPrice,
    cooperationPrice,
    cooperationPrice,
    lowestExwCost > 0 ? lowestExwCost : null,
    lowestExwCost > 0 ? lowestExwCurrency : null,
    lowestFcaCost > 0 ? lowestFcaCost : null,
    lowestFcaCost > 0 ? lowestFcaCurrency : null,
    lowestFobCost > 0 ? lowestFobCost : null,
    lowestFobCost > 0 ? lowestFobCurrency : null,
    partnerPriceExw > 0 ? partnerPriceExw : null,
    partnerPriceFca > 0 ? partnerPriceFca : null,
    partnerPriceFob > 0 ? partnerPriceFob : null,
    partnerPriceExw > 0 ? partnerPriceExw : null,
    partnerPriceFca > 0 ? partnerPriceFca : null,
    partnerPriceFob > 0 ? partnerPriceFob : null,
    cooperationPrice,
    now.toISOString(),
    cooperationPrice,
    validUntil.toISOString(),
    vehicleId
  )

  if (cooperationPrice > 0 && Number(vehicle.partner_price) !== cooperationPrice) {
    db.prepare(`
      INSERT INTO vehicle_price_history (
        vehicle_id, partner_price, valid_from, valid_until, changed_by, notes
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      vehicleId,
      cooperationPrice,
      now.toISOString(),
      validUntil.toISOString(),
      changedBy,
      priceNote || `按最低供应商报价自动生成 EXW/FCA/FOB 合作价`,
    )
  }
}

function normalizeSourceInput(body) {
  const {
    supplierName,
    stockColors = [],
    canPreorder = true,
    preorderMinDays = 0,
    preorderMaxDays = 0,
    supplierPrice,
    priceExw,
    priceExwCurrency = 'USD',
    priceFca,
    priceFcaCurrency = 'USD',
    priceFob,
    priceFobCurrency = 'USD',
    notes = '',
  } = body ?? {}
  const normalizedSupplierName = String(supplierName ?? '').trim()
  const exwPrice = priceExw === null || priceExw === '' || priceExw === undefined ? null : Number(priceExw)
  const fcaPrice = priceFca === null || priceFca === '' || priceFca === undefined ? null : Number(priceFca)
  const fobPrice = priceFob === null || priceFob === '' || priceFob === undefined ? null : Number(priceFob)
  const legacyPrice = Number(supplierPrice) || exwPrice || fcaPrice || fobPrice || 0
  const colors = Array.isArray(stockColors)
    ? stockColors
      .map((entry) => ({
        color: String(entry?.color ?? '').trim(),
        quantity: Math.max(0, Math.floor(Number(entry?.quantity) || 0)),
      }))
      .filter((entry) => entry.color && entry.quantity > 0)
    : []
  const stockQuantity = colors.reduce((sum, entry) => sum + entry.quantity, 0)
  const minDays = Math.max(0, Math.floor(Number(preorderMinDays) || 0))
  const maxDays = Math.max(0, Math.floor(Number(preorderMaxDays) || 0))
  if (!normalizedSupplierName) throw new Error('请填写供应商名称')
  if (![exwPrice, fcaPrice, fobPrice, legacyPrice].some((price) => Number.isFinite(price) && Number(price) > 0)) {
    throw new Error('请至少填写一个 EXW、FCA 或 FOB 报价')
  }
  if (canPreorder && (minDays < 1 || maxDays < minDays)) {
    throw new Error('请填写正确的预订周期')
  }
  return {
    supplierName: normalizedSupplierName,
    supplierPrice: legacyPrice,
    priceExw: Number.isFinite(exwPrice) && exwPrice > 0 ? exwPrice : null,
    priceExwCurrency: String(priceExwCurrency || 'USD').trim(),
    priceFca: Number.isFinite(fcaPrice) && fcaPrice > 0 ? fcaPrice : null,
    priceFcaCurrency: String(priceFcaCurrency || 'USD').trim(),
    priceFob: Number.isFinite(fobPrice) && fobPrice > 0 ? fobPrice : null,
    priceFobCurrency: String(priceFobCurrency || 'USD').trim(),
    canPreorder: Boolean(canPreorder),
    preorderMinDays: canPreorder ? minDays : 0,
    preorderMaxDays: canPreorder ? maxDays : 0,
    stockColors: colors,
    stockQuantity,
    notes: String(notes ?? '').trim(),
  }
}

function serializeQuoteRequest(row, user) {
  const canSeeRequestPricing = user.role !== 'customer'
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
      basePriceSnapshot: canSeeRequestPricing ? Number(item.base_price_snapshot) : 0,
      quantity: Number(item.quantity),
      suggestedProfit: canSeeRequestPricing ? Number(item.suggested_profit) : 0,
      agreedProfit: canSeeRequestPricing ? agreedProfit : null,
      unitPrice: canSeeRequestPricing ? unitPrice : 0,
      subtotal: canSeeRequestPricing ? unitPrice * Number(item.quantity) : 0,
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
    basePriceSnapshot: canSeeRequestPricing ? Number(row.base_price_snapshot) : 0,
    quantity: items.reduce((sum, item) => sum + item.quantity, 0),
    suggestedProfit: canSeeRequestPricing ? Number(row.suggested_profit) : 0,
    agreedProfit: canSeeRequestPricing && row.agreed_profit !== null ? Number(row.agreed_profit) : null,
    items,
    versions,
    revisionRequests,
    destinationPort: row.destination_port,
    tradeTerm: row.trade_term,
    freight: canSeeRequestPricing ? Number(row.freight) : 0,
    otherFees: canSeeRequestPricing ? Number(row.other_fees) : 0,
    notes: row.notes,
    status: normalizeStatus(row.status),
    piNumber: row.pi_number,
    vehicleUnitPrice: canSeeRequestPricing && items.length === 1 ? items[0].unitPrice : 0,
    total: canSeeRequestPricing ? total : 0,
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

app.get('/api/settings/exchange-rate', requireAuth, (req, res) => {
  const row = db.prepare("SELECT value FROM system_settings WHERE key = 'exchange_rate'").get()
  res.json({ exchangeRate: Number(row?.value ?? 7.2) })
})

app.post('/api/settings/exchange-rate', requireAuth, requireRole('admin', 'sales'), (req, res) => {
  const rate = Number(req.body?.exchangeRate)
  if (!rate || isNaN(rate) || rate <= 0) {
    return res.status(400).json({ error: '请输入有效的正数汇率' })
  }
  db.prepare("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('exchange_rate', ?)").run(String(rate))
  res.json({ exchangeRate: rate })
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
  '/api/vehicle-profiles',
  requireAuth,
  requireRole('admin', 'sales'),
  (req, res) => {
    let profile
    try {
      profile = normalizeVehicleProfileInput(req.body)
    } catch (error) {
      return res.status(400).json({ error: error.message })
    }
    const now = new Date().toISOString()
    try {
      const result = db.prepare(`
        INSERT INTO vehicle_profiles (
          brand, model, year, trim, energy_type, battery_capacity, range_km,
          drivetrain, body_type, dimensions, wheelbase, motor_power, seats,
          fast_charge_time, slow_charge_time, official_price, features,
          source_url, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        profile.brand, profile.model, profile.year, profile.trim, profile.energyType,
        profile.batteryCapacity, profile.rangeKm, profile.drivetrain, profile.bodyType,
        profile.dimensions, profile.wheelbase, profile.motorPower, profile.seats,
        profile.fastChargeTime, profile.slowChargeTime, profile.officialPrice,
        profile.features, profile.sourceUrl, profile.notes, now, now,
      )
      const created = db.prepare('SELECT * FROM vehicle_profiles WHERE id = ?').get(result.lastInsertRowid)
      res.status(201).json({ vehicleProfile: serializeVehicleProfile(created) })
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) {
        return res.status(400).json({ error: '车型库中已存在同品牌、车型、年款和版本' })
      }
      throw error
    }
  },
)

app.patch(
  '/api/vehicle-profiles/:profileId',
  requireAuth,
  requireRole('admin', 'sales'),
  (req, res) => {
    const existing = db.prepare('SELECT * FROM vehicle_profiles WHERE id = ?').get(req.params.profileId)
    if (!existing) return res.status(404).json({ error: '车型资料不存在' })
    let profile
    try {
      profile = normalizeVehicleProfileInput(req.body)
    } catch (error) {
      return res.status(400).json({ error: error.message })
    }
    try {
      db.prepare(`
        UPDATE vehicle_profiles
        SET brand = ?, model = ?, year = ?, trim = ?, energy_type = ?,
            battery_capacity = ?, range_km = ?, drivetrain = ?, body_type = ?,
            dimensions = ?, wheelbase = ?, motor_power = ?, seats = ?,
            fast_charge_time = ?, slow_charge_time = ?, official_price = ?,
            features = ?, source_url = ?, notes = ?, updated_at = ?
        WHERE id = ?
      `).run(
        profile.brand, profile.model, profile.year, profile.trim, profile.energyType,
        profile.batteryCapacity, profile.rangeKm, profile.drivetrain, profile.bodyType,
        profile.dimensions, profile.wheelbase, profile.motorPower, profile.seats,
        profile.fastChargeTime, profile.slowChargeTime, profile.officialPrice,
        profile.features, profile.sourceUrl, profile.notes, new Date().toISOString(), existing.id,
      )
      const updated = db.prepare('SELECT * FROM vehicle_profiles WHERE id = ?').get(existing.id)
      res.json({ vehicleProfile: serializeVehicleProfile(updated) })
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) {
        return res.status(400).json({ error: '车型库中已存在同品牌、车型、年款和版本' })
      }
      throw error
    }
  },
)

app.post(
  '/api/vehicle-profiles/import',
  requireAuth,
  requireRole('admin', 'sales'),
  (req, res) => {
    const csv = String(req.body?.csv ?? '').trim()
    if (!csv) return res.status(400).json({ error: '请粘贴 CSV 内容' })
    const lines = csv.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    if (lines.length < 2) return res.status(400).json({ error: 'CSV 至少需要表头和一行数据' })
    const headers = parseCsvLine(lines[0]).map((header) =>
      profileCsvHeaderMap.get(normalizeCsvHeader(header)) ?? normalizeCsvHeader(header),
    )
    let imported = 0
    let updated = 0
    const errors = []
    const now = new Date().toISOString()
    const findProfile = db.prepare('SELECT * FROM vehicle_profiles WHERE brand = ? AND model = ? AND year = ? AND trim = ?')
    const insertProfile = db.prepare(`
      INSERT INTO vehicle_profiles (
        brand, model, year, trim, energy_type, battery_capacity, range_km,
        drivetrain, body_type, dimensions, wheelbase, motor_power, seats,
        fast_charge_time, slow_charge_time, official_price, features,
        source_url, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const updateProfile = db.prepare(`
      UPDATE vehicle_profiles
      SET energy_type = ?, battery_capacity = ?, range_km = ?, drivetrain = ?,
          body_type = ?, dimensions = ?, wheelbase = ?, motor_power = ?,
          seats = ?, fast_charge_time = ?, slow_charge_time = ?,
          official_price = ?, features = ?, source_url = ?, notes = ?, updated_at = ?
      WHERE id = ?
    `)
    db.exec('BEGIN')
    try {
      for (const [lineIndex, line] of lines.slice(1).entries()) {
        const values = parseCsvLine(line)
        const row = {}
        headers.forEach((header, index) => {
          row[header] = values[index] ?? ''
        })
        let profile
        try {
          profile = normalizeVehicleProfileInput(row)
        } catch (error) {
          errors.push(`第 ${lineIndex + 2} 行：${error.message}`)
          continue
        }
        const existing = findProfile.get(profile.brand, profile.model, profile.year, profile.trim)
        if (existing) {
          updateProfile.run(
            profile.energyType, profile.batteryCapacity, profile.rangeKm, profile.drivetrain,
            profile.bodyType, profile.dimensions, profile.wheelbase, profile.motorPower,
            profile.seats, profile.fastChargeTime, profile.slowChargeTime, profile.officialPrice,
            profile.features, profile.sourceUrl, profile.notes, now, existing.id,
          )
          updated += 1
        } else {
          insertProfile.run(
            profile.brand, profile.model, profile.year, profile.trim, profile.energyType,
            profile.batteryCapacity, profile.rangeKm, profile.drivetrain, profile.bodyType,
            profile.dimensions, profile.wheelbase, profile.motorPower, profile.seats,
            profile.fastChargeTime, profile.slowChargeTime, profile.officialPrice,
            profile.features, profile.sourceUrl, profile.notes, now, now,
          )
          imported += 1
        }
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    res.json({ imported, updated, errors })
  },
)

app.post(
  '/api/vehicles',
  requireAuth,
  requireRole('admin', 'sales'),
  (req, res) => {
    const {
      profileId,
      availableColors = [],
      imageUrl = '',
      publicNotes = '',
      initialSource = null,
    } = req.body ?? {}
    const profile = db.prepare('SELECT * FROM vehicle_profiles WHERE id = ?').get(profileId)
    if (!profile) {
      return res.status(400).json({ error: '请先选择车型库中的车型资料' })
    }
    if (!initialSource) {
      return res.status(400).json({ error: '请录入供应商车源和供应商报价' })
    }
    let source
    try {
      source = normalizeSourceInput(initialSource)
    } catch (error) {
      return res.status(400).json({ error: error.message })
    }
    const price = calculateCooperationPrice(source.supplierPrice)
    const colors = Array.isArray(availableColors)
      ? [...new Set(availableColors.map((color) => String(color).trim()).filter(Boolean))]
      : []
    const id = nextVehicleId()
    const now = new Date()
    const validUntil = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)
    try {
      db.exec('BEGIN')
      db.prepare(`
        INSERT INTO vehicles (
          id, profile_id, model, trim, year, color, location, status, stock_quantity,
          preorder_min_days, preorder_max_days, available_colors, stock_colors,
          battery_capacity, range_km, drivetrain, energy_type, image_url, public_notes,
          price_updated_at, price_valid_until, is_listed, vin, cost, partner_price, customer_price
        ) VALUES (?, ?, ?, ?, ?, ?, '', ?, 0, 0, 0, ?, '[]', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
      `).run(
        id,
        profile.id,
        `${profile.brand} ${profile.model}`,
        profile.trim,
        profile.year,
        colors.length > 0 ? '颜色可选' : '待确认',
        VEHICLE_STATUS.unavailable,
        JSON.stringify(colors),
        profile.battery_capacity,
        Number(profile.range_km) || 0,
        profile.drivetrain,
        profile.energy_type,
        String(imageUrl ?? '').trim(),
        String(publicNotes ?? '').trim(),
        now.toISOString(),
        validUntil.toISOString(),
        `RESOURCE-${id}`,
        source.supplierPrice,
        price,
        price,
      )
      db.prepare(`
        INSERT INTO vehicle_price_history (
          vehicle_id, partner_price, valid_from, valid_until, changed_by, notes
        ) VALUES (?, ?, ?, ?, ?, '首次录入')
      `).run(id, price, now.toISOString(), validUntil.toISOString(), req.user.username)
      db.prepare(`
        INSERT INTO supplier_sources (
          vehicle_id, supplier_name, stock_quantity, stock_colors,
          preorder_min_days, preorder_max_days, can_preorder,
          supplier_price, created_by, updated_by, updated_at, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        source.supplierName,
        source.stockQuantity,
        JSON.stringify(source.stockColors),
        source.preorderMinDays,
        source.preorderMaxDays,
        source.canPreorder ? 1 : 0,
        source.supplierPrice,
        req.user.username,
        req.user.username,
        now.toISOString(),
        source.notes,
      )
      syncVehicleAvailability(id, req.user.username, `首次录入：供应商报价 + ${COOPERATION_PRICE_MARKUP_USD}`)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      return res.status(400).json({ error: error.message })
    }
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
    const partnerPriceExw = req.body?.partnerPriceExw !== undefined && req.body?.partnerPriceExw !== null && req.body?.partnerPriceExw !== '' ? Number(req.body.partnerPriceExw) : null
    const partnerPriceFca = req.body?.partnerPriceFca !== undefined && req.body?.partnerPriceFca !== null && req.body?.partnerPriceFca !== '' ? Number(req.body.partnerPriceFca) : null
    const partnerPriceFob = req.body?.partnerPriceFob !== undefined && req.body?.partnerPriceFob !== null && req.body?.partnerPriceFob !== '' ? Number(req.body.partnerPriceFob) : null
    const notes = String(req.body?.notes ?? '').trim()
    if (!partnerPriceExw && !partnerPriceFca && !partnerPriceFob) {
      return res.status(400).json({ error: '请至少填写一个 EXW、FCA 或 FOB 报价' })
    }
    const legacyPrice = partnerPriceExw || partnerPriceFca || partnerPriceFob || 0
    const now = new Date()
    const validUntil = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)
    db.exec('BEGIN')
    try {
      db.prepare(`
        UPDATE vehicles
        SET partner_price = ?, partner_price_exw = ?, partner_price_fca = ?, partner_price_fob = ?, price_updated_at = ?, price_valid_until = ?
        WHERE id = ?
      `).run(legacyPrice, partnerPriceExw, partnerPriceFca, partnerPriceFob, now.toISOString(), validUntil.toISOString(), vehicle.id)
      db.prepare(`
        INSERT INTO vehicle_price_history (
          vehicle_id, partner_price, valid_from, valid_until, changed_by, notes
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(vehicle.id, legacyPrice, now.toISOString(), validUntil.toISOString(), req.user.username, notes)
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
        supplier_price, price_exw, price_exw_currency, price_fca, price_fca_currency,
        price_fob, price_fob_currency, created_by, updated_by, updated_at, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      vehicle.id,
      source.supplierName,
      source.stockQuantity,
      JSON.stringify(source.stockColors),
      source.preorderMinDays,
      source.preorderMaxDays,
      source.canPreorder ? 1 : 0,
      source.supplierPrice,
      source.priceExw,
      source.priceExwCurrency,
      source.priceFca,
      source.priceFcaCurrency,
      source.priceFob,
      source.priceFobCurrency,
      req.user.username,
      req.user.username,
      new Date().toISOString(),
      source.notes,
    )
    syncVehicleAvailability(vehicle.id, req.user.username)
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
          supplier_price = ?, price_exw = ?, price_exw_currency = ?,
          price_fca = ?, price_fca_currency = ?, price_fob = ?, price_fob_currency = ?,
          updated_by = ?, updated_at = ?, notes = ?
      WHERE id = ? AND vehicle_id = ?
    `).run(
      source.supplierName,
      source.stockQuantity,
      JSON.stringify(source.stockColors),
      source.preorderMinDays,
      source.preorderMaxDays,
      source.canPreorder ? 1 : 0,
      source.supplierPrice,
      source.priceExw,
      source.priceExwCurrency,
      source.priceFca,
      source.priceFcaCurrency,
      source.priceFob,
      source.priceFobCurrency,
      req.user.username,
      new Date().toISOString(),
      source.notes,
      sourceRow.id,
      sourceRow.vehicle_id,
    )
    syncVehicleAvailability(sourceRow.vehicle_id, req.user.username)
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
    syncVehicleAvailability(source.vehicle_id, req.user.username, '删除供应商车源后自动重算合作价')
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

setupSourceImportWorkbench({ app, db, requireAuth, requireRole, dataDir })

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

  const rateRow = db.prepare("SELECT value FROM system_settings WHERE key = 'exchange_rate'").get()
  const exchangeRate = Number(rateRow?.value ?? 7.2)

  res.json({
    user: publicUser(user),
    exchangeRate,
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
    vehicleProfiles: isInternal
      ? db.prepare('SELECT * FROM vehicle_profiles ORDER BY brand, model, year DESC, trim').all().map(serializeVehicleProfile)
      : [],
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
