import {
  Car,
  CheckCircle2,
  Database,
  Download,
  FileText,
  LayoutDashboard,
  Link2,
  LogOut,
  Loader2,
  Menu,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'

type Role = 'admin' | 'sales' | 'partner' | 'customer'
type Language = 'zh' | 'en'
type NavKey =
  | 'vehicles'
  | 'sourceImports'

type User = {
  username: string
  displayName: string
  role: Role
  customerId: string | null
}

type Permissions = {
  canSeeCost: boolean
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

type StaffUser = {
  id: number
  username: string
  displayName: string
  role: 'admin' | 'sales'
  isActive: boolean
  createdAt: string
}

type Vehicle = {
  id: string
  profileId: number | null
  profile: VehicleProfile | null
  model: string
  trim: string
  year: string
  color: string
  location: string
  status: string
  stockQuantity: number
  preorderMinDays: number
  preorderMaxDays: number
  availableColors: string[]
  stockColors: { color: string; quantity: number }[]
  batteryCapacity: string
  rangeKm: number
  drivetrain: string
  energyType: string
  imageUrl: string
  publicNotes: string
  priceUpdatedAt: string | null
  priceValidUntil: string | null
  isPriceValid: boolean
  isListed: boolean
  supplierSources?: SupplierSource[]
  priceHistory?: PriceHistoryEntry[]
  vin: string
  cost?: number
  costExw?: number | null
  costExwCurrency?: string
  costFca?: number | null
  costFcaCurrency?: string
  costFob?: number | null
  costFobCurrency?: string
  canSeePrice: boolean
  visiblePrice: number
  partnerPriceExw?: number | null
  partnerPriceFca?: number | null
  partnerPriceFob?: number | null
  customerPriceExw?: number | null
  customerPriceFca?: number | null
  customerPriceFob?: number | null
  priceLabel: string
}

type VehicleProfile = {
  id: number
  brand: string
  model: string
  year: string
  trim: string
  energyType: string
  batteryCapacity: string
  rangeKm: number
  drivetrain: string
  bodyType: string
  dimensions: string
  wheelbase: string
  motorPower: string
  seats: string
  fastChargeTime: string
  slowChargeTime: string
  officialPrice: string
  features: string
  sourceUrl: string
  notes: string
  specs: VehicleProfileSpec[]
  createdAt: string
  updatedAt: string
}

type VehicleProfileSpec = {
  id: number
  groupName: string
  name: string
  value: string
  sortOrder: number
  sourceName: string
  sourceUrl: string
  updatedAt: string
}

type PriceHistoryEntry = {
  id: number
  partnerPrice: number
  validFrom: string
  validUntil: string
  changedBy: string
  notes: string
}

type SupplierSource = {
  id: number
  supplierName: string
  stockQuantity: number
  stockColors: { color: string; quantity: number }[]
  preorderMinDays: number
  preorderMaxDays: number
  canPreorder: boolean
  supplierPrice: number
  priceExw?: number | null
  priceExwCurrency?: string
  priceFca?: number | null
  priceFcaCurrency?: string
  priceFob?: number | null
  priceFobCurrency?: string
  createdBy: string
  updatedBy: string
  updatedAt: string
  notes: string
}

type Inquiry = {
  id: string
  customer: string
  country: string
  demand: string
  quantity: number
  budget: string
  owner: string
  status: string
}

type Quote = {
  id: string
  inquiryId: string
  version: string
  date: string
  model: string
  term: string
  unitPrice: number
  freight: number
  total: number
  status: string
  reason: string
}

type QuoteRequest = {
  id: number
  requestNo: string
  customerId: string
  vehicleId: string
  vehicleModel: string
  basePriceSnapshot: number
  quantity: number
  suggestedProfit: number
  agreedProfit: number | null
  destinationPort: string
  tradeTerm: string
  freight: number
  otherFees: number
  notes: string
  status: string
  piNumber: string | null
  vehicleUnitPrice: number
  total: number
  createdAt: string
  updatedAt: string
  canEditInquiry: boolean
  canReview: boolean
  canCreateVersion: boolean
  canGeneratePi: boolean
  canConfirmPi: boolean
  canAssign: boolean
  assignedTo: string | null
  items: QuoteRequestItem[]
  versions: QuoteVersion[]
  revisionRequests: RevisionRequest[]
}

type QuoteRequestItem = {
  id: number
  vehicleId: string
  vehicleModel: string
  vehicleTrim: string
  vehicleColor: string
  basePriceSnapshot: number
  quantity: number
  suggestedProfit: number
  agreedProfit: number | null
  unitPrice: number
  subtotal: number
}

type QuoteBasketItem = {
  vehicle: Vehicle
  quantity: number
}

type QuoteVersion = {
  id: number
  versionNo: number
  tradeTerm: string
  status: string
  changeReason: string
  createdBy: string
  createdAt: string
  acceptedAt: string | null
  items: QuoteVersionItem[]
  fees: QuoteFee[]
  vehicleSubtotal: number
  total: number
  canAccept: boolean
}

type QuoteVersionItem = {
  id: number
  vehicleId: string
  vehicleModel: string
  vehicleTrim: string
  vehicleColor: string
  quantity: number
  basePrice: number
  fobPrice: number
  shippingFee: number
  financingFee: number
  customerDepositRate: number
  supplierPaymentRate?: number
  financingDays: number
  monthlyFinancingRate: number
  advanceAmount?: number
  hasFinancingEstimate: boolean
  profit: number
  unitPrice: number
  subtotal: number
}

type QuoteFee = {
  id: number
  name: string
  amount: number
  category: string
}

type RevisionRequest = {
  id: number
  quoteVersionId: number | null
  message: string
  createdBy: string
  createdAt: string
  status: string
}

type Payment = {
  id: string
  date: string
  type: 'deposit' | 'balance' | 'refund' | '定金' | '尾款' | '退款'
  amount: number
  currency: string
  method?: string
  proof?: string
}

type Order = {
  id: string
  customer: string
  partner: string
  model: string
  total: number
  depositDue: number
  status: string
  quoteId: string
  eta: string
  internalProfit?: number
  payments: Payment[]
}

type LogisticsStep = {
  step: string
  date: string
  status: string
  owner: string
}

type AppData = {
  user: User
  exchangeRate: number
  permissions: Permissions
}

type NotificationItem = {
  id: number
  type: string
  title: string
  message: string
  relatedId: number | null
  isRead: boolean
  createdAt: string
}

type SourceImportSummary = {
  total: number
  approved: number
  needsReview: number
  withIssues: number
  missing: number
}

type SourceImportBatch = {
  id: number
  supplierName: string
  snapshotName: string
  snapshotTime: string
  importedBy: string
  status: string
  notes: string
  createdAt: string
  updatedAt: string
  summary: SourceImportSummary
}

type SourceImportFile = {
  id: number
  batchId: number
  originalName: string
  storedName: string
  mimeType: string
  fileSize: number
  fileType: string
  parseStatus: string
  parserNotes: string
  rawText: string
  createdAt: string
}

type SourceImportCandidate = {
  id: number
  batchId: number
  snapshotId: number
  fileId: number | null
  sourceSheet: string
  rowIndex: number
  fingerprint: string
  rawFields: Record<string, string>
  rawText: string
  brand: string
  modelName: string
  year: string
  trimName: string
  exteriorColor: string
  interiorColor: string
  stockQuantity: number
  supplierPrice: number
  currency: string
  tradeTerm: string
  priceExw: number | null
  priceExwCurrency?: string
  priceFca: number | null
  priceFcaCurrency?: string
  priceFob: number | null
  priceFobCurrency?: string
  officialPrice: string
  location: string
  preorderMinDays: number
  preorderMaxDays: number
  canPreorder: boolean
  notes: string
  profileId: number | null
  matchStatus: string
  matchConfidence: number
  reviewStatus: string
  issueTags: string[]
  changeStatus: string
  duplicateScore: number
  canonicalAction: string
  reviewedBy: string
  reviewedAt: string | null
  feishuRecordId: string | null
  createdAt: string
  updatedAt: string
}

type SourceImportDuplicate = {
  id: number
  batchId: number
  snapshotId: number
  candidateId: number
  matchedCandidateId: number
  score: number
  reason: string
  status: string
  resolution: string
  confirmedBy: string
  createdAt: string
  updatedAt: string
  candidateModel?: string
  candidatePrice?: number
  candidateCurrency?: string
  candidateSupplier?: string
  matchedModel?: string
  matchedPrice?: number
  matchedCurrency?: string
  matchedSupplier?: string
}

type SourceImportAiStatus = {
  enabled: boolean
  provider: string
  model: string
  supportsImages: boolean
  supportsText: boolean
  supportedFileTypes: string[]
}

type SourceSupplier = {
  id: number
  supplierName: string
  contactName: string
  phone: string
  wechat: string
  location: string
  channelType: string
  notes: string
  isActive: boolean
  createdBy: string
  createdAt: string
  updatedAt: string
}

type SourceImportSnapshot = {
  id: number
  batchId: number
  supplierName: string
  snapshotTime: string
  versionNo: number
  previousSnapshotId: number | null
  status: string
  activeCount: number
  newCount: number
  changedCount: number
  missingCount: number
  duplicateCount: number
  createdAt: string
}

type SourceImportListResponse = {
  batches: SourceImportBatch[]
  suppliers: SourceSupplier[]
  aiStatus: SourceImportAiStatus
  metrics: {
    totalCandidates: number
    needsReview: number
    duplicateRisk: number
    totalFieldChanges: number
    recognitionCorrections: number
    humanSupplements: number
    profileCorrections: number
  }
}

type SourceImportBatchDetail = {
  batch: SourceImportBatch
  files: SourceImportFile[]
  candidates: SourceImportCandidate[]
  duplicates: SourceImportDuplicate[]
  snapshots: SourceImportSnapshot[]
}

type NavItem = {
  key: NavKey
  icon: typeof LayoutDashboard
  roles: Role[]
}

const navItems: NavItem[] = [
  { key: 'sourceImports', icon: Database, roles: ['admin', 'sales'] },
  { key: 'vehicles', icon: Car, roles: ['admin', 'sales', 'partner', 'customer'] },
]

const ACTIVE_NAV_STORAGE_KEY = 'ev-active-nav'

function isNavKey(value: string | null): value is NavKey {
  return Boolean(value && navItems.some((item) => item.key === value))
}

function readStoredNavKey() {
  const stored = window.localStorage.getItem(ACTIVE_NAV_STORAGE_KEY)
  return isNavKey(stored) ? stored : 'sourceImports'
}

const translations: Record<Language, Record<string, string>> = {
  zh: {
    appName: '出口管理系统',
    loginTitle: '新能源汽车出口管理系统',
    loginSubtitle: '库存、报价、订单、收款与出口流程统一协作。',
    securityNote: '价格与财务权限由后台验证，不同角色获得不同数据。',
    internalLogin: '内部账号登录',
    welcomeBack: '欢迎回来',
    username: '账号',
    password: '密码',
    login: '登录系统',
    loggingIn: '正在登录...',
    demoRoles: '演示角色',
    logout: '退出登录',
    searchPlaceholder: '搜索订单、客户、VIN',
    notifications: '通知',
    noNotifications: '暂无通知',
    pieces: '条',
    view: '视图',
    nav_dashboard: '首页看板',
    nav_profiles: '车型库',
    nav_vehicles: '车辆资源',
    nav_sourceImports: '车源导入',
    nav_quotes: '询价管理',
    nav_orders: '订单管理',
    nav_payments: '收款财务',
    nav_logistics: '出口流程',
    nav_customers: '客户资料',
    nav_staff: '员工账号',
    nav_files: '文件中心',
    role_admin: '管理员',
    role_sales: '销售',
    role_partner: '合作伙伴',
    role_customer: '客户',
    vehiclesSubtitle: '按车型集合查看配置版本、现车数量、预订周期和价格有效期。',
    sourceImportsSubtitle: '把供应商文件转成可审核的车源快照，沉淀字段、车型和同源库存规则。',
    profilesSubtitle: '维护车型参数资料，并按同一车型的不同年款和版本进行横向对比。',
    quotesSubtitle: '查看每笔询价，并在详情中处理报价版本、修改记录和 PI。',
    ordersSubtitle: '订单聚合报价、车辆、收款和物流。',
    customerOrdersSubtitle: '查看自己的订单、付款状态和交付进度。',
    paymentsSubtitle: '每一笔定金、尾款和退款单独记录，系统自动计算余额。',
    logisticsSubtitle: '每个订单有独立时间线，双方随时查看当前节点。',
    customersSubtitle: '客户历史询价、订单和跟进备注归档在一起。',
    staffSubtitle: '创建内部账号、分配角色，并及时停用离职或暂停使用的账号。',
    filesSubtitle: '可见文件范围随账号角色和所属订单变化。',
    activeAccounts: '个启用账号',
    staffPolicy: '销售只能查看分配给自己的询价，管理员可查看和管理全部数据。',
    addStaff: '新增员工',
    staff: '员工',
    role: '角色',
    status: '状态',
    createdAt: '创建时间',
    actions: '操作',
    resetPassword: '重置密码',
    deactivate: '停用',
    activate: '启用',
    assignedQuotes: '负责询价',
    assignedQuotesNote: '只显示分配给当前账号的询价',
    pendingQuotes: '待处理询价',
    pendingQuotesNote: '包含待报价和客户要求修改',
    vehicleConfigs: '车辆配置',
    vehicleConfigsNote: '可维护供应商车源与合作价',
    pricesToUpdate: '价格待更新',
    pricesToUpdateNote: '已过期或三天内到期',
    myQuotes: '我的询价',
    todayFocus: '今日重点',
    stockResources: '现车资源',
    currentOrders: '当前订单',
    unpaidAmount: '待收金额',
    keyOrders: '重点订单',
    todoItems: '待处理事项',
    noOrders: '暂无订单',
    noVisibleOrders: '暂无可查看订单',
    totalCustomers: '客户总数',
    newThisMonth: '本月新增',
    highIntentCustomers: '高意向客户',
    quoteList: '询价管理',
  },
  en: {
    appName: 'Export Management',
    loginTitle: 'EV Export Management System',
    loginSubtitle: 'Unified collaboration for vehicle resources, quotes, orders, payments, and export workflows.',
    securityNote: 'Pricing and finance permissions are enforced by the backend for each role.',
    internalLogin: 'Internal Login',
    welcomeBack: 'Welcome Back',
    username: 'Username',
    password: 'Password',
    login: 'Sign In',
    loggingIn: 'Signing in...',
    demoRoles: 'Demo roles',
    logout: 'Log out',
    searchPlaceholder: 'Search orders, customers, VIN',
    notifications: 'Notifications',
    noNotifications: 'No notifications',
    pieces: 'items',
    view: 'View',
    nav_dashboard: 'Dashboard',
    nav_profiles: 'Vehicle Library',
    nav_vehicles: 'Vehicle Resources',
    nav_sourceImports: 'Source Imports',
    nav_quotes: 'Inquiry Management',
    nav_orders: 'Orders',
    nav_payments: 'Payments',
    nav_logistics: 'Export Workflow',
    nav_customers: 'Customers',
    nav_staff: 'Staff Accounts',
    nav_files: 'Files',
    role_admin: 'Admin',
    role_sales: 'Sales',
    role_partner: 'Partner',
    role_customer: 'Customer',
    vehiclesSubtitle: 'Browse model groups, trims, available stock, preorder lead time, and price validity.',
    sourceImportsSubtitle: 'Convert supplier files into reviewable stock snapshots.',
    profilesSubtitle: 'Maintain model specifications and compare different model years and trims.',
    quotesSubtitle: 'Review each inquiry and manage quote versions, revisions, and PI actions.',
    ordersSubtitle: 'Orders aggregate quotes, vehicles, payments, and logistics.',
    customerOrdersSubtitle: 'View your orders, payment status, and delivery progress.',
    paymentsSubtitle: 'Record deposits, balances, and refunds separately with automatic balance calculation.',
    logisticsSubtitle: 'Each order has its own timeline so both sides can track the current step.',
    customersSubtitle: 'Customer inquiry history, orders, and follow-up notes are archived together.',
    staffSubtitle: 'Create internal accounts, assign roles, and disable accounts when needed.',
    filesSubtitle: 'Visible files depend on account role and related orders.',
    activeAccounts: 'active accounts',
    staffPolicy: 'Sales users only see assigned inquiries; admins can view and manage all data.',
    addStaff: 'Add Staff',
    staff: 'Staff',
    role: 'Role',
    status: 'Status',
    createdAt: 'Created',
    actions: 'Actions',
    resetPassword: 'Reset Password',
    deactivate: 'Disable',
    activate: 'Enable',
    assignedQuotes: 'Assigned Inquiries',
    assignedQuotesNote: 'Only inquiries assigned to this account are shown',
    pendingQuotes: 'Pending Inquiries',
    pendingQuotesNote: 'Includes pending quotes and customer revision requests',
    vehicleConfigs: 'Vehicle Configs',
    vehicleConfigsNote: 'Maintain supplier sources and cooperation prices',
    pricesToUpdate: 'Prices to Update',
    pricesToUpdateNote: 'Expired or expiring within three days',
    myQuotes: 'My Inquiries',
    todayFocus: 'Today Focus',
    stockResources: 'Available Stock',
    currentOrders: 'Current Orders',
    unpaidAmount: 'Receivable',
    keyOrders: 'Key Orders',
    todoItems: 'To-dos',
    noOrders: 'No orders',
    noVisibleOrders: 'No visible orders',
    totalCustomers: 'Total Customers',
    newThisMonth: 'New This Month',
    highIntentCustomers: 'High-intent Customers',
    quoteList: 'Inquiry Management',
  },
}

const statusLabels: Record<string, { zh: string; en: string }> = {
  pending_review: { zh: '待审核', en: 'Pending Review' },
  customer_changed: { zh: '客户已修改需求', en: 'Customer Changed' },
  quote_sent: { zh: '报价待客户审核', en: 'Quote Sent' },
  revision_requested: { zh: '客户要求修改', en: 'Revision Requested' },
  quote_accepted: { zh: '报价已接受', en: 'Quote Accepted' },
  pi_pending: { zh: 'PI待确认', en: 'PI Pending' },
  pi_confirmed: { zh: 'PI已确认', en: 'PI Confirmed' },
  pending_customer_review: { zh: '待客户审核', en: 'Pending Customer Review' },
  accepted: { zh: '已接受', en: 'Accepted' },
  replaced: { zh: '已替代', en: 'Replaced' },
  pending: { zh: '待处理', en: 'Pending' },
  processed: { zh: '已处理', en: 'Processed' },
  in_stock: { zh: '现车', en: 'In Stock' },
  preorder: { zh: '可预订', en: 'Preorder' },
  temporarily_unavailable: { zh: '暂时缺货', en: 'Temporarily Unavailable' },
  delisted: { zh: '已下架', en: 'Delisted' },
  imported: { zh: '已导入', en: 'Imported' },
  parsing: { zh: '解析中', en: 'Parsing' },
  needs_review: { zh: '待审核', en: 'Needs Review' },
  reviewed: { zh: '已审核', en: 'Reviewed' },
  exported: { zh: '已导出', en: 'Exported' },
  approved: { zh: '已确认', en: 'Approved' },
  rejected: { zh: '已驳回', en: 'Rejected' },
  new: { zh: '新增', en: 'New' },
  unchanged: { zh: '未变化', en: 'Unchanged' },
  changed: { zh: '有变化', en: 'Changed' },
  missing_from_latest_snapshot: { zh: '本次未出现', en: 'Missing From Latest' },
  matched: { zh: '已匹配', en: 'Matched' },
  needs_confirmation: { zh: '待确认匹配', en: 'Needs Confirmation' },
  unmatched: { zh: '未匹配', en: 'Unmatched' },
  attachment_only: { zh: '附件待解析', en: 'Attachment Only' },
  count_inventory: { zh: '计入库存', en: 'Count Inventory' },
  same_origin_channel: { zh: '同源渠道', en: 'Same-Origin Channel' },
  do_not_count: { zh: '不计入库存', en: 'Do Not Count' },
  active: { zh: '已启用', en: 'Active' },
  disabled: { zh: '已停用', en: 'Disabled' },
  deposit_received: { zh: '已收定金', en: 'Deposit Received' },
  deposit_pending: { zh: '待收定金', en: 'Deposit Pending' },
  deposit: { zh: '定金', en: 'Deposit' },
  balance: { zh: '尾款', en: 'Balance' },
  refund: { zh: '退款', en: 'Refund' },
  待审核: { zh: '待审核', en: 'Pending Review' },
  报价待客户审核: { zh: '报价待客户审核', en: 'Quote Sent' },
  客户要求修改: { zh: '客户要求修改', en: 'Revision Requested' },
  报价已接受: { zh: '报价已接受', en: 'Quote Accepted' },
  PI待确认: { zh: 'PI待确认', en: 'PI Pending' },
  PI已确认: { zh: 'PI已确认', en: 'PI Confirmed' },
  已启用: { zh: '已启用', en: 'Active' },
  已停用: { zh: '已停用', en: 'Disabled' },
  已收定金: { zh: '已收定金', en: 'Deposit Received' },
  现车: { zh: '现车', en: 'In Stock' },
  可预订: { zh: '可预订', en: 'Preorder' },
  暂时缺货: { zh: '暂时缺货', en: 'Temporarily Unavailable' },
  已下架: { zh: '已下架', en: 'Delisted' },
  待客户审核: { zh: '待客户审核', en: 'Pending Customer Review' },
  已接受: { zh: '已接受', en: 'Accepted' },
  已替代: { zh: '已替代', en: 'Replaced' },
  待处理: { zh: '待处理', en: 'Pending' },
  已处理: { zh: '已处理', en: 'Processed' },
}

const specGroupLabels: Record<string, { zh: string; en: string }> = {
  车身: { zh: '车身', en: 'Body' },
  动力: { zh: '动力', en: 'Powertrain' },
  '电池/续航': { zh: '电池/续航', en: 'Battery / Range' },
  充电: { zh: '充电', en: 'Charging' },
  能耗: { zh: '能耗', en: 'Energy Consumption' },
  性能: { zh: '性能', en: 'Performance' },
  '底盘/转向': { zh: '底盘/转向', en: 'Chassis / Steering' },
  '制动/轮胎': { zh: '制动/轮胎', en: 'Brakes / Tires' },
  外部配置: { zh: '外部配置', en: 'Exterior Features' },
  安全配置: { zh: '安全配置', en: 'Safety' },
  辅助驾驶: { zh: '辅助驾驶', en: 'Driver Assistance' },
  '座舱/舒适': { zh: '座舱/舒适', en: 'Cabin / Comfort' },
  配置: { zh: '配置', en: 'Features' },
}

const hiddenSpecGroups = new Set(['基础信息'])

const specNameLabels: Record<string, { zh: string; en: string }> = {
  品牌: { zh: '品牌', en: 'Brand' },
  车型: { zh: '车型', en: 'Model' },
  年款: { zh: '年款', en: 'Model Year' },
  版本: { zh: '版本', en: 'Trim' },
  配置版本: { zh: '配置版本', en: 'Trim' },
  能源类型: { zh: '能源类型', en: 'Energy Type' },
  级别: { zh: '级别', en: 'Segment' },
  国内指导价参考: { zh: '国内指导价参考', en: 'China MSRP Reference' },
  官方指导价: { zh: '官方指导价', en: 'Official MSRP' },
  长宽高: { zh: '长宽高', en: 'Length x Width x Height' },
  轴距: { zh: '轴距', en: 'Wheelbase' },
  车身结构: { zh: '车身结构', en: 'Body Structure' },
  座位数: { zh: '座位数', en: 'Seats' },
  电机功率: { zh: '电机功率', en: 'Motor Power' },
  电机扭矩: { zh: '电机扭矩', en: 'Motor Torque' },
  电机马力: { zh: '电机马力', en: 'Motor Horsepower' },
  驱动方式: { zh: '驱动方式', en: 'Drive Type' },
  电池容量: { zh: '电池容量', en: 'Battery Capacity' },
  续航里程: { zh: '续航里程', en: 'Range' },
  CLTC续航: { zh: 'CLTC续航', en: 'CLTC Range' },
  'CLTC 续航': { zh: 'CLTC 续航', en: 'CLTC Range' },
  电池类型: { zh: '电池类型', en: 'Battery Type' },
  快充: { zh: '快充', en: 'Fast Charging' },
  快充时间: { zh: '快充时间', en: 'Fast Charging Time' },
  慢充时间: { zh: '慢充时间', en: 'AC Charging Time' },
  快充功率: { zh: '快充功率', en: 'Fast Charging Power' },
  快充功能: { zh: '快充功能', en: 'Fast Charging Support' },
  快充电量范围: { zh: '快充电量范围', en: 'Fast Charging SOC Range' },
  快充接口位置: { zh: '快充接口位置', en: 'DC Charging Port Position' },
  慢充接口位置: { zh: '慢充接口位置', en: 'AC Charging Port Position' },
  百公里耗电: { zh: '百公里耗电', en: 'Energy Consumption' },
  最高车速: { zh: '最高车速', en: 'Top Speed' },
  '0-50km/h 加速': { zh: '0-50km/h 加速', en: '0-50 km/h Acceleration' },
  前悬架: { zh: '前悬架', en: 'Front Suspension' },
  后悬架: { zh: '后悬架', en: 'Rear Suspension' },
  转向助力: { zh: '转向助力', en: 'Power Steering' },
  车体结构: { zh: '车体结构', en: 'Vehicle Body' },
  前制动器: { zh: '前制动器', en: 'Front Brakes' },
  后制动器: { zh: '后制动器', en: 'Rear Brakes' },
  驻车制动: { zh: '驻车制动', en: 'Parking Brake' },
  '轮毂/轮胎规格': { zh: '轮毂/轮胎规格', en: 'Wheel / Tire Size' },
  轮胎规格: { zh: '轮胎规格', en: 'Tire Size' },
  前轮胎规格: { zh: '前轮胎规格', en: 'Front Tire Size' },
  后轮胎规格: { zh: '后轮胎规格', en: 'Rear Tire Size' },
  天窗类型: { zh: '天窗类型', en: 'Sunroof Type' },
  车顶行李架: { zh: '车顶行李架', en: 'Roof Rails' },
  远光灯光源: { zh: '远光灯光源', en: 'High Beam Light Source' },
  近光灯光源: { zh: '近光灯光源', en: 'Low Beam Light Source' },
  外后视镜功能: { zh: '外后视镜功能', en: 'Exterior Mirror Functions' },
  主动刹车: { zh: '主动刹车', en: 'AEB' },
  '主动刹车 AEB': { zh: '主动刹车 AEB', en: 'AEB' },
  '主动刹车/主动安全系统': { zh: '主动刹车/主动安全系统', en: 'AEB / Active Safety' },
  车道偏离预警: { zh: '车道偏离预警', en: 'Lane Departure Warning' },
  车道偏离预警系统: { zh: '车道偏离预警系统', en: 'Lane Departure Warning' },
  车道保持辅助系统: { zh: '车道保持辅助系统', en: 'Lane Keeping Assist' },
  车道居中保持: { zh: '车道居中保持', en: 'Lane Centering' },
  辅助泊车入位: { zh: '辅助泊车入位', en: 'Parking Assist' },
  车身稳定控制: { zh: '车身稳定控制', en: 'ESC' },
  胎压监测: { zh: '胎压监测', en: 'TPMS' },
  '主/副驾驶座安全气囊': { zh: '主/副驾驶座安全气囊', en: 'Front Airbags' },
  '前/后排侧气囊': { zh: '前/后排侧气囊', en: 'Side Airbags' },
  '前/后排头部气囊(气帘)': { zh: '前/后排头部气囊(气帘)', en: 'Curtain Airbags' },
  前排中间气囊: { zh: '前排中间气囊', en: 'Front Center Airbag' },
  ISOFIX儿童座椅接口: { zh: 'ISOFIX儿童座椅接口', en: 'ISOFIX Child Seat Anchors' },
  驾驶辅助级别: { zh: '驾驶辅助级别', en: 'Driver Assistance Level' },
  自适应巡航: { zh: '自适应巡航', en: 'Adaptive Cruise Control' },
  '360 全景影像': { zh: '360 全景影像', en: '360 Camera' },
  驾驶辅助影像: { zh: '驾驶辅助影像', en: 'Camera Assistance' },
  '透明底盘/540度影像': { zh: '透明底盘/540度影像', en: 'Transparent Chassis / 540 Camera' },
  巡航系统: { zh: '巡航系统', en: 'Cruise Control System' },
  '前/后驻车雷达': { zh: '前/后驻车雷达', en: 'Front / Rear Parking Radar' },
  超声波雷达数量: { zh: '超声波雷达数量', en: 'Ultrasonic Radar Count' },
  毫米波雷达数量: { zh: '毫米波雷达数量', en: 'Millimeter-wave Radar Count' },
  激光雷达数量: { zh: '激光雷达数量', en: 'LiDAR Count' },
  激光雷达线数: { zh: '激光雷达线数', en: 'LiDAR Lines' },
  激光雷达品牌: { zh: '激光雷达品牌', en: 'LiDAR Brand' },
  激光雷达型号: { zh: '激光雷达型号', en: 'LiDAR Model' },
  中控屏: { zh: '中控屏', en: 'Center Display' },
  中控彩色屏幕: { zh: '中控彩色屏幕', en: 'Center Display' },
  中控屏幕类型: { zh: '中控屏幕类型', en: 'Display Type' },
  中控屏幕尺寸: { zh: '中控屏幕尺寸', en: 'Display Size' },
  中控屏幕分辨率: { zh: '中控屏幕分辨率', en: 'Display Resolution' },
  车机智能芯片: { zh: '车机智能芯片', en: 'Infotainment Chip' },
  '车机系统内存(GB)': { zh: '车机系统内存(GB)', en: 'System RAM (GB)' },
  '车机系统存储(GB)': { zh: '车机系统存储(GB)', en: 'System Storage (GB)' },
  '车联网/OTA': { zh: '车联网/OTA', en: 'Connected Services / OTA' },
  车联网: { zh: '车联网', en: 'Connected Services' },
  OTA升级: { zh: 'OTA升级', en: 'OTA Updates' },
  座椅功能: { zh: '座椅功能', en: 'Seat Functions' },
  座椅材质: { zh: '座椅材质', en: 'Seat Material' },
  主座椅调节方式: { zh: '主座椅调节方式', en: 'Driver Seat Adjustment' },
  副座椅调节方式: { zh: '副座椅调节方式', en: 'Passenger Seat Adjustment' },
  前排座椅功能: { zh: '前排座椅功能', en: 'Front Seat Functions' },
  第二排座椅调节: { zh: '第二排座椅调节', en: 'Second-row Seat Adjustment' },
  第二排座椅功能: { zh: '第二排座椅功能', en: 'Second-row Seat Functions' },
  后排座椅放倒形式: { zh: '后排座椅放倒形式', en: 'Rear Seat Folding' },
  电动座椅记忆功能: { zh: '电动座椅记忆功能', en: 'Power Seat Memory' },
  零重力座椅: { zh: '零重力座椅', en: 'Zero-gravity Seat' },
  无钥匙进入功能: { zh: '无钥匙进入功能', en: 'Keyless Entry' },
  无钥匙启动系统: { zh: '无钥匙启动系统', en: 'Keyless Start' },
  钥匙类型: { zh: '钥匙类型', en: 'Key Type' },
  空调温度控制方式: { zh: '空调温度控制方式', en: 'Climate Control Type' },
  后排独立空调: { zh: '后排独立空调', en: 'Rear Independent AC' },
  音响: { zh: '音响', en: 'Audio System' },
  音响品牌: { zh: '音响品牌', en: 'Audio Brand' },
  扬声器数量: { zh: '扬声器数量', en: 'Speaker Count' },
  扬声器品牌名称: { zh: '扬声器品牌名称', en: 'Speaker Brand' },
  无线充电: { zh: '无线充电', en: 'Wireless Charging' },
  手机无线充电功能: { zh: '手机无线充电功能', en: 'Wireless Phone Charging' },
  热泵空调: { zh: '热泵空调', en: 'Heat Pump' },
  对外放电: { zh: '对外放电', en: 'Vehicle-to-load' },
  '对外放电功率(kW)': { zh: '对外放电功率(kW)', en: 'V2L Power (kW)' },
  代表配置: { zh: '代表配置', en: 'Key Features' },
}

const specValueTranslations: Array<[RegExp, string]> = [
  [/深蓝智驾AD PRO纯电版/g, 'Deepal AD PRO BEV'],
  [/乾崑智驾ADS SE纯电版/g, 'Qiankun ADS SE BEV'],
  [/华为乾崑智驾/g, 'Huawei Qiankun AD'],
  [/华为乾崑激光版/g, 'Huawei Qiankun LiDAR Edition'],
  [/华为乾崑/g, 'Huawei Qiankun'],
  [/比亚迪/g, 'BYD'],
  [/方程豹/g, 'Fangchengbao'],
  [/零跑/g, 'Leapmotor'],
  [/吉利银河/g, 'Geely Galaxy'],
  [/雷达/g, 'Radar'],
  [/极氪/g, 'Zeekr'],
  [/领克/g, 'Lynk & Co'],
  [/埃安/g, 'AION'],
  [/昊铂/g, 'HYPTEC'],
  [/东风/g, 'Dongfeng'],
  [/长安/g, 'Changan'],
  [/长安深蓝/g, 'Changan Deepal'],
  [/名爵/g, 'MG'],
  [/丰田/g, 'Toyota'],
  [/铂智3X/g, 'bZ3X'],
  [/奇瑞/g, 'Chery'],
  [/五菱/g, 'Wuling'],
  [/极狐/g, 'ARCFOX'],
  [/元PLUS/g, 'Yuan PLUS'],
  [/元UP/g, 'Yuan UP'],
  [/宋PLUS新能源/g, 'Song PLUS New Energy'],
  [/宋PLUS EV/g, 'Song Plus EV'],
  [/唐L/g, 'Tang L'],
  [/海狮07 EV/g, 'Sealion 07 EV'],
  [/海鸥/g, 'Seagull'],
  [/海豚/g, 'Dolphin'],
  [/钛3/g, 'Tai 3'],
  [/豹5/g, 'Bao 5'],
  [/豹8/g, 'Bao 8'],
  [/星愿/g, 'Xingyuan'],
  [/银河E5/g, 'Galaxy E5'],
  [/极氪7X/g, '7X'],
  [/极氪X/g, 'X'],
  [/领克Z10/g, 'Z10'],
  [/纳米01/g, 'Nammi 01'],
  [/风神L7 EV/g, 'Aeolus L7 EV'],
  [/深蓝 S07/g, 'Deepal S07'],
  [/深蓝S05/g, 'Deepal S05'],
  [/深蓝S07/g, 'Deepal S07'],
  [/启源Q05/g, 'Qiyuan Q05'],
  [/星光730 EV/g, 'Xingguang 730 EV'],
  [/星光S EV/g, 'Xingguang S EV'],
  [/星光 EV/g, 'Xingguang EV'],
  [/星光L/g, 'Xingguang L'],
  [/华境S/g, 'Huajing S'],
  [/阿尔法T5/g, 'Alpha T5'],
  [/银河 E5/g, 'Galaxy E5'],
  [/纯电动/g, 'BEV'],
  [/插电式混合动力/g, 'PHEV'],
  [/增程式/g, 'EREV'],
  [/豪华型/g, 'Luxury'],
  [/尊贵型/g, 'Premium'],
  [/旗舰型/g, 'Flagship'],
  [/纯电版/g, 'BEV'],
  [/启航版/g, 'Launch Edition'],
  [/探索版/g, 'Explore Edition'],
  [/远航版/g, 'Long Range Edition'],
  [/探索\+版/g, 'Explore+ Edition'],
  [/星舰版/g, 'Flagship Edition'],
  [/纯电/g, 'BEV'],
  [/紧凑型 SUV/g, 'Compact SUV'],
  [/中型 SUV/g, 'Mid-size SUV'],
  [/中大型 SUV/g, 'Mid-to-large SUV'],
  [/大型 SUV/g, 'Large SUV'],
  [/紧凑型 MPV/g, 'Compact MPV'],
  [/紧凑型车/g, 'Compact car'],
  [/磷酸铁锂刀片电池/g, 'LFP Blade Battery'],
  [/磷酸铁锂电池/g, 'LFP Battery'],
  [/前置前驱/g, 'Front-motor FWD'],
  [/后置后驱/g, 'Rear-motor RWD'],
  [/前驱/g, 'FWD'],
  [/后驱/g, 'RWD'],
  [/5 门 5 座 SUV/g, '5-door 5-seat SUV'],
  [/5 座/g, '5 seats'],
  [/麦弗逊式独立悬架/g, 'MacPherson independent suspension'],
  [/多连杆式独立悬架/g, 'Multi-link independent suspension'],
  [/H 臂多连杆独立悬架/g, 'H-arm multi-link independent suspension'],
  [/电动助力/g, 'Electric power steering'],
  [/承载式/g, 'Unibody'],
  [/通风盘式/g, 'Ventilated disc'],
  [/盘式/g, 'Disc'],
  [/电子驻车/g, 'Electronic parking brake'],
  [/胎压显示/g, 'Tire pressure display'],
  [/支持/g, 'Supported'],
  [/标配/g, 'Standard'],
  [/以版本配置为准/g, 'Depends on trim'],
  [/以实车配置为准/g, 'Subject to actual vehicle configuration'],
  [/以公开配置为准/g, 'Subject to public specification'],
  [/以官方配置为准/g, 'Subject to official specification'],
  [/可开启全景天窗/g, 'Openable panoramic sunroof'],
  [/全景天窗/g, 'Panoramic sunroof'],
  [/车顶行李架/g, 'Roof rails'],
  [/加热/g, 'heating'],
  [/通风/g, 'ventilation'],
  [/按摩/g, 'massage'],
  [/高阶音响/g, 'premium audio'],
  [/激光版/g, 'LiDAR Edition'],
  [/深蓝智驾/g, 'Deepal AD'],
  [/按版本配置/g, 'depending on trim'],
  [/左右/g, 'approx.'],
  [/万元/g, 'RMB 10k'],
  [/小时/g, 'h'],
  [/分钟/g, 'min'],
  [/约/g, 'approx. '],
]

const ALL_STATUSES = '__all__'
const lockedQuoteRequestStatuses = new Set(['quote_accepted', 'pi_confirmed'])

type I18nContextValue = {
  language: Language
  setLanguage: (language: Language) => void
  t: (key: string) => string
  roleLabel: (role: Role) => string
  statusLabel: (label: string) => string
  specGroupLabel: (label: string) => string
  specNameLabel: (label: string) => string
  specValueLabel: (value: string) => string
  formatDateText: (value: string | null) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

function useI18n() {
  const context = useContext(I18nContext)
  if (!context) throw new Error('I18nContext is missing')
  return context
}

const formatUsd = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)

const formatPrice = (value: number | null | undefined, currency?: string) => {
  if (value === null || value === undefined || value === 0) return '-'
  if (currency === 'CNY') {
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency: 'CNY',
      maximumFractionDigits: 0,
    }).format(value)
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

const formatDate = (value: string | null) =>
  value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(new Date(value)) : '未设置'

const formatDateByLanguage = (value: string | null, language: Language) =>
  value
    ? new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', { dateStyle: 'medium' }).format(new Date(value))
    : language === 'zh' ? '未设置' : 'Not set'

function translateSpecValue(value: string, language: Language) {
  if (language === 'zh') return value
  return specValueTranslations.reduce(
    (translated, [pattern, replacement]) => translated.replace(pattern, replacement),
    value,
  )
}

function displayModelName(profile: Pick<VehicleProfile, 'brand' | 'model'>, language: Language) {
  return language === 'zh'
    ? `${profile.brand} ${profile.model}`
    : translateSpecValue(`${profile.brand} ${profile.model}`, language)
}

function displayTrimName(trim: string, language: Language) {
  return translateSpecValue(trim, language)
}

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const isFormData = options?.body instanceof FormData
  const response = await fetch(url, {
    ...options,
    headers: isFormData ? options?.headers : { 'Content-Type': 'application/json', ...options?.headers },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: '请求失败' }))
    throw new Error(body.error || '请求失败')
  }
  return response.status === 204 ? (undefined as T) : response.json()
}

interface ToastMessage {
  id: number
  text: string
  type: 'success' | 'info' | 'error' | 'warning'
}

const FIELD_NL_LABELS: Record<string, string> = {
  brand: '品牌',
  modelName: '车型名称',
  year: '年份',
  trimName: '车型版本',
  exteriorColor: '外饰颜色',
  interiorColor: '内饰颜色',
  stockQuantity: '库存数量',
  supplierPrice: '供应价格',
  currency: '币种',
  tradeTerm: '贸易术语',
  priceExw: 'EXW价格',
  priceFca: 'FCA价格',
  priceFob: 'FOB价格',
  officialPrice: '官方指导价',
  location: '库存地',
  preorderMinDays: '预订最短天数',
  preorderMaxDays: '预订最长天数',
  canPreorder: '是否可预订',
  notes: '备注',
}

function App() {
  const [language, setLanguage] = useState<Language>(() => {
    const saved = window.localStorage.getItem('ev-language')
    return saved === 'en' ? 'en' : 'zh'
  })
  const [data, setData] = useState<AppData | null>(null)
  const [checkingSession, setCheckingSession] = useState(true)
  const [active, setActive] = useState<NavKey>(readStoredNavKey)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [appSidebarCollapsed, setAppSidebarCollapsed] = useState(() => {
    return window.localStorage.getItem('ev-app-sidebar-collapsed') === 'true'
  })
  const [toasts, setToasts] = useState<ToastMessage[]>([])

  const showToast = (text: string, type: 'success' | 'info' | 'error' | 'warning' = 'success') => {
    const id = Date.now()
    setToasts((current) => [...current, { id, text, type }])
    setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== id))
    }, 3000)
  }

  const [exchangeRate, setExchangeRate] = useState(7.2)

  useEffect(() => {
    window.localStorage.setItem('ev-app-sidebar-collapsed', String(appSidebarCollapsed))
  }, [appSidebarCollapsed])

  async function loadData() {
    const appData = await api<AppData>('/api/bootstrap')
    setData(appData)
    setExchangeRate(appData.exchangeRate ?? 7.2)
  }

  useEffect(() => {
    void api<AppData>('/api/bootstrap')
      .then((appData) => {
        setData(appData)
        setExchangeRate(appData.exchangeRate ?? 7.2)
      })
      .catch(() => setData(null))
      .finally(() => setCheckingSession(false))
  }, [])

  useEffect(() => {
    window.localStorage.setItem('ev-language', language)
  }, [language])

  useEffect(() => {
    window.localStorage.setItem(ACTIVE_NAV_STORAGE_KEY, active)
  }, [active])

  useEffect(() => {
    if (!data) return
    const canAccessActiveNav = navItems.some((item) => item.key === active && item.roles.includes(data.user.role))
    if (!canAccessActiveNav) {
      const fallback = navItems.find((item) => item.roles.includes(data.user.role))?.key ?? 'vehicles'
      Promise.resolve().then(() => {
        setActive(fallback)
      })
    }
  }, [active, data])

  const i18n = useMemo<I18nContextValue>(() => ({
    language,
    setLanguage,
    t: (key: string) => translations[language][key] ?? key,
    roleLabel: (role: Role) => translations[language][`role_${role}`] ?? role,
    statusLabel: (label: string) => statusLabels[label]?.[language] ?? label,
    specGroupLabel: (label: string) => specGroupLabels[label]?.[language] ?? label,
    specNameLabel: (label: string) => specNameLabels[label]?.[language] ?? label,
    specValueLabel: (value: string) => translateSpecValue(value, language),
    formatDateText: (value: string | null) => formatDateByLanguage(value, language),
  }), [language])

  if (checkingSession) {
    return (
      <I18nContext.Provider value={i18n}>
        <div className="splash">{language === 'zh' ? '正在连接内部管理系统...' : 'Connecting to the internal management system...'}</div>
      </I18nContext.Provider>
    )
  }
  if (!data) {
    return (
      <I18nContext.Provider value={i18n}>
        <Login onSuccess={loadData} />
      </I18nContext.Provider>
    )
  }

  const visibleNav = navItems.filter((item) => item.roles.includes(data.user.role))
  const title = i18n.t(`nav_${visibleNav.find((item) => item.key === active)?.key ?? 'sourceImports'}`)

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' })
    setData(null)
    setActive('sourceImports')
  }

  return (
    <I18nContext.Provider value={i18n}>
      <div className={`app-shell ${appSidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        <aside className={`sidebar ${mobileNavOpen ? 'open' : ''} ${appSidebarCollapsed ? 'collapsed' : ''}`}>
          <div className="brand">
            <div className="brand-logo-name" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div className="brand-mark">EV</div>
              {!appSidebarCollapsed && (
                <div>
                  <strong>{i18n.t('appName')}</strong>
                  <span>China / Ethiopia</span>
                </div>
              )}
            </div>
            <button
              className="app-sidebar-toggle"
              onClick={() => setAppSidebarCollapsed(!appSidebarCollapsed)}
              title={appSidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
              type="button"
              style={{
                background: 'transparent',
                border: 0,
                padding: '4px',
                color: '#9fb0c6',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginLeft: appSidebarCollapsed ? '0' : 'auto',
                width: 'auto',
                minHeight: 'auto',
              }}
            >
              {appSidebarCollapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
            </button>
          </div>
          <nav>
            {visibleNav.map((item) => {
              const Icon = item.icon
              return (
                <button
                  className={active === item.key ? 'active' : ''}
                  key={item.key}
                  onClick={() => {
                    setActive(item.key)
                    setMobileNavOpen(false)
                  }}
                  title={appSidebarCollapsed ? i18n.t(`nav_${item.key}`) : undefined}
                  type="button"
                >
                  <Icon size={18} />
                  {!appSidebarCollapsed && i18n.t(`nav_${item.key}`)}
                </button>
              )
            })}
          </nav>
          <div className="sidebar-user">
            {!appSidebarCollapsed ? (
              <>
                <div>
                  <strong>{data.user.displayName}</strong>
                  <span>{i18n.roleLabel(data.user.role)}</span>
                </div>
                <button aria-label={i18n.t('logout')} onClick={logout} title={i18n.t('logout')} type="button">
                  <LogOut size={17} />
                </button>
              </>
            ) : (
              <button aria-label={i18n.t('logout')} onClick={logout} title={i18n.t('logout')} type="button" style={{ margin: '0 auto' }}>
                <LogOut size={17} />
              </button>
            )}
          </div>
        </aside>

        <main className="workspace">
          <header className="topbar">
            <button
              aria-label="打开菜单"
              className="icon-button mobile-only"
              onClick={() => setMobileNavOpen((value) => !value)}
              type="button"
            >
              <Menu size={20} />
            </button>
            <div>
              <p className="eyebrow">
                {i18n.roleLabel(data.user.role)} {i18n.t('view')} · {data.user.displayName}
              </p>
              <h1>{title}</h1>
            </div>
            <div className="topbar-actions">
              <LanguageToggle />
            </div>
          </header>

          {active === 'sourceImports' && (
            <DataPanel title={i18n.t('nav_sourceImports')} subtitle={i18n.t('sourceImportsSubtitle')}>
              <SourceImportWorkbench
                currentUser={data.user}
                profiles={[]}
                showToast={showToast}
                exchangeRate={exchangeRate}
                setExchangeRate={setExchangeRate}
                onChanged={loadData}
              />
            </DataPanel>
          )}
          {active === 'vehicles' && (
            <DataPanel title={i18n.t('nav_vehicles')} subtitle={i18n.t('vehiclesSubtitle')}>
              <FeishuVehicleTable
                canSeeCost={data.permissions.canSeeCost}
              />
            </DataPanel>
          )}
        </main>
        <div className="toast-container">
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast-item ${toast.type}`}>
              {toast.type === 'success' && <CheckCircle2 size={16} />}
              {toast.type === 'error' && <X size={16} />}
              {toast.type === 'info' && <Sparkles size={16} />}
              <span>{toast.text}</span>
            </div>
          ))}
        </div>
      </div>
    </I18nContext.Provider>
  )
}

function Login({ onSuccess }: { onSuccess: () => Promise<void> }) {
  const { t, roleLabel } = useI18n()
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('Admin123!')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      })
      await onSuccess()
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : '登录失败')
    } finally {
      setSubmitting(false)
    }
  }

  function selectDemo(role: Role) {
    const account = {
      admin: ['admin', 'Admin123!'],
      sales: ['sales', 'Sales123!'],
      partner: ['partner', 'Partner123!'],
      customer: ['customer', 'Customer123!'],
    }[role]
    setUsername(account[0])
    setPassword(account[1])
  }

  return (
    <main className="login-page">
      <section className="login-brand">
        <div className="brand-mark">EV</div>
        <h1>{t('loginTitle')}</h1>
        <p>{t('loginSubtitle')}</p>
        <div className="security-note">
          <ShieldCheck size={21} />
          <span>{t('securityNote')}</span>
        </div>
      </section>
      <form className="login-form" onSubmit={submit}>
        <div className="login-language-row">
          <LanguageToggle />
        </div>
        <div>
          <p className="eyebrow">{t('internalLogin')}</p>
          <h2>{t('welcomeBack')}</h2>
        </div>
        <label>
          {t('username')}
          <input autoComplete="username" onChange={(event) => setUsername(event.target.value)} value={username} />
        </label>
        <label>
          {t('password')}
          <input autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} type="password" value={password} />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button className="primary-button" disabled={submitting} type="submit">
          {submitting ? t('loggingIn') : t('login')}
        </button>
        <div className="demo-accounts">
          <span>{t('demoRoles')}</span>
          <button onClick={() => selectDemo('admin')} type="button">{roleLabel('admin')}</button>
          <button onClick={() => selectDemo('sales')} type="button">{roleLabel('sales')}</button>
          <button onClick={() => selectDemo('partner')} type="button">{roleLabel('partner')}</button>
          <button onClick={() => selectDemo('customer')} type="button">{roleLabel('customer')}</button>
        </div>
      </form>
    </main>
  )
}

function LanguageToggle() {
  const { language, setLanguage } = useI18n()
  return (
    <div className="language-toggle" aria-label={language === 'zh' ? '语言切换' : 'Language switch'}>
      <button className={language === 'zh' ? 'active' : ''} onClick={() => setLanguage('zh')} type="button">中文</button>
      <button className={language === 'en' ? 'active' : ''} onClick={() => setLanguage('en')} type="button">EN</button>
    </div>
  )
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return <section className="metric"><span>{label}</span><strong>{value}</strong><small>{note}</small></section>
}

function PanelHeader({ title, action }: { title: string; action: string }) {
  return <div className="panel-header"><h2>{title}</h2><button type="button">{action}</button></div>
}

function DataPanel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <section className="panel full"><div className="section-title"><h2>{title}</h2><p>{subtitle}</p></div>{children}</section>
}

function formatFileSize(size: number) {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${size} B`
}

function issueLabel(issue: string) {
  const labels: Record<string, string> = {
    missing_model: '缺车型',
    missing_trim: '缺配置',
    missing_price: '缺价格',
    missing_stock: '缺数量',
    missing_currency: '缺币种',
    missing_trade_term: '缺条款',
    missing_location: '缺地点',
    unmatched_profile: '未匹配车型库',
    profile_needs_confirmation: '车型待确认',
    duplicate_risk: '疑似同源重复',
    missing_from_latest_snapshot: '本次未出现',
    attachment_pending_parser: '附件待解析',
    ai_parsed: 'AI解析',
    ai_low_confidence: 'AI低置信',
    ai_uncertain_fields: 'AI待确认',
    ai_text_fallback: 'AI文本兜底',
  }
  return labels[issue] ?? issue
}

function SourceImportWorkbench({
  currentUser,
  profiles,
  showToast,
  exchangeRate,
  setExchangeRate,
  onChanged,
}: {
  currentUser: User
  profiles: VehicleProfile[]
  showToast: (text: string, type?: 'success' | 'info' | 'error' | 'warning') => void
  exchangeRate: number
  setExchangeRate: (value: number) => void
  onChanged: () => Promise<void>
}) {
  const { statusLabel } = useI18n()
  const [list, setList] = useState<SourceImportListResponse | null>(null)
  const [detail, setDetail] = useState<SourceImportBatchDetail | null>(null)
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null)
  const [selectedCandidateId, setSelectedCandidateId] = useState<number | null>(null)
  const [supplierName, setSupplierName] = useState('')
  const [snapshotTime, setSnapshotTime] = useState(() => new Date().toISOString().slice(0, 10))
  const [importedBy, setImportedBy] = useState(currentUser.displayName)
  const [notes, setNotes] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [aiMode, setAiMode] = useState<'rules_only' | 'ai_assist'>('ai_assist')
  const [showSupplierForm, setShowSupplierForm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [candidateFilter, setCandidateFilter] = useState('all')
  const [collapseSidebar, setCollapseSidebar] = useState(false)
  const [editingBatch, setEditingBatch] = useState<SourceImportBatch | null>(null)
  const [editSnapshotName, setEditSnapshotName] = useState('')
  const [editSnapshotTime, setEditSnapshotTime] = useState('')
  const [editNotes, setEditNotes] = useState('')

  async function handleEditBatch(event: FormEvent) {
    event.preventDefault()
    if (!editingBatch) return
    try {
      setBusy(true)
      await api<{ batch: SourceImportBatch }>(`/api/source-imports/batches/${editingBatch.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          snapshotName: editSnapshotName,
          snapshotTime: editSnapshotTime,
          notes: editNotes,
        }),
      })
      showToast('批次编辑成功', 'success')
      setEditingBatch(null)
      await loadList()
      await loadBatch(editingBatch.id)
    } catch (e: unknown) {
      showToast(getErrorMessage(e, '编辑失败'), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function handleDeleteBatch(batchId: number) {
    if (!confirm('确定要删除该导入批次及该批次下的所有候选车源数据吗？\n如果该批次已有确认入库的车源，删除批次将自动撤销该供应商的对应报价和库存同步。此操作不可逆！')) {
      return
    }
    try {
      setBusy(true)
      await api(`/api/source-imports/batches/${batchId}`, {
        method: 'DELETE',
      })
      showToast('批次删除成功', 'success')
      setSelectedBatchId((current) => {
        if (current === batchId) {
          return null
        }
        return current
      })
      setDetail(null)
      await loadList()
      await onChanged()
    } catch (e: unknown) {
      showToast(getErrorMessage(e, '删除失败'), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function loadList() {
    const response = await api<SourceImportListResponse>('/api/source-imports')
    setList(response)
    if (!selectedBatchId && response.batches[0]) setSelectedBatchId(response.batches[0].id)
  }



  async function loadBatch(batchId: number, preferredCandidateId?: number | null) {
    const response = await api<SourceImportBatchDetail>(`/api/source-imports/batches/${batchId}`)
    setDetail(response)
    setSelectedCandidateId((current) => {
      if (preferredCandidateId !== undefined) return preferredCandidateId
      if (current && response.candidates.some((candidate) => candidate.id === current)) return current
      return response.candidates[0]?.id ?? null
    })
  }

  function findNextFilteredCandidateId(currentId: number): number | null {
    if (filteredCandidates.length <= 1) return null
    const index = filteredCandidates.findIndex((c) => c.id === currentId)
    if (index >= 0) {
      if (index + 1 < filteredCandidates.length) {
        return filteredCandidates[index + 1].id
      } else {
        return filteredCandidates[0].id
      }
    }
    return null
  }

  async function handleCandidateSaved(savedCandidate: SourceImportCandidate) {
    if (!selectedBatchId) return
    const nextId = findNextFilteredCandidateId(savedCandidate.id)
    const response = await api<SourceImportBatchDetail>(`/api/source-imports/batches/${selectedBatchId}`)
    setDetail(response)
    setSelectedCandidateId(() => {
      if (nextId && response.candidates.some((candidate) => candidate.id === nextId)) {
        return nextId
      }
      return null
    })
    await loadList()
    await onChanged()

    let toastType: 'success' | 'error' | 'info' = 'success'
    let actionWord = '已确认入库'
    if (savedCandidate.reviewStatus === 'rejected') {
      toastType = 'error'
      actionWord = '已驳回'
    } else if (savedCandidate.reviewStatus === 'needs_review') {
      toastType = 'info'
      actionWord = '已保存待审'
    }

    const nextCandidate = nextId ? response.candidates.find((c) => c.id === nextId) : null
    const nextMsg = nextCandidate
      ? `，已自动切换至下一条：#${nextId} [${nextCandidate.modelName || '未识别车型'}]`
      : '，本批次所有候选车源已处理完毕！'

    showToast(`候选 #${savedCandidate.id} [${savedCandidate.modelName || '未命名'}] ${actionWord}${nextMsg}`, toastType)
  }

  useEffect(() => {
    let cancelled = false
    void Promise.resolve().then(async () => {
      const response = await api<SourceImportListResponse>('/api/source-imports')
      if (cancelled) return
      setList(response)
      if (response.batches[0]) setSelectedBatchId(response.batches[0].id)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!selectedBatchId) return
    let cancelled = false
    void Promise.resolve().then(async () => {
      const response = await api<SourceImportBatchDetail>(`/api/source-imports/batches/${selectedBatchId}`)
      if (cancelled) return
      setDetail(response)
      setSelectedCandidateId((current) => {
        if (current && response.candidates.some((candidate) => candidate.id === current)) return current
        return response.candidates[0]?.id ?? null
      })
    })
    return () => {
      cancelled = true
    }
  }, [selectedBatchId])

  async function uploadBatch(event: FormEvent) {
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
  }

  async function resolveDuplicate(duplicateId: number, resolution: 'same_origin' | 'not_duplicate' | 'defer') {
    await api(`/api/source-imports/duplicates/${duplicateId}`, {
      method: 'PATCH',
      body: JSON.stringify({ resolution }),
    })
    if (selectedBatchId) await loadBatch(selectedBatchId)
    await loadList()
  }

  async function loadList() {
    const response = await api<SourceImportListResponse>('/api/source-imports')
    setList(response)
    if (!selectedBatchId && response.batches[0]) setSelectedBatchId(response.batches[0].id)
  }

  const candidates = detail?.candidates ?? []
  const filteredCandidates =
    candidateFilter === 'all'
      ? candidates
      : candidateFilter === 'issues'
        ? candidates.filter((candidate) => candidate.issueTags.length > 0)
        : candidateFilter === 'duplicates'
          ? candidates.filter((candidate) => candidate.issueTags.includes('duplicate_risk'))
          : candidateFilter === 'missing'
            ? candidates.filter((candidate) => candidate.changeStatus === 'missing_from_latest_snapshot')
            : candidates.filter((candidate) => candidate.reviewStatus === candidateFilter)

  const selectedCandidate = detail?.candidates.find((candidate) => candidate.id === selectedCandidateId) ?? null
  const aiStatus = list?.aiStatus
  const effectiveAiMode = aiStatus?.enabled ? aiMode : 'rules_only'

  return (
    <div className="source-import-workbench">
      <form className="source-import-upload" onSubmit={uploadBatch}>
        <div>
          <strong>导入供应商快照</strong>
          <span>供应商每次发来的表都作为一个时间点声明；快照名称会自动按“供应商-范围-车源-日期-序号”生成。</span>
        </div>
        <div className="source-upload-grid">
          <div className="supplier-select-field">
            <label>供应商
              <select onChange={(event) => setSupplierName(event.target.value)} required value={supplierName}>
                <option value="">选择供应商</option>
                {list?.suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.supplierName}>{supplier.supplierName}</option>
                ))}
              </select>
            </label>
            <div className="supplier-actions">
              <button className="supplier-add-button" onClick={() => setShowSupplierForm(true)} type="button">
                <Plus size={15} />
                新增
              </button>
              {list?.suppliers.length > 0 && (
                <button className="supplier-add-button danger-outline" onClick={async () => {
                  const s = list?.suppliers.find((s) => s.supplierName === supplierName)
                  if (s && confirm(`确定删除供应商「${s.supplierName}」？`)) {
                    await api(`/api/source-imports/suppliers/${s.id}`, { method: 'DELETE' })
                    setSupplierName('')
                    await loadList()
                  }
                }} type="button">
                  <Trash2 size={14} />
                  删除
                </button>
              )}
            </div>
          </div>
          <label>快照日期
            <input onChange={(event) => setSnapshotTime(event.target.value)} type="date" value={snapshotTime} />
          </label>
          <label>导入人
            <input onChange={(event) => setImportedBy(event.target.value)} value={importedBy} />
          </label>
        </div>
        <section className="ai-parser-box">
          <div>
            <Sparkles size={17} />
            <strong>AI 解析层</strong>
            <span>
              {aiStatus?.enabled
                ? `已启用 ${aiStatus.provider} / ${aiStatus.model}，可辅助识别图片、合并字段和供应商口语表达。`
                : '未配置 AI API Key，当前只使用传统规则解析；配置 OpenRouter 或 OpenAI 后可启用图片 OCR 和语义拆字段。'}
            </span>
          </div>
          <label>
            解析方式
            <select
              disabled={!aiStatus?.enabled}
              onChange={(event) => setAiMode(event.target.value as 'rules_only' | 'ai_assist')}
              value={effectiveAiMode}
            >
              <option value="rules_only">规则解析</option>
              <option value="ai_assist">AI辅助解析</option>
            </select>
          </label>
        </section>
        <label className="source-file-picker">
          <Upload size={18} />
          <span>{files.length > 0 ? `${files.length} 个文件已选择` : '选择 Excel 或图片文件'}</span>
          <input
            multiple
            onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
            type="file"
            accept=".xlsx,.xls,.png,.jpg,.jpeg,.webp"
          />
        </label>
        {files.length > 0 && (
          <div className="selected-source-files">
            {files.map((file) => <span key={`${file.name}-${file.size}`}>{file.name} · {formatFileSize(file.size)}</span>)}
          </div>
        )}
        <textarea onChange={(event) => setNotes(event.target.value)} placeholder="本批次备注，例如部分库存已售、供应商口头说明、价格有效期等" value={notes} />
        {showSupplierForm && (
          <SourceSupplierQuickForm
            onClose={() => setShowSupplierForm(false)}
            onCreated={async (supplier) => {
              setShowSupplierForm(false)
              setSupplierName(supplier.supplierName)
              await loadList()
            }}
          />
        )}
        <button disabled={busy || !supplierName || files.length === 0} type="submit">
          <Upload size={16} />
          {busy ? '导入中...' : '导入并解析'}
        </button>
        {error && <p className="form-error">{error}</p>}
      </form>

      <div className={`source-import-layout ${collapseSidebar ? 'collapsed-sidebar' : ''}`}>
        <aside className="source-batch-list">
          <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong>导入批次</strong>
              <span>{list?.batches.length ?? 0} 批</span>
            </div>
            <button
              className="sidebar-toggle-button"
              onClick={() => setCollapseSidebar(true)}
              title="收起批次列表"
              type="button"
              style={{ padding: '4px', display: 'flex', alignItems: 'center' }}
            >
              <ChevronsLeft size={16} />
            </button>
          </header>
          {list?.batches.map((batch) => (
            <div
              className={`source-batch-item ${selectedBatchId === batch.id ? 'active' : ''}`}
              key={batch.id}
            >
              <div
                className="batch-item-content"
                onClick={() => setSelectedBatchId(batch.id)}
              >
                <div>
                  <strong>{batch.supplierName}</strong>
                  <span>{batch.snapshotName || `快照 V${batch.id}`} · {batch.snapshotTime}</span>
                </div>
                <Badge label={batch.status} />
                <small>{batch.summary.total} 条 · {batch.summary.needsReview} 待审 · {batch.summary.withIssues} 有问题</small>
              </div>

              <div className="batch-item-actions">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setEditingBatch(batch)
                    setEditSnapshotName(batch.snapshotName || '')
                    setEditSnapshotTime(batch.snapshotTime)
                    setEditNotes(batch.notes || '')
                  }}
                  title="编辑批次"
                  type="button"
                >
                  <Pencil size={13} />
                </button>
                {currentUser.role === 'admin' && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      void handleDeleteBatch(batch.id)
                    }}
                    title="删除批次"
                    type="button"
                    className="delete-btn"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </div>
          ))}
          {list?.batches.length === 0 && <p>暂无导入批次</p>}
        </aside>

        <section className="source-import-main">
          {detail ? (
            <>
              <div className="source-import-summary">
                <Metric label="候选车源" value={`${detail.batch.summary.total}`} note={`${detail.batch.summary.approved} 已确认`} />
                <Metric label="待处理" value={`${detail.batch.summary.needsReview}`} note={`${detail.batch.summary.withIssues} 条带问题标签`} />
                <Metric label="同源风险" value={`${detail.duplicates.filter((duplicate) => duplicate.status !== 'resolved').length}`} note="跨供应商疑似重复" />
                <Metric label="快照变化" value={`${detail.snapshots[0]?.changedCount ?? 0}`} note={`${detail.snapshots[0]?.missingCount ?? 0} 条本次未出现`} />
                <Metric label="经验记录" value={`${list?.metrics.totalFieldChanges ?? 0}`} note={`${list?.metrics.recognitionCorrections ?? 0} 次纠错 · ${list?.metrics.humanSupplements ?? 0} 次补充`} />
              </div>
              <div className="source-batch-toolbar">
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  {collapseSidebar && (
                    <button
                      className="sidebar-toggle-button"
                      onClick={() => setCollapseSidebar(false)}
                      title="展开批次列表"
                      type="button"
                      style={{ padding: '4px', display: 'flex', alignItems: 'center', marginRight: '8px' }}
                    >
                      <ChevronsRight size={16} />
                    </button>
                  )}
                  <div>
                    <strong>{detail.batch.supplierName}</strong>
                    <span>{detail.batch.snapshotName || '未命名快照'} · {detail.batch.snapshotTime} · {detail.batch.importedBy}</span>
                  </div>
                </div>
                <div className="source-toolbar-actions">
                  <label className="exchange-rate-inline">
                    <span>美金汇率</span>
                    <input
                      min="0"
                      onChange={async (event) => {
                        const newRate = Number(event.target.value)
                        setExchangeRate(newRate)
                        if (newRate > 0) {
                          try {
                            await api('/api/settings/exchange-rate', {
                              method: 'POST',
                              body: JSON.stringify({ exchangeRate: newRate }),
                            })
                          } catch (err: unknown) {
                            showToast(getErrorMessage(err, '汇率更新失败'), 'error')
                          }
                        }
                      }}
                      step="0.0001"
                      type="number"
                      value={exchangeRate}
                    />
                  </label>

                </div>
              </div>
              <div className="source-file-list">
                {detail.files.map((file) => (
                  <div key={file.id}>
                    <FileText size={16} />
                    <span>{file.originalName}</span>
                    <small>{statusLabel(file.parseStatus)} · {file.parserNotes || formatFileSize(file.fileSize)}</small>
                  </div>
                ))}
              </div>
              <div className="source-candidate-tools">
                <select onChange={(event) => setCandidateFilter(event.target.value)} value={candidateFilter}>
                  <option value="all">全部候选</option>
                  <option value="needs_review">待审核</option>
                  <option value="approved">已确认</option>
                  <option value="issues">有问题标签</option>
                  <option value="duplicates">疑似同源</option>
                  <option value="missing">本次未出现</option>
                  <option value="rejected">已驳回</option>
                </select>
                <span>{filteredCandidates.length} 条</span>
              </div>
              <div className={`source-review-grid ${!selectedCandidate ? 'no-editor' : ''}`}>
                <div className="source-candidate-table">
                  <div className="source-candidate-head">
                    <span>状态</span>
                    <span>品牌</span>
                    <span>车型</span>
                    <span>年款</span>
                    <span>配置版本</span>
                    <span>外观色</span>
                    <span>内饰色</span>
                    <span>数量</span>
                    <span>EXW 价格</span>
                    <span>FCA 价格</span>
                    <span>FOB 价格</span>
                    <span>指导价</span>
                    <span>库存地</span>
                    <span>车型库匹配</span>
                    <span>问题标签</span>
                  </div>
                  {filteredCandidates.map((candidate) => (
                    <button
                      className={[
                        selectedCandidateId === candidate.id ? 'active' : '',
                        candidate.reviewStatus === 'rejected' ? 'rejected' : '',
                      ].filter(Boolean).join(' ')}
                      key={candidate.id}
                      onClick={() => setSelectedCandidateId(candidate.id)}
                      type="button"
                    >
                      <span><Badge label={candidate.reviewStatus} /><small>{statusLabel(candidate.changeStatus)}</small></span>
                      <span>{candidate.brand || '-'}</span>
                      <span><strong>{candidate.modelName || '未识别车型'}</strong></span>
                      <span>{candidate.year || '-'}</span>
                      <span>{candidate.trimName || '-'}</span>
                      <span>{candidate.exteriorColor || '-'}</span>
                      <span>{candidate.interiorColor || '-'}</span>
                      <strong>{candidate.stockQuantity}</strong>
                      <span>
                        {candidate.priceExw ? (
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: '1.2' }}>
                            <strong>{candidate.priceExwCurrency === 'CNY' ? '¥' : '$'}{candidate.priceExw.toLocaleString()}</strong>
                            <small style={{ color: '#64748b', fontSize: '10px' }}>
                              {candidate.priceExwCurrency === 'CNY'
                                ? `$${(candidate.priceExw / exchangeRate).toFixed(0)}`
                                : `¥${(candidate.priceExw * exchangeRate).toFixed(0)}`}
                            </small>
                          </div>
                        ) : '-'}
                      </span>
                      <span>
                        {candidate.priceFca ? (
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: '1.2' }}>
                            <strong>{candidate.priceFcaCurrency === 'CNY' ? '¥' : '$'}{candidate.priceFca.toLocaleString()}</strong>
                            <small style={{ color: '#64748b', fontSize: '10px' }}>
                              {candidate.priceFcaCurrency === 'CNY'
                                ? `$${(candidate.priceFca / exchangeRate).toFixed(0)}`
                                : `¥${(candidate.priceFca * exchangeRate).toFixed(0)}`}
                            </small>
                          </div>
                        ) : '-'}
                      </span>
                      <span>
                        {candidate.priceFob ? (
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: '1.2' }}>
                            <strong>{candidate.priceFobCurrency === 'CNY' ? '¥' : '$'}{candidate.priceFob.toLocaleString()}</strong>
                            <small style={{ color: '#64748b', fontSize: '10px' }}>
                              {candidate.priceFobCurrency === 'CNY'
                                ? `$${(candidate.priceFob / exchangeRate).toFixed(0)}`
                                : `¥${(candidate.priceFob * exchangeRate).toFixed(0)}`}
                            </small>
                          </div>
                        ) : '-'}
                      </span>
                      <span>{candidate.officialPrice || '-'}</span>
                      <span>{candidate.location || '-'}</span>
                      <span style={{ fontSize: '12px', color: '#475569' }}>
                        {(() => {
                          const p = profiles.find((item) => item.id === candidate.profileId)
                          return p ? `${p.brand} ${p.model}` : '-'
                        })()}
                      </span>
                      <span className="candidate-issues">{candidate.issueTags.slice(0, 2).map(issueLabel).join('、') || '无'}</span>
                    </button>
                  ))}
                </div>
                {selectedCandidate && (
                  <CandidateEditor
                    candidate={selectedCandidate}
                    key={selectedCandidate?.id ?? 'empty'}
                    onSaved={handleCandidateSaved}
                    onDataChanged={async () => {
                      if (!selectedBatchId) return
                      const response = await api<SourceImportBatchDetail>(`/api/source-imports/batches/${selectedBatchId}`)
                      setDetail(response)
                      await loadList()
                    }}
                    onClose={() => setSelectedCandidateId(null)}
                    profiles={profiles}
                  />
                )}
              </div>
              <div className="source-lower-grid">
                <section className="duplicate-panel">
                  <header>
                    <strong><Link2 size={16} /> 同源重复建议</strong>
                    <span>{detail.duplicates.length} 条</span>
                  </header>
                  {detail.duplicates.length === 0 ? (
                    <p>本批次暂无明显跨供应商同源风险。</p>
                  ) : detail.duplicates.map((duplicate) => {
                    const candidate = detail.candidates.find((item) => item.id === duplicate.candidateId)
                    return (
                      <article key={duplicate.id}>
                        <div>
                          <strong>{candidate?.modelName || `候选 #${duplicate.candidateId}`}</strong>
                          <span>{duplicate.reason}</span>
                          <small>
                            匹配历史车源：{duplicate.matchedSupplier || '未知渠道'} 的 {duplicate.matchedModel || '未知车型'}
                            {duplicate.matchedPrice != null && ` (${duplicate.matchedCurrency || 'USD'} ${duplicate.matchedPrice})`} 
                            · {statusLabel(duplicate.status)} {duplicate.resolution && `· ${duplicate.resolution}`}
                          </small>
                        </div>
                        {duplicate.status !== 'resolved' && (
                          <div>
                            <button onClick={() => void resolveDuplicate(duplicate.id, 'same_origin')} type="button">确认同源</button>
                            <button onClick={() => void resolveDuplicate(duplicate.id, 'not_duplicate')} type="button">不是重复</button>
                            <button onClick={() => void resolveDuplicate(duplicate.id, 'defer')} type="button">稍后处理</button>
                          </div>
                        )}
                      </article>
                    )
                  })}
                </section>
              </div>
            </>
          ) : (
            <EmptyState text="请先导入或选择一个供应商快照批次" />
          )}
        </section>
      </div>
      {editingBatch && (
        <div className="modal-backdrop">
          <form className="quote-form staff-form" onSubmit={handleEditBatch}>
            <div className="modal-title">
              <div>
                <strong>编辑导入批次资料</strong>
                <span>修改此批次的快照名称、快照日期及备注信息。</span>
              </div>
              <button onClick={() => setEditingBatch(null)} type="button">×</button>
            </div>
            <div className="form-grid">
              <label>
                快照名称
                <input
                  onChange={(event) => setEditSnapshotName(event.target.value)}
                  value={editSnapshotName}
                  placeholder="例如: 2026年6月第一批次"
                  required
                />
              </label>
              <label>
                快照时间
                <input
                  type="date"
                  onChange={(event) => setEditSnapshotTime(event.target.value)}
                  value={editSnapshotTime}
                  required
                />
              </label>
            </div>
            <label>
              批次备注
              <textarea
                onChange={(event) => setEditNotes(event.target.value)}
                value={editNotes}
                rows={3}
                placeholder="填写关于此批次的补充备注信息..."
                style={{ width: '100%', boxSizing: 'border-box', marginTop: '4px' }}
              />
            </label>
            <div className="supplier-quick-actions" style={{ marginTop: '20px' }}>
              <button className="secondary-button" onClick={() => setEditingBatch(null)} type="button">取消</button>
              <button type="submit" disabled={busy}>
                <Save size={15} />
                {busy ? '保存中...' : '保存修改'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

function SourceSupplierQuickForm({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (supplier: SourceSupplier) => Promise<void>
}) {
  const [supplierName, setSupplierName] = useState('')
  const [contactName, setContactName] = useState('')
  const [phone, setPhone] = useState('')
  const [wechat, setWechat] = useState('')
  const [location, setLocation] = useState('')
  const [channelType, setChannelType] = useState('unknown')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function saveSupplier() {
    setBusy(true)
    setError('')
    try {
      const response = await api<{ supplier: SourceSupplier }>('/api/source-imports/suppliers', {
        method: 'POST',
        body: JSON.stringify({
          supplierName,
          contactName,
          phone,
          wechat,
          location,
          channelType,
          notes,
        }),
      })
      await onCreated(response.supplier)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '供应商保存失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="supplier-quick-form">
      <header>
        <div>
          <strong>新增供应商</strong>
          <span>保存后会进入供应商下拉列表，后续导入不用重复手写。</span>
        </div>
        <button aria-label="关闭新增供应商" onClick={onClose} type="button"><X size={16} /></button>
      </header>
      <div className="supplier-quick-grid">
        <label>供应商名称<input onChange={(event) => setSupplierName(event.target.value)} placeholder="例如：重庆盛世惠迪" value={supplierName} /></label>
        <label>联系人<input onChange={(event) => setContactName(event.target.value)} placeholder="例如：王经理" value={contactName} /></label>
        <label>电话<input onChange={(event) => setPhone(event.target.value)} value={phone} /></label>
        <label>微信<input onChange={(event) => setWechat(event.target.value)} value={wechat} /></label>
        <label>所在地<input onChange={(event) => setLocation(event.target.value)} placeholder="例如：重庆 / 南沙 / 霍尔果斯" value={location} /></label>
        <label>渠道类型<select onChange={(event) => setChannelType(event.target.value)} value={channelType}>
          <option value="unknown">待确认</option>
          <option value="primary_source">源头供应商</option>
          <option value="dealer">经销商/4S店</option>
          <option value="trader">贸易商</option>
          <option value="mixed_channel">混合渠道</option>
        </select></label>
      </div>
      <textarea onChange={(event) => setNotes(event.target.value)} placeholder="供应商备注，例如授权情况、常报品牌、付款习惯、同源线索等" value={notes} />
      {error && <p className="form-error">{error}</p>}
      <div className="supplier-quick-actions">
        <button className="secondary-button" onClick={onClose} type="button">取消</button>
        <button disabled={busy || !supplierName.trim()} onClick={saveSupplier} type="button">
          <Save size={15} />
          {busy ? '保存中...' : '保存供应商'}
        </button>
      </div>
    </section>
  )
}

function CandidateEditor({
  candidate,
  profiles,
  onSaved,
  onClose,
  onDataChanged,
}: {
  candidate: SourceImportCandidate | null
  profiles: VehicleProfile[]
  onSaved: (candidate: SourceImportCandidate) => Promise<void>
  onClose?: () => void
  onDataChanged?: () => Promise<void>
}) {
  const { statusLabel } = useI18n()
  const [draft, setDraft] = useState<SourceImportCandidate | null>(candidate)
  const [busy, setBusy] = useState(false)
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [refining, setRefining] = useState(false)
  const [feedbackSuccess, setFeedbackSuccess] = useState('')
  const [promptRefinePreview, setPromptRefinePreview] = useState('')

  async function handleSendFeedback() {
    if (!draft || !feedback.trim()) return
    setRefining(true)
    setError('')
    setFeedbackSuccess('')
    setPromptRefinePreview('')
    try {
      // 1. 先用 PATCH 保存表单修正值到数据库（即时完成，不阻塞）
      await api(`/api/source-imports/candidates/${draft.id}`, {
        method: 'PATCH',
        body: JSON.stringify(draft),
      })
 
      // 2. 立即从 DB 刷新 draft + 父组件 detail，确保切换候选再切回来数据正确
      try {
        const refreshed = await api<{ candidate: SourceImportCandidate }>(`/api/source-imports/candidates/${draft.id}`)
        if (refreshed.candidate) {
          setDraft(refreshed.candidate)
        }
      } catch (_) { /* non-critical */ }
      if (onDataChanged) {
        await onDataChanged()
      }
 
      // 3. 同步提交并等待 AI 优化提炼完全结束（阻塞 UI，提供完整状态反馈）
      const result = await api<{ success: boolean; rules: any[]; refineResult?: { refined: boolean; reason?: string; rulesCount?: number; preview?: string; diffChars?: number } }>(`/api/source-imports/candidates/${draft.id}/refine-experience`, {
        method: 'POST',
        body: JSON.stringify({
          feedbackText: feedback,
          currentFormValues: draft,
        }),
      })
      
      if (result.refineResult?.refined) {
        const { rulesCount, diffChars, preview } = result.refineResult
        setFeedbackSuccess(
          `✅ 纠错同步完成，提示词已成功优化！` +
          `基于 ${rulesCount} 条确认经验，提示词发生变化${diffChars != null && diffChars > 0 ? `（+${diffChars}字符）` : diffChars != null && diffChars < 0 ? `（${diffChars}字符）` : ''}`
        )
        setPromptRefinePreview(
          `基于 ${rulesCount} 条经验完成优化。提示词已更新：${preview || ''}`
        )
      } else if (result.refineResult?.reason) {
        setFeedbackSuccess(`✅ 纠错已提交，但本次未优化提示词：${result.refineResult.reason}`)
      } else {
        setFeedbackSuccess('✅ 纠错经验已成功保存并同步！')
      }
      setTimeout(() => setFeedbackSuccess(''), 8000)
      setFeedback('')
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交纠错经验失败')
    } finally {
      setRefining(false)
    }
  }

  if (!draft) {
    return <aside className="candidate-editor empty">选择一条候选车源后进行审核。</aside>
  }

  function update<K extends keyof SourceImportCandidate>(key: K, value: SourceImportCandidate[K]) {
    setDraft((current) => current ? { ...current, [key]: value } : current)
  }

  async function save(reviewStatus?: string) {
    if (!draft) return
    const payload = draft
    const targetStatus = reviewStatus ?? payload.reviewStatus
    setPendingAction(targetStatus)
    setBusy(true)
    setError('')
    try {
      const response = await api<{ candidate: SourceImportCandidate }>(`/api/source-imports/candidates/${payload.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...payload,
          reviewStatus: targetStatus,
        }),
      })
      setDraft(response.candidate)
      await onSaved(response.candidate)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存失败')
    } finally {
      setBusy(false)
      setPendingAction(null)
    }
  }

  return (
    <aside className="candidate-editor">
      <header>
        <div>
          <strong>候选 #{draft.id}</strong>
          <span>{draft.sourceSheet} · 第 {draft.rowIndex || '-'} 行</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Badge label={draft.matchStatus} />
          {onClose && (
            <button
              onClick={onClose}
              title="关闭编辑"
              type="button"
              style={{ background: 'transparent', border: 0, padding: '4px', cursor: 'pointer', color: '#64748b', display: 'inline-flex', alignItems: 'center' }}
            >
              <X size={18} />
            </button>
          )}
        </div>
      </header>
      <div className="candidate-issue-list">
        {draft.issueTags.length === 0 ? <span>无问题标签</span> : draft.issueTags.map((issue) => <span key={issue}>{issueLabel(issue)}</span>)}
      </div>
      <div className="candidate-form-grid">
        <label>品牌<input onChange={(event) => update('brand', event.target.value)} value={draft.brand} /></label>
        <label>车型<input onChange={(event) => update('modelName', event.target.value)} value={draft.modelName} /></label>
        <label>年款<input onChange={(event) => update('year', event.target.value)} value={draft.year} /></label>
        <label>配置版本<input onChange={(event) => update('trimName', event.target.value)} value={draft.trimName} /></label>
        <label>外观色<input onChange={(event) => update('exteriorColor', event.target.value)} value={draft.exteriorColor} /></label>
        <label>内饰色<input onChange={(event) => update('interiorColor', event.target.value)} value={draft.interiorColor} /></label>
        <label>数量<input min="0" onChange={(event) => update('stockQuantity', Number(event.target.value))} type="number" value={draft.stockQuantity} /></label>
        <label>
          EXW 价格
          <div style={{ display: 'flex', gap: '4px' }}>
            <input
              min="0"
              onChange={(event) => update('priceExw', event.target.value === '' ? null : Number(event.target.value))}
              type="number"
              value={draft.priceExw ?? ''}
              style={{ flex: 1 }}
              placeholder="未填写"
            />
            <select
              onChange={(event) => update('priceExwCurrency', event.target.value)}
              value={draft.priceExwCurrency || 'USD'}
              style={{ width: '75px' }}
            >
              <option value="USD">USD</option>
              <option value="CNY">CNY</option>
            </select>
          </div>
        </label>
        <label>
          FCA 价格
          <div style={{ display: 'flex', gap: '4px' }}>
            <input
              min="0"
              onChange={(event) => update('priceFca', event.target.value === '' ? null : Number(event.target.value))}
              type="number"
              value={draft.priceFca ?? ''}
              style={{ flex: 1 }}
              placeholder="未填写"
            />
            <select
              onChange={(event) => update('priceFcaCurrency', event.target.value)}
              value={draft.priceFcaCurrency || 'USD'}
              style={{ width: '75px' }}
            >
              <option value="USD">USD</option>
              <option value="CNY">CNY</option>
            </select>
          </div>
        </label>
        <label>
          FOB 价格
          <div style={{ display: 'flex', gap: '4px' }}>
            <input
              min="0"
              onChange={(event) => update('priceFob', event.target.value === '' ? null : Number(event.target.value))}
              type="number"
              value={draft.priceFob ?? ''}
              style={{ flex: 1 }}
              placeholder="未填写"
            />
            <select
              onChange={(event) => update('priceFobCurrency', event.target.value)}
              value={draft.priceFobCurrency || 'USD'}
              style={{ width: '75px' }}
            >
              <option value="USD">USD</option>
              <option value="CNY">CNY</option>
            </select>
          </div>
        </label>
        <label>官方指导价参考<input onChange={(event) => update('officialPrice', event.target.value)} placeholder="例如：11.98万" value={draft.officialPrice || ''} /></label>
        <label>库存地<input onChange={(event) => update('location', event.target.value)} value={draft.location} /></label>
        <label>车型库<select onChange={(event) => update('profileId', event.target.value ? Number(event.target.value) : null)} value={draft.profileId ?? ''}>
          <option value="">暂不关联车型库</option>
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>{profile.brand} {profile.model} · {profile.year} · {profile.trim}</option>
          ))}
        </select></label>
        <label>同源处理<select onChange={(event) => update('canonicalAction', event.target.value)} value={draft.canonicalAction}>
          <option value="count_inventory">{statusLabel('count_inventory')}</option>
          <option value="same_origin_channel">{statusLabel('same_origin_channel')}</option>
          <option value="do_not_count">{statusLabel('do_not_count')}</option>
        </select></label>
        <label>审核状态<select onChange={(event) => update('reviewStatus', event.target.value)} value={draft.reviewStatus}>
          <option value="pending_review">{statusLabel('pending_review')}</option>
          <option value="needs_review">{statusLabel('needs_review')}</option>
          <option value="approved">{statusLabel('approved')}</option>
          <option value="rejected">{statusLabel('rejected')}</option>
        </select></label>
      </div>
      <div className="candidate-editor-footer">
        <div className="footer-left">
          <label className="candidate-notes">备注<textarea onChange={(event) => update('notes', event.target.value)} value={draft.notes} /></label>
          <div className="ai-feedback-section" style={{ marginTop: '16px', borderTop: '1px solid #e2e8f0', paddingTop: '16px' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontWeight: 'bold', fontSize: '13px', color: '#1e293b' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Sparkles size={14} style={{ color: '#6366f1' }} />
                <span>纠错并沉淀 AI 经验</span>
              </span>
              <textarea
                placeholder="在此向 AI 反馈具体错处（例如：钛3是配置版本，不是颜色；不要把赠送充电桩写进备注...），点击提交即可瞬间沉淀飞书规则并异步训练提示词！"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                style={{ minHeight: '60px', fontSize: '12px', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                disabled={refining}
              />
            </label>
            <button
              type="button"
              disabled={refining || !feedback.trim()}
              onClick={handleSendFeedback}
              style={{
                marginTop: '8px',
                background: refining || !feedback.trim() ? '#94a3b8' : '#6366f1',
                color: '#fff',
                border: 'none',
                padding: '6px 12px',
                borderRadius: '4px',
                cursor: refining || !feedback.trim() ? 'not-allowed' : 'pointer',
                fontSize: '12px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontWeight: 500
              }}
            >
              {refining && <Loader2 size={12} className="animate-spin" />}
              {refining ? '智能翻译并提炼提示词中...' : '提交 AI 纠错经验'}
            </button>
            {feedbackSuccess && <p style={{ color: '#10b981', fontSize: '12px', marginTop: '6px', fontWeight: 500 }}>{feedbackSuccess}</p>}
            {promptRefinePreview && (
              <details style={{ marginTop: '8px', fontSize: '11px', color: '#6b7280' }}>
                <summary style={{ cursor: 'pointer', fontWeight: 500 }}>查看最新优化结果</summary>
                <pre style={{ marginTop: '4px', padding: '6px', background: '#f3f4f6', borderRadius: '4px', whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: '11px', lineHeight: '1.4' }}>{promptRefinePreview}</pre>
              </details>
            )}
          </div>
        </div>
        <div className="footer-right">
          <details className="raw-fields">
            <summary>查看原始识别内容</summary>
            <pre>{JSON.stringify(draft.rawFields, null, 2)}</pre>
            <p>{draft.rawText}</p>
          </details>
          {error && <p className="form-error">{error}</p>}
          <div className="candidate-actions">
            <button disabled={busy} onClick={() => void save('approved')} type="button">
              {pendingAction === 'approved' ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Save size={15} />
              )}
              {pendingAction === 'approved' ? '确认中...' : '确认入库'}
            </button>
            <button disabled={busy} onClick={() => void save('needs_review')} type="button">
              {pendingAction === 'needs_review' && <Loader2 size={15} className="animate-spin" />}
              {pendingAction === 'needs_review' ? '保存中...' : '保存待审'}
            </button>
            <button className="danger-outline" disabled={busy} onClick={() => void save('rejected')} type="button">
              {pendingAction === 'rejected' ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <X size={15} />
              )}
              {pendingAction === 'rejected' ? '驳回中...' : '驳回'}
            </button>
          </div>
        </div>
      </div>
    </aside>
  )
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state">{text}</div>
}

function Badge({ label }: { label: string }) {
  const { statusLabel } = useI18n()
  const positive = ['accepted', 'deposit_received', 'in_stock', 'quote_accepted', '已接受', '已收定金', '可售', '已报价'].includes(label)
  return <span className={`badge ${positive ? 'green' : ''}`}>{statusLabel(label)}</span>
}

type FeishuVehicle = {
  recordId: string
  vehicleId: string
  brand: string
  model: string
  year: string
  trim: string
  exteriorColor: string
  interiorColor: string
  stockQuantity: number
  costExw?: number | null
  costFob?: number | null
  costFca?: number | null
  tradeTerm: string
  energyType: string
  batteryKwh?: number | null
  rangeKm?: number | null
  location: string
  supplier: string
  leadTime: string
  status: string
  recorder: string
  publicNotes: string
  isListed: boolean
}

function FeishuVehicleTable({ canSeeCost }: { canSeeCost: boolean }) {
  const { language, statusLabel } = useI18n()
  const [vehicles, setVehicles] = useState<FeishuVehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [modelFilter, setModelFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  async function fetchVehicles() {
    setLoading(true)
    setError('')
    try {
      const data = await api<{ vehicles: FeishuVehicle[] }>('/api/feishu-vehicles')
      setVehicles(data.vehicles)
    } catch (e) {
      setError(getErrorMessage(e, 'Failed to load vehicles'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchVehicles() }, [])

  const models = useMemo(() => [...new Set(vehicles.map((v) => v.model))].filter(Boolean).sort(), [vehicles])
  const statuses = useMemo(() => [...new Set(vehicles.map((v) => v.status))].filter(Boolean).sort(), [vehicles])

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return vehicles.filter((v) => {
      const searchable = [v.vehicleId, v.brand, v.model, v.trim, v.year, v.exteriorColor, v.location, v.supplier].join(' ').toLowerCase()
      return (
        (!keyword || searchable.includes(keyword)) &&
        (!modelFilter || v.model === modelFilter) &&
        (!statusFilter || v.status === statusFilter)
      )
    })
  }, [vehicles, query, modelFilter, statusFilter])

  const totalStock = filtered.reduce((sum, v) => sum + v.stockQuantity, 0)

  if (loading) return <div className="empty-state"><Loader2 className="animate-spin" size={24} /> {language === 'zh' ? '正在从飞书加载车辆数据...' : 'Loading vehicles from Feishu...'}</div>
  if (error) return <div className="empty-state" style={{ color: '#e74c3c' }}>{error}</div>

  return (
    <>
      <div className="inventory-filters">
        <div className="inventory-search">
          <Search size={17} />
          <input onChange={(e) => setQuery(e.target.value)} placeholder={language === 'zh' ? '搜索车型、品牌、颜色、供应商...' : 'Search model, brand, color, supplier...'} value={query} />
        </div>
        <select aria-label="Filter model" onChange={(e) => setModelFilter(e.target.value)} value={modelFilter}>
          <option value="">{language === 'zh' ? '全部车型' : 'All Models'}</option>
          {models.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select aria-label="Filter status" onChange={(e) => setStatusFilter(e.target.value)} value={statusFilter}>
          <option value="">{language === 'zh' ? '全部状态' : 'All Status'}</option>
          {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button className="secondary-button compact-button" onClick={fetchVehicles} type="button">
          <RotateCcw size={15} />
          {language === 'zh' ? '刷新' : 'Refresh'}
        </button>
      </div>
      <div className="inventory-summary">
        <span>{language === 'zh' ? '共' : 'Total'} <strong>{filtered.length}</strong> {language === 'zh' ? '条记录' : 'records'}</span>
        <span>{language === 'zh' ? '总库存' : 'Total Stock'}: <strong>{totalStock}</strong></span>
      </div>
      {filtered.length === 0 ? (
        <EmptyState text={language === 'zh' ? '暂无车辆数据' : 'No vehicles found'} />
      ) : (
        <div className="vehicle-table-wrapper">
          <table className="vehicle-table">
            <thead>
              <tr>
                <th>{language === 'zh' ? '车辆ID' : 'Vehicle ID'}</th>
                <th>{language === 'zh' ? '品牌' : 'Brand'}</th>
                <th>{language === 'zh' ? '车型' : 'Model'}</th>
                <th>{language === 'zh' ? '版本' : 'Trim'}</th>
                <th>{language === 'zh' ? '年份' : 'Year'}</th>
                <th>{language === 'zh' ? '外饰色' : 'Ext. Color'}</th>
                <th>{language === 'zh' ? '库存' : 'Stock'}</th>
                {canSeeCost && <th>{language === 'zh' ? '成本(EXW/FOB/FCA)' : 'Cost (E/F/F)'}</th>}
                <th>{language === 'zh' ? '能源' : 'Energy'}</th>
                <th>{language === 'zh' ? '续航' : 'Range'}</th>
                <th>{language === 'zh' ? '所在地' : 'Location'}</th>
                <th>{language === 'zh' ? '供应商' : 'Supplier'}</th>
                <th>{language === 'zh' ? '交期' : 'Lead Time'}</th>
                <th>{language === 'zh' ? '状态' : 'Status'}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((v) => (
                <tr key={v.recordId}>
                  <td className="vehicle-id-cell">{v.vehicleId}</td>
                  <td>{v.brand}</td>
                  <td><strong>{v.model}</strong></td>
                  <td>{v.trim}</td>
                  <td>{v.year}</td>
                  <td>{v.exteriorColor}</td>
                  <td>{v.stockQuantity}</td>
                  {canSeeCost && (
                    <td className="cost-cell">
                      {v.costExw ? `${formatUsd(v.costExw)}/${v.costFob ? formatUsd(v.costFob) : '-'}/${v.costFca ? formatUsd(v.costFca) : '-'}` : '-'}
                    </td>
                  )}
                  <td>{v.energyType || '-'}</td>
                  <td>{v.rangeKm ? `${v.rangeKm}km` : '-'}</td>
                  <td>{v.location}</td>
                  <td>{v.supplier}</td>
                  <td>{v.leadTime}</td>
                  <td><Badge label={v.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}


export default App
