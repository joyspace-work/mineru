import {
  Bell,
  Boxes,
  Car,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  ClipboardList,
  CreditCard,
  Database,
  Download,
  FileText,
  FileCheck2,
  Eye,
  EyeOff,
  Link2,
  LayoutDashboard,
  LogOut,
  Loader2,
  Menu,
  PackageCheck,
  Pencil,
  Plus,
  Save,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Ship,
  Sparkles,
  Trash2,
  Upload,
  Users,
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
  | 'dashboard'
  | 'profiles'
  | 'vehicles'
  | 'sourceImports'
  | 'quotes'
  | 'orders'
  | 'payments'
  | 'logistics'
  | 'customers'
  | 'staff'
  | 'files'

type User = {
  username: string
  displayName: string
  role: Role
  customerId: string | null
}

type Permissions = {
  canSeeCost: boolean
  canSeeAllCustomers: boolean
  canSeePaymentProof: boolean
  canManageUsers: boolean
  canManageVehicles: boolean
  canAssignInquiries: boolean
  canCreateQuotes: boolean
  canRequestQuote: boolean
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
  canSeePrice: boolean
  visiblePrice: number
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
  permissions: Permissions
  vehicleProfiles: VehicleProfile[]
  vehicles: Vehicle[]
  inquiries: Inquiry[]
  quotes: Quote[]
  quoteRequests: QuoteRequest[]
  orders: Order[]
  logistics: LogisticsStep[]
  notifications: NotificationItem[]
  staffUsers: StaffUser[]
  assignees: StaffUser[]
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
}

type SourceImportRule = {
  id: number
  ruleType: string
  scope: string
  supplierName: string
  sourceKey: string
  sourceValue: string
  targetField: string
  targetValue: string
  metadata: Record<string, unknown>
  confidence: string
  status: string
  usageCount: number
  createdBy: string
  createdAt: string
  updatedAt: string
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
  rules: SourceImportRule[]
  aiStatus: SourceImportAiStatus
  metrics: {
    totalCandidates: number
    needsReview: number
    duplicateRisk: number
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
  { key: 'dashboard', icon: LayoutDashboard, roles: ['admin', 'sales', 'partner', 'customer'] },
  { key: 'profiles', icon: FileText, roles: ['admin', 'sales'] },
  { key: 'vehicles', icon: Car, roles: ['admin', 'sales', 'partner', 'customer'] },
  { key: 'sourceImports', icon: Database, roles: ['admin', 'sales'] },
  { key: 'quotes', icon: ClipboardList, roles: ['admin', 'sales', 'partner', 'customer'] },
  { key: 'orders', icon: PackageCheck, roles: ['admin', 'partner', 'customer'] },
  { key: 'payments', icon: CreditCard, roles: ['admin'] },
  { key: 'logistics', icon: Ship, roles: ['admin', 'partner', 'customer'] },
  { key: 'customers', icon: Users, roles: ['admin'] },
  { key: 'staff', icon: ShieldCheck, roles: ['admin'] },
  { key: 'files', icon: Boxes, roles: ['admin', 'sales', 'partner', 'customer'] },
]

const ACTIVE_NAV_STORAGE_KEY = 'ev-active-nav'

function isNavKey(value: string | null): value is NavKey {
  return Boolean(value && navItems.some((item) => item.key === value))
}

function readStoredNavKey() {
  const stored = window.localStorage.getItem(ACTIVE_NAV_STORAGE_KEY)
  return isNavKey(stored) ? stored : 'dashboard'
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
    sourceImportsSubtitle: 'Convert supplier files into reviewable stock snapshots and reusable matching rules.',
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

function App() {
  const [language, setLanguage] = useState<Language>(() => {
    const saved = window.localStorage.getItem('ev-language')
    return saved === 'en' ? 'en' : 'zh'
  })
  const [data, setData] = useState<AppData | null>(null)
  const [checkingSession, setCheckingSession] = useState(true)
  const [active, setActive] = useState<NavKey>(readStoredNavKey)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
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

  useEffect(() => {
    window.localStorage.setItem('ev-app-sidebar-collapsed', String(appSidebarCollapsed))
  }, [appSidebarCollapsed])

  async function loadData() {
    const appData = await api<AppData>('/api/bootstrap')
    setData(appData)
  }

  useEffect(() => {
    void api<AppData>('/api/bootstrap')
      .then((appData) => setData(appData))
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
      Promise.resolve().then(() => {
        setActive('dashboard')
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
  const title = i18n.t(`nav_${visibleNav.find((item) => item.key === active)?.key ?? 'dashboard'}`)
  const primaryOrder = data.orders[0]

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' })
    setData(null)
    setActive('dashboard')
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
            <div className="searchbox">
              <Search size={16} />
              <input placeholder={i18n.t('searchPlaceholder')} />
            </div>
            <LanguageToggle />
            <button
              aria-label={i18n.t('notifications')}
              className={`icon-button notification-button ${data.notifications.some((notification) => !notification.isRead) ? 'has-unread' : ''}`}
              onClick={() => setNotificationsOpen((value) => !value)}
              type="button"
            >
              <Bell size={18} />
              {data.notifications.filter((notification) => !notification.isRead).length > 0 && (
                <span>{data.notifications.filter((notification) => !notification.isRead).length}</span>
              )}
            </button>
            {notificationsOpen && (
              <div className="notification-panel">
                <header><strong>{i18n.t('notifications')}</strong><span>{data.notifications.length} {i18n.t('pieces')}</span></header>
                {data.notifications.length === 0 ? (
                  <p>{i18n.t('noNotifications')}</p>
                ) : data.notifications.map((notification) => (
                  <button
                    key={notification.id}
                    onClick={() => {
                      if (notification.relatedId) setActive('quotes')
                      setNotificationsOpen(false)
                    }}
                    type="button"
                  >
                    <strong>{notification.title}</strong>
                    <span>{notification.message}</span>
                    <small>{new Date(notification.createdAt).toLocaleString()}</small>
                  </button>
                ))}
              </div>
            )}
          </div>
        </header>

        {active === 'dashboard' && (
          <Dashboard data={data} primaryOrder={primaryOrder} />
        )}
        {active === 'profiles' && (
          <DataPanel title={i18n.t('nav_profiles')} subtitle={i18n.t('profilesSubtitle')}>
            <VehicleProfileLibraryPage
              onChanged={loadData}
              profiles={data.vehicleProfiles}
            />
          </DataPanel>
        )}
        {active === 'vehicles' && (
          <DataPanel title={i18n.t('nav_vehicles')} subtitle={i18n.t('vehiclesSubtitle')}>
            <VehicleTable
              vehicles={data.vehicles}
              vehicleProfiles={data.vehicleProfiles}
              canSeeCost={data.permissions.canSeeCost}
              canRequestQuote={data.permissions.canRequestQuote}
              onCreated={loadData}
            />
          </DataPanel>
        )}
        {active === 'sourceImports' && (
          <DataPanel title={i18n.t('nav_sourceImports')} subtitle={i18n.t('sourceImportsSubtitle')}>
            <SourceImportWorkbench
              currentUser={data.user}
              profiles={data.vehicleProfiles}
              showToast={showToast}
              onChanged={loadData}
            />
          </DataPanel>
        )}
        {active === 'quotes' && (
          <DataPanel title={i18n.t('nav_quotes')} subtitle={i18n.t('quotesSubtitle')}>
            <QuoteRequestBoard
              assignees={data.assignees}
              requests={data.quoteRequests}
              role={data.user.role}
              vehicles={data.vehicles}
              onChanged={loadData}
            />
          </DataPanel>
        )}
        {active === 'orders' && (
          <DataPanel title={i18n.t('nav_orders')} subtitle={data.user.role === 'customer' ? i18n.t('customerOrdersSubtitle') : i18n.t('ordersSubtitle')}>
            {primaryOrder ? (
              <OrderDetail order={primaryOrder} role={data.user.role} />
            ) : (
              <EmptyState text={i18n.t('noVisibleOrders')} />
            )}
          </DataPanel>
        )}
        {active === 'payments' && primaryOrder && (
          <DataPanel title={i18n.t('nav_payments')} subtitle={i18n.t('paymentsSubtitle')}>
            <PaymentBoard order={primaryOrder} showProof={data.permissions.canSeePaymentProof} />
          </DataPanel>
        )}
        {active === 'logistics' && (
          <DataPanel title={i18n.t('nav_logistics')} subtitle={i18n.t('logisticsSubtitle')}>
            <LogisticsTimeline logistics={data.logistics} />
          </DataPanel>
        )}
        {active === 'customers' && (
          <DataPanel title={i18n.t('nav_customers')} subtitle={i18n.t('customersSubtitle')}>
            <div className="placeholder-grid">
              <Metric label={i18n.t('totalCustomers')} value="36" note={language === 'zh' ? '埃塞俄比亚 31，其他 5' : 'Ethiopia 31, others 5'} />
              <Metric label={i18n.t('newThisMonth')} value="9" note={language === 'zh' ? '主要来自 Addis Ababa' : 'Mainly from Addis Ababa'} />
              <Metric label={i18n.t('highIntentCustomers')} value="7" note={language === 'zh' ? '有明确车型和预算' : 'Clear model and budget'} />
            </div>
          </DataPanel>
        )}
        {active === 'staff' && (
          <DataPanel title={i18n.t('nav_staff')} subtitle={i18n.t('staffSubtitle')}>
            <StaffManagement currentUser={data.user} onChanged={loadData} staffUsers={data.staffUsers} />
          </DataPanel>
        )}
        {active === 'files' && (
          <DataPanel title={i18n.t('nav_files')} subtitle={i18n.t('filesSubtitle')}>
            <FileList role={data.user.role} />
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

function StaffManagement({
  currentUser,
  staffUsers,
  onChanged,
}: {
  currentUser: User
  staffUsers: StaffUser[]
  onChanged: () => Promise<void>
}) {
  const { t, roleLabel, formatDateText } = useI18n()
  const [showCreate, setShowCreate] = useState(false)
  const [resetUser, setResetUser] = useState<StaffUser | null>(null)
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [role, setRole] = useState<'admin' | 'sales'>('sales')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  async function createUser(event: FormEvent) {
    event.preventDefault()
    setBusy('create')
    setError('')
    try {
      await api('/api/users', {
        method: 'POST',
        body: JSON.stringify({ username, displayName, role, password }),
      })
      setShowCreate(false)
      setUsername('')
      setDisplayName('')
      setRole('sales')
      setPassword('')
      await onChanged()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '创建账号失败')
    } finally {
      setBusy('')
    }
  }

  async function updateUser(user: StaffUser, changes: Partial<Pick<StaffUser, 'displayName' | 'role' | 'isActive'>>) {
    setBusy(user.username)
    setError('')
    try {
      await api(`/api/users/${user.username}`, {
        method: 'PATCH',
        body: JSON.stringify(changes),
      })
      await onChanged()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '更新账号失败')
    } finally {
      setBusy('')
    }
  }

  async function resetPassword(event: FormEvent) {
    event.preventDefault()
    if (!resetUser) return
    setBusy(`reset-${resetUser.username}`)
    setError('')
    try {
      await api(`/api/users/${resetUser.username}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ password }),
      })
      setResetUser(null)
      setPassword('')
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '重置密码失败')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="staff-management">
      <div className="staff-toolbar">
        <div>
          <strong>{staffUsers.filter((user) => user.isActive).length} {t('activeAccounts')}</strong>
          <span>{t('staffPolicy')}</span>
        </div>
        <button className="primary-button" onClick={() => { setError(''); setShowCreate(true) }} type="button">
          <Plus size={16} />{t('addStaff')}
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="staff-table">
        <div className="staff-table-head">
          <span>{t('staff')}</span><span>{t('role')}</span><span>{t('status')}</span><span>{t('createdAt')}</span><span>{t('actions')}</span>
        </div>
        {staffUsers.map((user) => (
          <div className="staff-table-row" key={user.username}>
            <div><strong>{user.displayName}</strong><span>@{user.username}</span></div>
            <select
              aria-label={`设置 ${user.displayName} 的角色`}
              disabled={busy === user.username}
              onChange={(event) => updateUser(user, { role: event.target.value as 'admin' | 'sales' })}
              value={user.role}
            >
              <option value="sales">{roleLabel('sales')}</option>
              <option value="admin">{roleLabel('admin')}</option>
            </select>
            <Badge label={user.isActive ? 'active' : 'disabled'} />
            <span>{formatDateText(user.createdAt)}</span>
            <div className="staff-actions">
              <button onClick={() => { setPassword(''); setError(''); setResetUser(user) }} type="button">{t('resetPassword')}</button>
              <button
                className={user.isActive ? 'danger-text' : ''}
                disabled={busy === user.username || user.username === currentUser.username}
                onClick={() => updateUser(user, { isActive: !user.isActive })}
                type="button"
              >
                {user.isActive ? t('deactivate') : t('activate')}
              </button>
            </div>
          </div>
        ))}
      </div>

      {(showCreate || resetUser) && (
        <div className="modal-backdrop">
          <form className="quote-form staff-form" onSubmit={showCreate ? createUser : resetPassword}>
            <div className="modal-title">
              <div>
                <strong>{showCreate ? '新增员工账号' : `重置 ${resetUser?.displayName} 的密码`}</strong>
                <span>{showCreate ? '账号创建后即可登录系统。' : '保存后旧密码立即失效。'}</span>
              </div>
              <button onClick={() => { setShowCreate(false); setResetUser(null); setPassword(''); setError('') }} type="button">×</button>
            </div>
            {showCreate && (
              <>
                <div className="form-grid">
                  <label>员工姓名<input onChange={(event) => setDisplayName(event.target.value)} value={displayName} /></label>
                  <label>登录账号<input autoComplete="off" onChange={(event) => setUsername(event.target.value)} placeholder="例如 sales.li" value={username} /></label>
                </div>
                <label>
                  角色
                  <select onChange={(event) => setRole(event.target.value as 'admin' | 'sales')} value={role}>
                    <option value="sales">销售</option>
                    <option value="admin">管理员</option>
                  </select>
                </label>
              </>
            )}
            <label>
              {showCreate ? '初始密码' : '新密码'}
              <div className="password-field">
                <input
                  autoComplete="new-password"
                  minLength={8}
                  onChange={(event) => setPassword(event.target.value)}
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                />
                <button aria-label={showPassword ? '隐藏密码' : '显示密码'} onClick={() => setShowPassword((value) => !value)} type="button">
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </label>
            {error && <p className="form-error">{error}</p>}
            <div className="form-actions">
              <button className="secondary-button" onClick={() => { setShowCreate(false); setResetUser(null); setPassword(''); setError('') }} type="button">取消</button>
              <button className="primary-button" disabled={Boolean(busy)} type="submit">{busy ? '保存中...' : '保存账号'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

function Dashboard({ data, primaryOrder }: { data: AppData; primaryOrder?: Order }) {
  const { t, language } = useI18n()
  const [currentTime] = useState(() => Date.now())
  if (data.user.role === 'sales') {
    const pendingRequests = data.quoteRequests.filter(
      (request) => !['quote_accepted', 'pi_pending', 'pi_confirmed'].includes(request.status),
    )
    const expiringPrices = data.vehicles.filter((vehicle) => {
      if (!vehicle.priceValidUntil) return true
      const remaining = new Date(vehicle.priceValidUntil).getTime() - currentTime
      return remaining <= 3 * 24 * 60 * 60 * 1000
    }).length
    return (
      <section className="content-grid">
        <Metric label={t('assignedQuotes')} value={`${data.quoteRequests.length} ${t('pieces')}`} note={t('assignedQuotesNote')} />
        <Metric label={t('pendingQuotes')} value={`${pendingRequests.length} ${t('pieces')}`} note={t('pendingQuotesNote')} />
        <Metric label={t('vehicleConfigs')} value={`${data.vehicles.length} ${language === 'zh' ? '款' : 'models'}`} note={t('vehicleConfigsNote')} />
        <Metric label={t('pricesToUpdate')} value={`${expiringPrices} ${language === 'zh' ? '款' : 'models'}`} note={t('pricesToUpdateNote')} />
        <section className="panel wide">
          <PanelHeader title={t('myQuotes')} action={t('nav_quotes')} />
          {pendingRequests.length > 0 ? (
            <div className="sales-request-summary">
              {pendingRequests.slice(0, 5).map((request) => (
                <div key={request.id}>
                  <div><strong>{request.requestNo}</strong><span>{request.vehicleModel} · {request.quantity} 台</span></div>
                  <Badge label={request.status} />
                </div>
              ))}
            </div>
          ) : <EmptyState text={language === 'zh' ? '目前没有待处理询价' : 'No pending inquiries'} />}
        </section>
        <section className="panel">
          <PanelHeader title={t('todayFocus')} action={t('nav_vehicles')} />
          <ul className="task-list">
            <li><CheckCircle2 size={18} />{language === 'zh' ? '核对供应商现车数量' : 'Check supplier stock quantities'}</li>
            <li><CheckCircle2 size={18} />{language === 'zh' ? '更新即将到期的合作价' : 'Update expiring cooperation prices'}</li>
            <li><CheckCircle2 size={18} />{language === 'zh' ? '跟进客户修改后的报价' : 'Follow up revised quote requests'}</li>
          </ul>
        </section>
      </section>
    )
  }
  const unpaid = data.orders.reduce((sum, order) => {
    const paid = order.payments.reduce((paymentSum, payment) => paymentSum + payment.amount, 0)
    return sum + Math.max(order.total - paid, 0)
  }, 0)
  return (
    <section className="content-grid">
      <Metric
        label={t('stockResources')}
        value={`${data.vehicles.filter((vehicle) => vehicle.status === 'in_stock').reduce((sum, vehicle) => sum + vehicle.stockQuantity, 0)} ${language === 'zh' ? '台' : 'units'}`}
        note={language === 'zh' ? `共 ${data.vehicles.reduce((sum, vehicle) => sum + vehicle.stockQuantity, 0)} 台可查看` : `${data.vehicles.reduce((sum, vehicle) => sum + vehicle.stockQuantity, 0)} visible units`}
      />
      <Metric
        label={t('pendingQuotes')}
        value={`${data.quoteRequests.filter((request) => !['quote_accepted', 'pi_pending', 'pi_confirmed'].includes(request.status)).length} ${t('pieces')}`}
        note={t('pendingQuotesNote')}
      />
      <Metric label={t('currentOrders')} value={`${data.orders.length} ${language === 'zh' ? '单' : 'orders'}`} note={data.user.role === 'customer' ? (language === 'zh' ? '仅显示本人订单' : 'Only your orders') : (language === 'zh' ? '包含管理范围内订单' : 'Orders within your scope')} />
      <Metric label={t('unpaidAmount')} value={formatUsd(unpaid)} note={language === 'zh' ? '根据当前可见订单计算' : 'Calculated from visible orders'} />
      <section className="panel wide">
        <PanelHeader title={t('keyOrders')} action={language === 'zh' ? '查看全部' : 'View all'} />
        {primaryOrder ? <OrderDetail order={primaryOrder} role={data.user.role} /> : <EmptyState text={t('noOrders')} />}
      </section>
      <section className="panel">
        <PanelHeader title={t('todoItems')} action={language === 'zh' ? '新增任务' : 'Add task'} />
        <ul className="task-list">
          <li><CheckCircle2 size={18} />{language === 'zh' ? '确认最新车辆库存与价格有效期' : 'Confirm latest vehicle stock and price validity'}</li>
          <li><CheckCircle2 size={18} />{language === 'zh' ? '检查订单付款与出口节点' : 'Check order payments and export steps'}</li>
          <li><CheckCircle2 size={18} />{language === 'zh' ? '补充相关车辆及单据文件' : 'Add related vehicle and document files'}</li>
        </ul>
      </section>
    </section>
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
  onChanged,
}: {
  currentUser: User
  profiles: VehicleProfile[]
  showToast: (text: string, type?: 'success' | 'info' | 'error' | 'warning') => void
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
    } catch (e: any) {
      showToast(e.message || '编辑失败', 'error')
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
    } catch (e: any) {
      showToast(e.message || '删除失败', 'error')
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
      setError(uploadError instanceof Error ? uploadError.message : '导入失败')
    } finally {
      setBusy(false)
    }
  }

  async function downloadExport(batchId: number) {
    const response = await fetch(`/api/source-imports/batches/${batchId}/export`)
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: '导出失败' }))
      throw new Error(body.error || '导出失败')
    }
    const blob = await response.blob()
    const disposition = response.headers.get('Content-Disposition') ?? ''
    const match = disposition.match(/filename\*=UTF-8''([^;]+)/)
    const filename = match ? decodeURIComponent(match[1]) : `source-import-${batchId}.xlsx`
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    window.URL.revokeObjectURL(url)
    await loadList()
  }

  async function resolveDuplicate(duplicateId: number, resolution: 'same_origin' | 'not_duplicate' | 'defer') {
    await api(`/api/source-imports/duplicates/${duplicateId}`, {
      method: 'PATCH',
      body: JSON.stringify({ resolution }),
    })
    if (selectedBatchId) await loadBatch(selectedBatchId)
    await loadList()
  }

  const filteredCandidates = useMemo(() => {
    const candidates = detail?.candidates ?? []
    if (candidateFilter === 'all') return candidates
    if (candidateFilter === 'issues') return candidates.filter((candidate) => candidate.issueTags.length > 0)
    if (candidateFilter === 'duplicates') return candidates.filter((candidate) => candidate.issueTags.includes('duplicate_risk'))
    if (candidateFilter === 'missing') return candidates.filter((candidate) => candidate.changeStatus === 'missing_from_latest_snapshot')
    return candidates.filter((candidate) => candidate.reviewStatus === candidateFilter)
  }, [detail, candidateFilter])

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
            <button className="supplier-add-button" onClick={() => setShowSupplierForm(true)} type="button">
              <Plus size={15} />
              新增
            </button>
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
          <span>{files.length > 0 ? `${files.length} 个文件已选择` : '选择 Excel、TXT、图片、PDF、PPT 等供应商文件'}</span>
          <input
            multiple
            onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
            type="file"
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
                <button onClick={() => void downloadExport(detail.batch.id)} type="button">
                  <Download size={16} />
                  导出飞书 Excel
                </button>
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
                    <span>价格</span>
                    <span>币种</span>
                    <span>贸易条款</span>
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
                      <strong>{candidate.supplierPrice > 0 ? candidate.supplierPrice : '待确认'}</strong>
                      <span>{candidate.currency || '-'}</span>
                      <span>{candidate.tradeTerm || '-'}</span>
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
                          <small>匹配历史候选 #{duplicate.matchedCandidateId} · {statusLabel(duplicate.status)} {duplicate.resolution && `· ${duplicate.resolution}`}</small>
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
                <section className="rules-panel">
                  <header>
                    <strong><Database size={16} /> 已沉淀规则</strong>
                    <span>{list?.rules.length ?? 0} 条</span>
                  </header>
                  {list?.rules.slice(0, 10).map((rule) => (
                    <div key={rule.id}>
                      <strong>{rule.sourceValue || rule.sourceKey}</strong>
                      <span>{rule.ruleType} · {rule.scope === 'supplier' ? rule.supplierName : '全局'} → {rule.targetField}: {rule.targetValue}</span>
                    </div>
                  ))}
                  {list?.rules.length === 0 && <p>人工确认和修正后，系统会在这里自动沉淀规则。</p>}
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
}: {
  candidate: SourceImportCandidate | null
  profiles: VehicleProfile[]
  onSaved: (candidate: SourceImportCandidate) => Promise<void>
  onClose?: () => void
}) {
  const { statusLabel } = useI18n()
  const [draft, setDraft] = useState<SourceImportCandidate | null>(candidate)
  const [saveRuleScope, setSaveRuleScope] = useState<'none' | 'supplier' | 'global'>('supplier')
  const [busy, setBusy] = useState(false)
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [error, setError] = useState('')

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
          saveRuleScope,
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
        <label>价格<input min="0" onChange={(event) => update('supplierPrice', Number(event.target.value))} type="number" value={draft.supplierPrice} /></label>
        <label>币种<select onChange={(event) => update('currency', event.target.value)} value={draft.currency}><option value="">待确认</option><option>USD</option><option>CNY</option></select></label>
        <label>贸易条款<select onChange={(event) => update('tradeTerm', event.target.value)} value={draft.tradeTerm}><option value="">待确认</option><option>EXW</option><option>FCA</option><option>FOB</option><option>CNF</option><option>CIF</option></select></label>
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
          <div className="rule-save-mode">
            <span>本次修正如何沉淀</span>
            <select onChange={(event) => setSaveRuleScope(event.target.value as 'none' | 'supplier' | 'global')} value={saveRuleScope}>
              <option value="none">仅修改本次</option>
              <option value="supplier">保存为该供应商规则</option>
              <option value="global">保存为全局规则</option>
            </select>
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
              {pendingAction === 'approved' ? '确认中...' : '确认入库候选'}
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

function VehicleTable({
  vehicles,
  vehicleProfiles,
  canSeeCost,
  canRequestQuote,
  onCreated,
}: {
  vehicles: Vehicle[]
  vehicleProfiles: VehicleProfile[]
  canSeeCost: boolean
  canRequestQuote: boolean
  onCreated: () => Promise<void>
}) {
  const { language, statusLabel } = useI18n()
  const [inquiryMode, setInquiryMode] = useState(false)
  const [basket, setBasket] = useState<QuoteBasketItem[]>([])
  const [pendingVehicle, setPendingVehicle] = useState<Vehicle | null>(null)
  const [showBasket, setShowBasket] = useState(false)
  const [query, setQuery] = useState('')
  const [model, setModel] = useState('')
  const [trim, setTrim] = useState('')
  const [color, setColor] = useState('')
  const [status, setStatus] = useState('')
  const [expandedModels, setExpandedModels] = useState<string[]>([])
  const [expandedVersions, setExpandedVersions] = useState<string[]>([])
  const [showVehicleForm, setShowVehicleForm] = useState(false)
  const [showProfileManager, setShowProfileManager] = useState(false)
  const [profileDetail, setProfileDetail] = useState<VehicleProfile | null>(null)
  const [sourceVehicle, setSourceVehicle] = useState<Vehicle | null>(null)
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null)
  const [priceVehicle, setPriceVehicle] = useState<Vehicle | null>(null)
  const [editingSource, setEditingSource] = useState<{ vehicle: Vehicle; source: SupplierSource } | null>(null)

  const options = useMemo(
    () => ({
      models: [...new Set(vehicles.map((vehicle) => vehicle.model))].sort(),
      trims: [...new Set(vehicles.map((vehicle) => vehicle.trim))].sort(),
      colors: [...new Set(vehicles.map((vehicle) => vehicle.color))].sort(),
      statuses: [...new Set(vehicles.map((vehicle) => vehicle.isListed ? vehicle.status : 'delisted'))].sort(),
    }),
    [vehicles],
  )

  const filteredVehicles = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase()
    return vehicles.filter((vehicle) => {
      const searchable = [
        vehicle.id,
        vehicle.model,
        vehicle.trim,
        vehicle.year,
        vehicle.color,
        vehicle.location,
        vehicle.vin,
      ].join(' ').toLocaleLowerCase()
      return (
        (!keyword || searchable.includes(keyword)) &&
        (!model || vehicle.model === model) &&
        (!trim || vehicle.trim === trim) &&
        (!color || vehicle.color === color) &&
        (!status || (vehicle.isListed ? vehicle.status : 'delisted') === status)
      )
    })
  }, [vehicles, query, model, trim, color, status])

  const filteredStock = filteredVehicles.reduce(
    (sum, vehicle) => sum + vehicle.stockQuantity,
    0,
  )
  const vehicleGroups = useMemo(() => {
    const groups = new Map<string, Vehicle[]>()
    for (const vehicle of filteredVehicles) {
      groups.set(vehicle.model, [...(groups.get(vehicle.model) ?? []), vehicle])
    }
    return [...groups.entries()].map(([modelName, variants]) => ({
      modelName,
      variants,
      stockQuantity: variants.filter((variant) => variant.isListed).reduce((sum, variant) => sum + variant.stockQuantity, 0),
      startingPrice: Math.min(...(variants.some((variant) => variant.isListed) ? variants.filter((variant) => variant.isListed) : variants).map((variant) => variant.visiblePrice)),
      canSeePrice: variants.some((variant) => variant.canSeePrice),
      hasCurrentPrice: variants.some((variant) => variant.isListed && variant.isPriceValid),
    }))
  }, [filteredVehicles])

  function resetFilters() {
    setQuery('')
    setModel('')
    setTrim('')
    setColor('')
    setStatus('')
  }

  function toggleVehicle(vehicle: Vehicle, checked: boolean) {
    if (checked) {
      setPendingVehicle(vehicle)
      return
    }
    setBasket((current) => current.filter((item) => item.vehicle.id !== vehicle.id))
  }

  function cancelInquiryMode() {
    if (basket.length > 0 && !window.confirm('取消后将清空已选择的车辆，确定继续吗？')) {
      return
    }
    setBasket([])
    setPendingVehicle(null)
    setShowBasket(false)
    setInquiryMode(false)
  }

  return (
    <>
      {canSeeCost && (
        <div className="vehicle-admin-bar">
          <div>
            <strong>管理员录入</strong>
            <span>先建立车型库资料，再从车型库选择并添加供应商车源。</span>
          </div>
          <div className="vehicle-admin-actions">
            <button className="secondary-button compact-button" onClick={() => setShowProfileManager(true)} type="button">
              <FileText size={17} />
              车型库管理
            </button>
            <button onClick={() => setShowVehicleForm(true)} type="button">
              <Plus size={17} />
              新增车源配置
            </button>
          </div>
        </div>
      )}
      {canRequestQuote && (
        <div className="inventory-mode-bar">
          <div>
            <strong>{inquiryMode ? '询价选择模式' : '库存浏览模式'}</strong>
            <span>{inquiryMode ? '勾选车辆并填写每款询价数量' : '搜索、筛选并查看当前库存信息'}</span>
          </div>
          {inquiryMode ? (
            <button className="secondary-button compact-button" onClick={cancelInquiryMode} type="button">
              取消询价
            </button>
          ) : (
            <button className="start-inquiry-button" onClick={() => {
              setInquiryMode(true)
              setExpandedModels(vehicleGroups.map((group) => group.modelName))
            }} type="button">
              <ClipboardList size={17} />
              发起询价
            </button>
          )}
        </div>
      )}
      <div className="inventory-filters">
        <div className="inventory-search">
          <Search size={17} />
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索车型、版本、颜色、VIN 或库存编号"
            value={query}
          />
        </div>
        <select aria-label="筛选车型" onChange={(event) => setModel(event.target.value)} value={model}>
          <option value="">全部车型</option>
          {options.models.map((option) => <option key={option}>{option}</option>)}
        </select>
        <select aria-label="筛选版本" onChange={(event) => setTrim(event.target.value)} value={trim}>
          <option value="">全部版本</option>
          {options.trims.map((option) => <option key={option}>{option}</option>)}
        </select>
        <select aria-label="筛选颜色" onChange={(event) => setColor(event.target.value)} value={color}>
          <option value="">全部颜色</option>
          {options.colors.map((option) => <option key={option}>{option}</option>)}
        </select>
        <select aria-label="筛选状态" onChange={(event) => setStatus(event.target.value)} value={status}>
          <option value="">{language === 'zh' ? '全部状态' : 'All statuses'}</option>
          {options.statuses.map((option) => <option key={option} value={option}>{statusLabel(option)}</option>)}
        </select>
        <button className="reset-filter" onClick={resetFilters} title="清除筛选" type="button">
          <RotateCcw size={16} />
          重置
        </button>
      </div>
      <div className="inventory-result">
        <span>找到 {vehicleGroups.length} 个车型集合，{filteredVehicles.length} 个配置版本</span>
        <strong>合计 {filteredStock} 台</strong>
      </div>
      <div className="resource-groups">
        {vehicleGroups.map((group) => {
          const isExpanded = expandedModels.includes(group.modelName)
          return (
            <section className="resource-group" key={group.modelName}>
              <button
                className="resource-group-summary"
                onClick={() => setExpandedModels((current) => current.includes(group.modelName) ? current.filter((name) => name !== group.modelName) : [...current, group.modelName])}
                type="button"
              >
                {isExpanded ? <ChevronDown size={19} /> : <ChevronRight size={19} />}
                <div><strong>{group.modelName}</strong><span>{group.variants.length} 个配置版本</span></div>
                <div><span>现车</span><strong>{group.stockQuantity} 台</strong></div>
                <div><span>价格</span><strong className={group.hasCurrentPrice ? 'price-current' : 'price-expired'}>{group.canSeePrice ? `${formatUsd(group.startingPrice)} 起` : '询价后报价'}</strong></div>
                <span className="expand-label">{isExpanded ? '收起版本' : '查看版本'}</span>
              </button>
              {isExpanded && (
                <div className="resource-variants">
                  {group.variants.map((vehicle) => {
                    const versionExpanded = expandedVersions.includes(vehicle.id)
                    const isSelected = basket.some((item) => item.vehicle.id === vehicle.id)
                    const needsSourceCompletion = canSeeCost && (!vehicle.supplierSources || vehicle.supplierSources.length === 0 || !vehicle.cost)
                    return (
                      <article className={`resource-variant ${vehicle.isListed ? '' : 'unlisted'}`} key={vehicle.id}>
                        <div className="variant-main-row">
                          {canRequestQuote && inquiryMode && (
                            <input
                              aria-label={`选择 ${vehicle.model} ${vehicle.trim}`}
                              checked={isSelected}
                              onChange={(event) => toggleVehicle(vehicle, event.target.checked)}
                              type="checkbox"
                            />
                          )}
                          <button
                            className="variant-expand"
                            onClick={() => setExpandedVersions((current) => current.includes(vehicle.id) ? current.filter((id) => id !== vehicle.id) : [...current, vehicle.id])}
                            type="button"
                          >
                            {versionExpanded ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
                            <div>
                              <strong>{vehicle.year} · {vehicle.trim}</strong>
                              <span>{vehicle.rangeKm}KM · {vehicle.batteryCapacity}</span>
                              {needsSourceCompletion && <small className="source-required-label">待补录供应商车源</small>}
                            </div>
                          </button>
                          <div><span>供应状态</span><Badge label={vehicle.isListed ? vehicle.status : 'delisted'} /></div>
                          <div><span>现车</span><strong>{vehicle.stockQuantity} 台</strong></div>
                          <div><span>预订周期</span><strong>{vehicle.preorderMinDays > 0 ? `${vehicle.preorderMinDays}-${vehicle.preorderMaxDays} 天` : '待确认'}</strong></div>
                          <div>
                            <span>{vehicle.priceLabel}</span>
                            <strong className={vehicle.isPriceValid ? 'price-current' : 'price-expired'}>{vehicle.canSeePrice ? formatUsd(vehicle.visiblePrice) : '询价后报价'}</strong>
                            {vehicle.canSeePrice && <small>{vehicle.isPriceValid ? `有效至 ${formatDate(vehicle.priceValidUntil)}` : `已于 ${formatDate(vehicle.priceValidUntil)} 过期`}</small>}
                          </div>
                        </div>
                        {versionExpanded && (
                          <VehicleResourceDetails
                            canSeeCost={canSeeCost}
                            onAddSource={() => setSourceVehicle(vehicle)}
                            onEditSource={(source) => setEditingSource({ vehicle, source })}
                            onEditVehicle={() => setEditingVehicle(vehicle)}
                            onViewProfile={() => setProfileDetail(vehicle.profile)}
                            onListingChanged={async () => {
                              await api(`/api/vehicles/${vehicle.id}/listing`, {
                                method: 'PATCH',
                                body: JSON.stringify({ isListed: !vehicle.isListed }),
                              })
                              await onCreated()
                            }}
                            onRemoveSource={async (source) => {
                              if (!window.confirm(`确定删除供应商车源“${source.supplierName}”吗？`)) return
                              await api(`/api/vehicles/${vehicle.id}/supplier-sources/${source.id}`, { method: 'DELETE' })
                              await onCreated()
                            }}
                            onUpdatePrice={() => setPriceVehicle(vehicle)}
                            vehicle={vehicle}
                          />
                        )}
                      </article>
                    )
                  })}
                </div>
              )}
            </section>
          )
        })}
      </div>
      {filteredVehicles.length === 0 && <div className="inventory-empty">没有符合当前条件的车辆</div>}
      {canRequestQuote && inquiryMode && basket.length > 0 && (
        <div className="quote-basket-bar">
          <div>
            <strong>已选择 {basket.length} 款，共 {basket.reduce((sum, item) => sum + item.quantity, 0)} 台</strong>
            <span>{basket.map((item) => `${item.vehicle.model} × ${item.quantity}`).join('、')}</span>
          </div>
          <button onClick={() => setShowBasket(true)} type="button"><Send size={16} />查看询价清单</button>
        </div>
      )}
      {pendingVehicle && (
        <QuoteItemDialog
          onCancel={() => setPendingVehicle(null)}
          onConfirm={(quantity) => {
            setBasket((current) => [
              ...current.filter((item) => item.vehicle.id !== pendingVehicle.id),
              { vehicle: pendingVehicle, quantity },
            ])
            setPendingVehicle(null)
          }}
          vehicle={pendingVehicle}
        />
      )}
      {showBasket && (
        <QuoteRequestForm
          items={basket}
          onClose={() => setShowBasket(false)}
          onCreated={async () => {
            setBasket([])
            setShowBasket(false)
            setInquiryMode(false)
            await onCreated()
          }}
          onRemove={(vehicleId) => {
            setBasket((current) => current.filter((item) => item.vehicle.id !== vehicleId))
            if (basket.length === 1) setShowBasket(false)
          }}
        />
      )}
      {showVehicleForm && (
        <VehicleForm
          onClose={() => setShowVehicleForm(false)}
          onCreated={async () => {
            setShowVehicleForm(false)
            await onCreated()
          }}
          profiles={vehicleProfiles}
        />
      )}
      {editingVehicle && (
        <VehicleForm
          onClose={() => setEditingVehicle(null)}
          onCreated={async () => {
            setEditingVehicle(null)
            await onCreated()
          }}
          profiles={vehicleProfiles}
          vehicle={editingVehicle}
        />
      )}
      {showProfileManager && (
        <VehicleProfileManager
          onChanged={onCreated}
          onClose={() => setShowProfileManager(false)}
          profiles={vehicleProfiles}
        />
      )}
      {profileDetail && (
        <VehicleProfileDetail
          onClose={() => setProfileDetail(null)}
          profile={profileDetail}
        />
      )}
      {priceVehicle && (
        <VehiclePriceForm
          onClose={() => setPriceVehicle(null)}
          onCreated={async () => {
            setPriceVehicle(null)
            await onCreated()
          }}
          vehicle={priceVehicle}
        />
      )}
      {sourceVehicle && (
        <SupplierSourceForm
          onClose={() => setSourceVehicle(null)}
          onCreated={async () => {
            setSourceVehicle(null)
            await onCreated()
          }}
          vehicle={sourceVehicle}
        />
      )}
      {editingSource && (
        <SupplierSourceForm
          onClose={() => setEditingSource(null)}
          onCreated={async () => {
            setEditingSource(null)
            await onCreated()
          }}
          source={editingSource.source}
          vehicle={editingSource.vehicle}
        />
      )}
    </>
  )
}

function VehicleResourceDetails({
  vehicle,
  canSeeCost,
  onAddSource,
  onEditVehicle,
  onViewProfile,
  onUpdatePrice,
  onListingChanged,
  onEditSource,
  onRemoveSource,
}: {
  vehicle: Vehicle
  canSeeCost: boolean
  onAddSource: () => void
  onEditVehicle: () => void
  onViewProfile: () => void
  onUpdatePrice: () => void
  onListingChanged: () => Promise<void>
  onEditSource: (source: SupplierSource) => void
  onRemoveSource: (source: SupplierSource) => Promise<void>
}) {
  const needsSourceCompletion = canSeeCost && (!vehicle.supplierSources || vehicle.supplierSources.length === 0 || !vehicle.cost)

  return (
    <div className="vehicle-resource-details">
      {canSeeCost && (
        <div className="vehicle-management-actions">
          <button onClick={onEditVehicle} type="button"><Pencil size={15} />编辑车型资料</button>
          <button disabled={!vehicle.profile} onClick={onViewProfile} type="button"><FileText size={15} />查看参数</button>
          <button onClick={onUpdatePrice} type="button"><CreditCard size={15} />手动调整合作价</button>
          <button className={vehicle.isListed ? 'danger-outline' : ''} onClick={onListingChanged} type="button">
            {vehicle.isListed ? <EyeOff size={15} /> : <Eye size={15} />}
            {vehicle.isListed ? '下架配置' : '恢复上架'}
          </button>
        </div>
      )}
      {needsSourceCompletion && (
        <div className="source-required-alert">
          <div>
            <strong>需要补录供应商车源</strong>
            <span>这条旧库存缺少供应商报价明细，系统暂时无法按“供应商报价 + 100 USD”自动重算合作价。</span>
          </div>
          <button onClick={onAddSource} type="button"><Plus size={15} />补录供应商车源</button>
        </div>
      )}
      {!canSeeCost && vehicle.profile && (
        <div className="vehicle-management-actions public-actions">
          <button onClick={onViewProfile} type="button"><FileText size={15} />查看车辆参数</button>
        </div>
      )}
      {(vehicle.imageUrl || vehicle.publicNotes) && (
        <div className="vehicle-public-profile">
          {vehicle.imageUrl && <img alt={`${vehicle.model} ${vehicle.trim}`} src={vehicle.imageUrl} />}
          {vehicle.publicNotes && <div><span>车辆说明</span><p>{vehicle.publicNotes}</p></div>}
        </div>
      )}
      <div className="resource-specs">
        <div><span>能源类型</span><strong>{vehicle.energyType || '待补充'}</strong></div>
        <div><span>电池容量</span><strong>{vehicle.batteryCapacity || '待补充'}</strong></div>
        <div><span>续航</span><strong>{vehicle.rangeKm ? `${vehicle.rangeKm} KM` : '待补充'}</strong></div>
        <div><span>驱动方式</span><strong>{vehicle.drivetrain || '待补充'}</strong></div>
        <div><span>价格更新时间</span><strong>{formatDate(vehicle.priceUpdatedAt)}</strong></div>
        {canSeeCost && <div><span>内部采购成本</span><strong className="sensitive">{formatUsd(vehicle.cost ?? 0)}</strong></div>}
      </div>
      <div className="color-details">
        <div>
          <span>可选颜色</span>
          <div className="color-tags">{vehicle.availableColors.map((color) => <span key={color}>{color}</span>)}</div>
        </div>
        <div>
          <span>现车颜色</span>
          <div className="color-tags stock">{vehicle.stockColors.length > 0 ? vehicle.stockColors.map((entry) => <span key={entry.color}>{entry.color} {entry.quantity} 台</span>) : <span>暂无现车</span>}</div>
        </div>
      </div>
      {canSeeCost && (
        <div className="supplier-source-section">
          <div className="supplier-source-title">
            <div><strong>供应商车源明细</strong><span>内部车源录入人员可见，合作价按供应商报价自动生成</span></div>
            <button onClick={onAddSource} type="button"><Plus size={15} />添加供应商车源</button>
          </div>
          {vehicle.supplierSources && vehicle.supplierSources.length > 0 ? (
            <div className="supplier-source-table">
              <div className="supplier-source-head"><span>供应商</span><span>现车</span><span>颜色数量</span><span>预订周期</span><span>供应商价格</span><span>更新时间</span><span>操作</span></div>
              {vehicle.supplierSources.map((source) => (
                <div className="supplier-source-row" key={source.id}>
                  <div><strong>{source.supplierName}</strong><small>{source.notes}</small></div>
                  <span>{source.stockQuantity} 台</span>
                  <span>{source.stockColors.map((entry) => `${entry.color} ${entry.quantity} 台`).join('；') || '无'}</span>
                  <span>{source.canPreorder ? `${source.preorderMinDays}-${source.preorderMaxDays} 天` : '不可预订'}</span>
                  <strong className="sensitive">{formatUsd(source.supplierPrice)}</strong>
                  <span>{formatDate(source.updatedAt)}<small>录入：{source.createdBy}<br />更新：{source.updatedBy}</small></span>
                  <div className="source-row-actions">
                    <button aria-label={`编辑 ${source.supplierName}`} onClick={() => onEditSource(source)} title="编辑车源" type="button"><Pencil size={15} /></button>
                    <button aria-label={`删除 ${source.supplierName}`} onClick={() => onRemoveSource(source)} title="删除车源" type="button"><Trash2 size={15} /></button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="supplier-source-empty">
              尚未录入供应商车源。请补录供应商名称、供应商报价、颜色数量和预订周期；保存后系统会自动生成合作价。
            </div>
          )}
        </div>
      )}
      {canSeeCost && vehicle.priceHistory && vehicle.priceHistory.length > 0 && (
        <div className="price-history-section">
          <strong>合作价历史</strong>
          <div className="price-history-list">
            {vehicle.priceHistory.map((entry) => (
              <div key={entry.id}>
                <strong>{formatUsd(entry.partnerPrice)}</strong>
                <span>{formatDate(entry.validFrom)} 至 {formatDate(entry.validUntil)}</span>
                <small>{entry.notes || `由 ${entry.changedBy} 更新`}</small>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function VehicleForm({
  onClose,
  onCreated,
  profiles,
  vehicle,
}: {
  onClose: () => void
  onCreated: () => Promise<void>
  profiles: VehicleProfile[]
  vehicle?: Vehicle
}) {
  const { language } = useI18n()
  const initialProfileId = vehicle?.profileId ? String(vehicle.profileId) : profiles[0] ? String(profiles[0].id) : ''
  const initialProfile = profiles.find((profile) => String(profile.id) === initialProfileId)
  const [profileSearch, setProfileSearch] = useState('')
  const [availabilityMode, setAvailabilityMode] = useState('in_stock')
  const [form, setForm] = useState({
    profileId: initialProfileId,
    model: vehicle?.model ?? (initialProfile ? `${initialProfile.brand} ${initialProfile.model}` : ''),
    trim: vehicle?.trim ?? initialProfile?.trim ?? '',
    year: vehicle?.year ?? initialProfile?.year ?? String(new Date().getFullYear()),
    energyType: vehicle?.energyType ?? initialProfile?.energyType ?? '纯电',
    rangeKm: vehicle?.rangeKm ? String(vehicle.rangeKm) : initialProfile?.rangeKm ? String(initialProfile.rangeKm) : '',
    batteryCapacity: vehicle?.batteryCapacity ?? initialProfile?.batteryCapacity ?? '',
    drivetrain: vehicle?.drivetrain ?? initialProfile?.drivetrain ?? '前驱',
    availableColors: vehicle?.availableColors.join('、') ?? '',
    imageUrl: vehicle?.imageUrl ?? '',
    publicNotes: vehicle?.publicNotes ?? '',
  })
  const [supplierName, setSupplierName] = useState('')
  const [supplierPrice, setSupplierPrice] = useState('')
  const [preorderMinDays, setPreorderMinDays] = useState('7')
  const [preorderMaxDays, setPreorderMaxDays] = useState('14')
  const [stockColors, setStockColors] = useState([{ color: '', quantity: 0 }])
  const [sourceNotes, setSourceNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const selectedProfile = profiles.find((profile) => String(profile.id) === form.profileId)
  const filteredProfiles = useMemo(() => {
    const keyword = profileSearch.trim().toLocaleLowerCase()
    if (!keyword) return profiles.slice(0, 80)
    return profiles.filter((profile) => [
      profile.brand,
      profile.model,
      profile.year,
      profile.trim,
      profile.energyType,
      profile.drivetrain,
    ].join(' ').toLocaleLowerCase().includes(keyword)).slice(0, 80)
  }, [profileSearch, profiles])

  function update(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const hasStock = availabilityMode === 'in_stock' || availabilityMode === 'stock_and_preorder'
    const acceptsPreorder = availabilityMode === 'preorder' || availabilityMode === 'stock_and_preorder'
    const normalizedStockColors = hasStock
      ? stockColors.filter((entry) => entry.color.trim() && entry.quantity > 0)
      : []
    try {
      await api(vehicle ? `/api/vehicles/${vehicle.id}` : '/api/vehicles', {
        method: vehicle ? 'PATCH' : 'POST',
        body: JSON.stringify({
          ...form,
          profileId: Number(form.profileId),
          rangeKm: Number(form.rangeKm),
          availableColors: vehicle
            ? form.availableColors.split(/[,，、]/).map((color) => color.trim()).filter(Boolean)
            : normalizedStockColors.map((entry) => entry.color),
          initialSource: vehicle ? undefined : {
            supplierName,
            supplierPrice: Number(supplierPrice),
            canPreorder: acceptsPreorder,
            preorderMinDays: acceptsPreorder ? Number(preorderMinDays) : 0,
            preorderMaxDays: acceptsPreorder ? Number(preorderMaxDays) : 0,
            stockColors: normalizedStockColors,
            notes: sourceNotes,
          },
        }),
      })
      await onCreated()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '新增失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop">
      <form className="quote-form vehicle-entry-form" onSubmit={submit}>
        <div className="modal-title">
          <div><p className="eyebrow">车源资料管理</p><h2>{vehicle ? '编辑车源配置' : '新增车源'}</h2><span>{vehicle ? '只维护展示资料，供应商明细请在车源详情中编辑' : '从车型库选择车型，然后录入供应商可供货信息'}</span></div>
          <button aria-label="关闭" onClick={onClose} type="button">×</button>
        </div>
        {!vehicle ? (
          <>
            <div className="form-section-label">选择车型</div>
            <label className="form-grid-full">搜索车型库
              <input
                onChange={(event) => setProfileSearch(event.target.value)}
                placeholder="输入品牌、车型、年款或版本，例如 比亚迪、零跑、C11"
                value={profileSearch}
              />
            </label>
            <label className="form-grid-full">选择车型库
              <select onChange={(event) => {
                const profile = profiles.find((item) => String(item.id) === event.target.value)
                setForm((current) => ({
                  ...current,
                  profileId: event.target.value,
                  model: profile ? `${profile.brand} ${profile.model}` : '',
                  trim: profile?.trim ?? '',
                  year: profile?.year ?? '',
                  energyType: profile?.energyType ?? '纯电',
                  rangeKm: profile?.rangeKm ? String(profile.rangeKm) : '',
                  batteryCapacity: profile?.batteryCapacity ?? '',
                  drivetrain: profile?.drivetrain ?? '前驱',
                }))
              }} required value={form.profileId}>
                <option value="">请选择车型库资料</option>
                {filteredProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>{displayModelName(profile, language)} · {profile.year} · {displayTrimName(profile.trim, language)}</option>
                ))}
              </select>
              <small>{profileSearch ? `匹配 ${filteredProfiles.length} 条车型资料` : `显示前 ${filteredProfiles.length} 条，可输入关键词缩小范围`}</small>
            </label>
            {selectedProfile && (
              <div className="selected-profile-summary">
                <strong>{displayModelName(selectedProfile, language)}</strong>
                <span>{selectedProfile.year} · {displayTrimName(selectedProfile.trim, language)}</span>
              </div>
            )}
            <div className="form-section-label">供应商车源</div>
            <div className="form-grid">
              <label>供应商名称<input onChange={(event) => setSupplierName(event.target.value)} placeholder="例如 A供应商 / XX车行" required value={supplierName} /></label>
              <label>供应商报价（USD）<input min="1" onChange={(event) => setSupplierPrice(event.target.value)} placeholder="内部采购/供应价" required type="number" value={supplierPrice} /></label>
              <div className="calculated-price-preview">
                <span>自动合作价</span>
                <strong>{supplierPrice ? formatUsd(Number(supplierPrice) + 100) : '录入后自动生成'}</strong>
              </div>
              <label>供货类型
                <select onChange={(event) => setAvailabilityMode(event.target.value)} value={availabilityMode}>
                  <option value="in_stock">现车</option>
                  <option value="preorder">可预订</option>
                  <option value="stock_and_preorder">现车 + 可预订</option>
                  <option value="unavailable">暂时缺货</option>
                </select>
              </label>
            </div>
            {(availabilityMode === 'in_stock' || availabilityMode === 'stock_and_preorder') && (
              <div className="source-stock-section">
                <div className="form-section-label subtle-label">现车颜色与数量</div>
                {stockColors.map((entry, index) => (
                  <div className="stock-color-entry" key={index}>
                    <input
                      aria-label={`现车颜色 ${index + 1}`}
                      onChange={(event) => setStockColors((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, color: event.target.value } : item))}
                      placeholder="颜色"
                      value={entry.color}
                    />
                    <input
                      aria-label={`现车数量 ${index + 1}`}
                      min="0"
                      onChange={(event) => setStockColors((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: Number(event.target.value) } : item))}
                      type="number"
                      value={entry.quantity}
                    />
                    <button
                      aria-label={`删除现车颜色 ${index + 1}`}
                      disabled={stockColors.length === 1}
                      onClick={() => setStockColors((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                      type="button"
                    >×</button>
                  </div>
                ))}
                <button className="add-stock-color" onClick={() => setStockColors((current) => [...current, { color: '', quantity: 0 }])} type="button"><Plus size={15} />增加颜色</button>
              </div>
            )}
            {(availabilityMode === 'preorder' || availabilityMode === 'stock_and_preorder') && (
              <div className="form-grid">
                <label>最快预订周期（天）<input min="1" onChange={(event) => setPreorderMinDays(event.target.value)} required type="number" value={preorderMinDays} /></label>
                <label>最长预订周期（天）<input min={preorderMinDays || '1'} onChange={(event) => setPreorderMaxDays(event.target.value)} required type="number" value={preorderMaxDays} /></label>
              </div>
            )}
            <label>内部车源备注<textarea onChange={(event) => setSourceNotes(event.target.value)} placeholder="例如价格已确认、可锁车、需二次确认颜色" value={sourceNotes} /></label>
            <div className="entry-form-note">这里只录入供应商供货信息；续航、电池、尺寸、配置等车型参数统一在车型库维护。</div>
          </>
        ) : (
          <>
            <div className="form-section-label">展示资料</div>
            <div className="form-grid">
              <label>完整车型名称<input onChange={(event) => update('model', event.target.value)} required value={form.model} /></label>
              <label>配置版本<input onChange={(event) => update('trim', event.target.value)} required value={form.trim} /></label>
              <label>年款<input onChange={(event) => update('year', event.target.value)} required value={form.year} /></label>
              <label>能源类型<select onChange={(event) => update('energyType', event.target.value)} value={form.energyType}><option>纯电</option><option>插电混动</option><option>增程</option></select></label>
              <label>驱动方式<select onChange={(event) => update('drivetrain', event.target.value)} value={form.drivetrain}><option>前驱</option><option>后驱</option><option>四驱</option></select></label>
              <label>续航里程（KM）<input min="0" onChange={(event) => update('rangeKm', event.target.value)} type="number" value={form.rangeKm} /></label>
              <label>电池容量<input onChange={(event) => update('batteryCapacity', event.target.value)} placeholder="例如 87 kWh" value={form.batteryCapacity} /></label>
              <label>车辆图片地址<input onChange={(event) => update('imageUrl', event.target.value)} placeholder="可选，https://..." type="url" value={form.imageUrl} /></label>
            </div>
            <label>可选颜色<input onChange={(event) => update('availableColors', event.target.value)} placeholder="冰川蓝、雪域白、曜石黑" value={form.availableColors} /></label>
            <label>公开备注<textarea onChange={(event) => update('publicNotes', event.target.value)} placeholder="例如支持批量预订、可提供随车充电设备" value={form.publicNotes} /></label>
            <div className="entry-form-note">修改展示资料不会覆盖历史询价和报价中的快照。合作价请使用单独的“更新合作价”操作。</div>
          </>
        )}
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions">
          <button className="secondary-button" onClick={onClose} type="button">取消</button>
          <button className="primary-button" disabled={busy} type="submit">{busy ? '保存中...' : vehicle ? '保存修改' : '保存车型配置'}</button>
        </div>
      </form>
    </div>
  )
}

const emptyProfileForm = {
  brand: '',
  model: '',
  year: String(new Date().getFullYear()),
  trim: '',
  energyType: '纯电',
  batteryCapacity: '',
  rangeKm: '',
  drivetrain: '',
  bodyType: '',
  dimensions: '',
  wheelbase: '',
  motorPower: '',
  seats: '',
  fastChargeTime: '',
  slowChargeTime: '',
  officialPrice: '',
  features: '',
  sourceUrl: '',
  notes: '',
}

function VehicleProfileManager({
  profiles,
  onClose,
  onChanged,
}: {
  profiles: VehicleProfile[]
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const { language, specValueLabel } = useI18n()
  const [editingProfile, setEditingProfile] = useState<VehicleProfile | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [csv, setCsv] = useState('品牌,车型,年款,配置版本,能源类型,电池容量,续航里程,驱动方式,车身结构,长宽高,轴距,电机功率,座位数,快充时间,慢充时间,官方指导价,主要配置,资料来源,备注\n')
  const [importResult, setImportResult] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function importCsv() {
    setBusy(true)
    setError('')
    setImportResult('')
    try {
      const result = await api<{ imported: number; updated: number; errors: string[] }>('/api/vehicle-profiles/import', {
        method: 'POST',
        body: JSON.stringify({ csv }),
      })
      setImportResult(`新增 ${result.imported} 条，更新 ${result.updated} 条${result.errors.length ? `，错误：${result.errors.join('；')}` : ''}`)
      await onChanged()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '导入失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="quote-form profile-library-modal">
        <div className="modal-title">
          <div><p className="eyebrow">车型资料库</p><h2>车型库管理</h2><span>先维护车型参数，再从车型库创建供应商车源。</span></div>
          <button aria-label="关闭" onClick={onClose} type="button">×</button>
        </div>
        <div className="vehicle-profile-toolbar">
          <button className="primary-button" onClick={() => { setEditingProfile(null); setShowForm(true) }} type="button"><Plus size={16} />新增车型资料</button>
          <span>当前 {profiles.length} 条车型资料</span>
        </div>
        <div className="vehicle-profile-list">
          {profiles.map((profile) => (
            <button key={profile.id} onClick={() => { setEditingProfile(profile); setShowForm(true) }} type="button">
              <strong>{displayModelName(profile, language)}</strong>
              <span>{profile.year} · {displayTrimName(profile.trim, language)}</span>
              <small>{profile.energyType ? specValueLabel(profile.energyType) : (language === 'zh' ? '能源待补充' : 'Energy type pending')} · {profile.rangeKm ? `${profile.rangeKm} KM` : (language === 'zh' ? '续航待补充' : 'Range pending')}</small>
            </button>
          ))}
          {profiles.length === 0 && <div className="inventory-empty">还没有车型资料，请先新增或导入。</div>}
        </div>
        <div className="csv-import-box">
          <strong>CSV 导入</strong>
          <span>Excel 可另存为 CSV 后复制内容到这里。支持表头：品牌、车型、年款、配置版本、续航里程、电池容量等。</span>
          <textarea onChange={(event) => setCsv(event.target.value)} value={csv} />
          {error && <p className="form-error">{error}</p>}
          {importResult && <p className="form-success">{importResult}</p>}
          <button className="secondary-button" disabled={busy} onClick={importCsv} type="button">{busy ? '导入中...' : '导入 CSV'}</button>
        </div>
        {showForm && (
          <VehicleProfileForm
            onChanged={async () => {
              setShowForm(false)
              setEditingProfile(null)
              await onChanged()
            }}
            onClose={() => {
              setShowForm(false)
              setEditingProfile(null)
            }}
            profile={editingProfile ?? undefined}
          />
        )}
      </div>
    </div>
  )
}

function VehicleProfileLibraryPage({
  profiles,
  onChanged,
}: {
  profiles: VehicleProfile[]
  onChanged: () => Promise<void>
}) {
  const { language, specGroupLabel, specNameLabel, specValueLabel } = useI18n()
  const [query, setQuery] = useState('')
  const [selectedKey, setSelectedKey] = useState('')
  const [editingProfile, setEditingProfile] = useState<VehicleProfile | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [csv, setCsv] = useState('品牌,车型,年款,配置版本,能源类型,电池容量,续航里程,驱动方式,车身结构,长宽高,轴距,电机功率,座位数,快充时间,慢充时间,官方指导价,主要配置,资料来源,备注\n')
  const [importResult, setImportResult] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const groups = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    const grouped = new Map<string, VehicleProfile[]>()
    for (const profile of profiles) {
      const key = `${profile.brand} ${profile.model}`
      const text = `${profile.brand} ${profile.model} ${profile.year} ${profile.trim}`.toLowerCase()
      if (keyword && !text.includes(keyword)) continue
      grouped.set(key, [...(grouped.get(key) ?? []), profile])
    }
    return [...grouped.entries()]
      .map(([key, items]) => ({
        key,
        brand: items[0]?.brand ?? '',
        model: items[0]?.model ?? '',
        profiles: items.sort((a, b) => `${b.year} ${b.trim}`.localeCompare(`${a.year} ${a.trim}`)),
      }))
      .sort((a, b) => a.key.localeCompare(b.key))
  }, [profiles, query])

  const selectedGroup = groups.find((group) => group.key === selectedKey) ?? groups[0] ?? null
  const comparedProfiles = useMemo(() => selectedGroup?.profiles ?? [], [selectedGroup])
  const comparisonRows = useMemo(() => buildProfileComparisonRows(comparedProfiles), [comparedProfiles])

  async function importCsv() {
    setBusy(true)
    setError('')
    setImportResult('')
    try {
      const result = await api<{ imported: number; updated: number; errors: string[] }>('/api/vehicle-profiles/import', {
        method: 'POST',
        body: JSON.stringify({ csv }),
      })
      setImportResult(`新增 ${result.imported} 条，更新 ${result.updated} 条${result.errors.length ? `，错误：${result.errors.join('；')}` : ''}`)
      await onChanged()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '导入失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`profile-library-page ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <aside className="profile-library-sidebar">
        <button className="profile-sidebar-toggle" onClick={() => setSidebarCollapsed(true)} type="button">
          {language === 'zh' ? '收起列表' : 'Collapse List'}
          <ChevronRight size={15} />
        </button>
        <div className="profile-library-actions">
          <button className="primary-button" onClick={() => { setEditingProfile(null); setShowForm(true) }} type="button"><Plus size={16} />{language === 'zh' ? '新增车型' : 'Add Model'}</button>
          <button className="secondary-button compact-button" onClick={() => setShowImport((value) => !value)} type="button"><FileText size={16} />{language === 'zh' ? 'CSV 导入' : 'Import CSV'}</button>
        </div>
        <label className="inventory-search">
          <Search size={17} />
          <input onChange={(event) => setQuery(event.target.value)} placeholder={language === 'zh' ? '搜索品牌、车型、版本' : 'Search brand, model, trim'} value={query} />
        </label>
        <div className="profile-model-list">
          {groups.map((group) => (
            <button className={selectedGroup?.key === group.key ? 'active' : ''} key={group.key} onClick={() => setSelectedKey(group.key)} type="button">
              <strong>{displayModelName(group, language)}</strong>
              <span>{group.profiles.length} {language === 'zh' ? '个年款/版本' : 'model years / trims'}</span>
            </button>
          ))}
          {groups.length === 0 && <div className="inventory-empty">{language === 'zh' ? '没有找到车型资料' : 'No model profiles found'}</div>}
        </div>
        {showImport && (
          <div className="csv-import-box page-import">
            <strong>{language === 'zh' ? 'CSV 导入' : 'CSV Import'}</strong>
            <span>{language === 'zh' ? 'Excel 可另存为 CSV 后复制内容到这里。字段支持品牌、车型、年款、配置版本、续航里程、电池容量等。' : 'Save Excel as CSV and paste it here. Supported columns include brand, model, year, trim, range, battery capacity, etc.'}</span>
            <textarea onChange={(event) => setCsv(event.target.value)} value={csv} />
            {error && <p className="form-error">{error}</p>}
            {importResult && <p className="form-success">{importResult}</p>}
            <button className="secondary-button" disabled={busy} onClick={importCsv} type="button">{busy ? (language === 'zh' ? '导入中...' : 'Importing...') : (language === 'zh' ? '导入 CSV' : 'Import CSV')}</button>
          </div>
        )}
      </aside>

      <section className="profile-comparison-panel">
        {selectedGroup ? (
          <>
            <div className="profile-comparison-header">
              <div>
                <p className="eyebrow">{language === 'zh' ? '车型参数对比' : 'Model Specification Comparison'}</p>
                <h2>{displayModelName(selectedGroup, language)}</h2>
                <span>{comparedProfiles.length} {language === 'zh' ? '个年款/版本' : 'model years / trims'}，{comparisonRows.length} {language === 'zh' ? '个参数项' : 'spec items'}</span>
              </div>
              {sidebarCollapsed && (
                <button className="profile-sidebar-restore" onClick={() => setSidebarCollapsed(false)} type="button">
                  <ChevronRight size={15} />
                  {language === 'zh' ? '展开车型列表' : 'Show Model List'}
                </button>
              )}
            </div>
            <div className="profile-version-strip">
              {comparedProfiles.map((profile) => (
                <button key={profile.id} onClick={() => { setEditingProfile(profile); setShowForm(true) }} type="button">
                  <strong>{profile.year}</strong>
                  <span>{displayTrimName(profile.trim, language)}</span>
                  <small>{language === 'zh' ? '编辑资料' : 'Edit'}</small>
                </button>
              ))}
            </div>
            <div className="profile-comparison-table-wrap">
              <table className="profile-comparison-table">
                <thead>
                  <tr>
                    <th>{language === 'zh' ? '参数类别' : 'Category'}</th>
                    <th>{language === 'zh' ? '参数名称' : 'Specification'}</th>
                    {comparedProfiles.map((profile) => (
                      <th key={profile.id}>{profile.year}<br /><span>{displayTrimName(profile.trim, language)}</span></th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {comparisonRows.map((row) => (
                    <tr key={`${row.groupName}-${row.name}`}>
                      <td>{specGroupLabel(row.groupName)}</td>
                      <td>{specNameLabel(row.name)}</td>
                      {comparedProfiles.map((profile) => (
                        <td key={profile.id}>{row.values[profile.id] ? specValueLabel(row.values[profile.id]) : '-'}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="profile-source-list page-sources">
              {[...new Map(comparedProfiles.flatMap((profile) => profile.specs).filter((spec) => !hiddenSpecGroups.has(spec.groupName) && (spec.sourceName || spec.sourceUrl)).map((spec) => [`${spec.sourceName}|${spec.sourceUrl}`, spec])).values()].map((source) => (
                source.sourceUrl
                  ? <a className="profile-source-link" href={source.sourceUrl} key={`${source.sourceName}-${source.sourceUrl}`} rel="noreferrer" target="_blank">{source.sourceName || source.sourceUrl}</a>
                  : <span key={source.sourceName}>{source.sourceName}</span>
              ))}
            </div>
          </>
        ) : (
          <EmptyState text={language === 'zh' ? '还没有车型资料，请先新增或导入。' : 'No model profiles yet. Add or import profiles first.'} />
        )}
      </section>

      {showForm && (
        <VehicleProfileForm
          onChanged={async () => {
            setShowForm(false)
            setEditingProfile(null)
            await onChanged()
          }}
          onClose={() => {
            setShowForm(false)
            setEditingProfile(null)
          }}
          profile={editingProfile ?? undefined}
        />
      )}
    </div>
  )
}

function buildProfileComparisonRows(profiles: VehicleProfile[]) {
  const rowMap = new Map<string, { groupName: string; name: string; sortOrder: number; values: Record<number, string> }>()
  for (const profile of profiles) {
    for (const spec of profile.specs) {
      if (hiddenSpecGroups.has(spec.groupName)) continue
      const key = `${spec.groupName}|||${spec.name}`
      const row = rowMap.get(key) ?? {
        groupName: spec.groupName,
        name: spec.name,
        sortOrder: spec.sortOrder,
        values: {},
      }
      row.sortOrder = Math.min(row.sortOrder, spec.sortOrder)
      row.values[profile.id] = spec.value
      rowMap.set(key, row)
    }
  }
  return [...rowMap.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.groupName.localeCompare(b.groupName) || a.name.localeCompare(b.name))
}

function VehicleProfileForm({
  profile,
  onClose,
  onChanged,
}: {
  profile?: VehicleProfile
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const [form, setForm] = useState({
    ...emptyProfileForm,
    ...(profile ? {
      brand: profile.brand,
      model: profile.model,
      year: profile.year,
      trim: profile.trim,
      energyType: profile.energyType,
      batteryCapacity: profile.batteryCapacity,
      rangeKm: profile.rangeKm ? String(profile.rangeKm) : '',
      drivetrain: profile.drivetrain,
      bodyType: profile.bodyType,
      dimensions: profile.dimensions,
      wheelbase: profile.wheelbase,
      motorPower: profile.motorPower,
      seats: profile.seats,
      fastChargeTime: profile.fastChargeTime,
      slowChargeTime: profile.slowChargeTime,
      officialPrice: profile.officialPrice,
      features: profile.features,
      sourceUrl: profile.sourceUrl,
      notes: profile.notes,
    } : {}),
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function update(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api(profile ? `/api/vehicle-profiles/${profile.id}` : '/api/vehicle-profiles', {
        method: profile ? 'PATCH' : 'POST',
        body: JSON.stringify({ ...form, rangeKm: Number(form.rangeKm) }),
      })
      await onChanged()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="nested-modal">
      <form className="quote-form profile-entry-form" onSubmit={submit}>
        <div className="modal-title">
          <div><p className="eyebrow">车型参数</p><h2>{profile ? '编辑车型资料' : '新增车型资料'}</h2></div>
          <button aria-label="关闭" onClick={onClose} type="button">×</button>
        </div>
        <div className="form-grid">
          <label>品牌<input onChange={(event) => update('brand', event.target.value)} required value={form.brand} /></label>
          <label>车型<input onChange={(event) => update('model', event.target.value)} required value={form.model} /></label>
          <label>年款<input onChange={(event) => update('year', event.target.value)} required value={form.year} /></label>
          <label>配置版本<input onChange={(event) => update('trim', event.target.value)} required value={form.trim} /></label>
          <label>能源类型<input onChange={(event) => update('energyType', event.target.value)} value={form.energyType} /></label>
          <label>电池容量<input onChange={(event) => update('batteryCapacity', event.target.value)} value={form.batteryCapacity} /></label>
          <label>续航里程（KM）<input min="0" onChange={(event) => update('rangeKm', event.target.value)} type="number" value={form.rangeKm} /></label>
          <label>驱动方式<input onChange={(event) => update('drivetrain', event.target.value)} value={form.drivetrain} /></label>
          <label>车身结构<input onChange={(event) => update('bodyType', event.target.value)} value={form.bodyType} /></label>
          <label>长宽高<input onChange={(event) => update('dimensions', event.target.value)} value={form.dimensions} /></label>
          <label>轴距<input onChange={(event) => update('wheelbase', event.target.value)} value={form.wheelbase} /></label>
          <label>电机功率<input onChange={(event) => update('motorPower', event.target.value)} value={form.motorPower} /></label>
          <label>座位数<input onChange={(event) => update('seats', event.target.value)} value={form.seats} /></label>
          <label>快充时间<input onChange={(event) => update('fastChargeTime', event.target.value)} value={form.fastChargeTime} /></label>
          <label>慢充时间<input onChange={(event) => update('slowChargeTime', event.target.value)} value={form.slowChargeTime} /></label>
          <label>官方指导价<input onChange={(event) => update('officialPrice', event.target.value)} value={form.officialPrice} /></label>
        </div>
        <label>主要配置<textarea onChange={(event) => update('features', event.target.value)} value={form.features} /></label>
        <label>资料来源<input onChange={(event) => update('sourceUrl', event.target.value)} placeholder="公开资料链接，可选" value={form.sourceUrl} /></label>
        <label>备注<textarea onChange={(event) => update('notes', event.target.value)} value={form.notes} /></label>
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions">
          <button className="secondary-button" onClick={onClose} type="button">取消</button>
          <button className="primary-button" disabled={busy} type="submit">{busy ? '保存中...' : '保存车型资料'}</button>
        </div>
      </form>
    </div>
  )
}

function VehicleProfileDetail({ profile, onClose }: { profile: VehicleProfile; onClose: () => void }) {
  const { language, specGroupLabel, specNameLabel, specValueLabel } = useI18n()
  const groupedSpecs = profile.specs.reduce<Record<string, VehicleProfileSpec[]>>((groups, spec) => {
    if (hiddenSpecGroups.has(spec.groupName)) return groups
    groups[spec.groupName] = [...(groups[spec.groupName] ?? []), spec]
    return groups
  }, {})
  const specSources = [
    ...new Map(
      profile.specs
        .filter((spec) => !hiddenSpecGroups.has(spec.groupName) && (spec.sourceName || spec.sourceUrl))
        .map((spec) => [`${spec.sourceName}|${spec.sourceUrl}`, spec]),
    ).values(),
  ]
  const specs = [
    ['品牌', translateSpecValue(profile.brand, language)],
    ['车型', displayModelName(profile, language)],
    ['年款', profile.year],
    ['配置版本', displayTrimName(profile.trim, language)],
    ['能源类型', profile.energyType],
    ['电池容量', profile.batteryCapacity],
    ['续航里程', profile.rangeKm ? `${profile.rangeKm} KM` : '待补充'],
    ['驱动方式', profile.drivetrain],
    ['车身结构', profile.bodyType],
    ['长宽高', profile.dimensions],
    ['轴距', profile.wheelbase],
    ['电机功率', profile.motorPower],
    ['座位数', profile.seats],
    ['快充时间', profile.fastChargeTime],
    ['慢充时间', profile.slowChargeTime],
    ['官方指导价', profile.officialPrice],
  ]
  return (
    <div className="modal-backdrop">
      <div className="quote-form profile-detail-modal">
        <div className="modal-title">
          <div><p className="eyebrow">{language === 'zh' ? '车辆参数' : 'Vehicle Specifications'}</p><h2>{displayModelName(profile, language)}</h2><span>{profile.year} · {displayTrimName(profile.trim, language)}</span></div>
          <button aria-label="关闭" onClick={onClose} type="button">×</button>
        </div>
        <div className="resource-specs profile-specs">
          {specs.map(([label, value]) => (
            <div key={label}><span>{specNameLabel(label)}</span><strong>{value ? specValueLabel(String(value)) : (language === 'zh' ? '待补充' : 'To be completed')}</strong></div>
          ))}
        </div>
        {Object.entries(groupedSpecs).length > 0 && (
          <div className="profile-spec-groups">
            {Object.entries(groupedSpecs).map(([groupName, groupSpecs]) => (
              <section key={groupName}>
                <h3>{specGroupLabel(groupName)}</h3>
                <div className="profile-spec-table">
                  {groupSpecs.map((spec) => (
                    <div key={spec.id}>
                      <span>{specNameLabel(spec.name)}</span>
                      <strong>{specValueLabel(spec.value)}</strong>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
        {profile.features && <div className="profile-text-block"><strong>{language === 'zh' ? '主要配置' : 'Key Features'}</strong><p>{specValueLabel(profile.features)}</p></div>}
        {profile.notes && <div className="profile-text-block"><strong>{language === 'zh' ? '备注' : 'Notes'}</strong><p>{specValueLabel(profile.notes)}</p></div>}
        {(profile.sourceUrl || specSources.length > 0) && (
          <div className="profile-text-block">
            <strong>{language === 'zh' ? '资料来源' : 'Sources'}</strong>
            <div className="profile-source-list">
              {profile.sourceUrl && <a className="profile-source-link" href={profile.sourceUrl} rel="noreferrer" target="_blank">车型资料来源</a>}
              {specSources.map((source) => (
                source.sourceUrl
                  ? <a className="profile-source-link" href={source.sourceUrl} key={`${source.sourceName}-${source.sourceUrl}`} rel="noreferrer" target="_blank">{source.sourceName || source.sourceUrl}</a>
                  : <span key={source.sourceName}>{source.sourceName}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function VehiclePriceForm({
  vehicle,
  onClose,
  onCreated,
}: {
  vehicle: Vehicle
  onClose: () => void
  onCreated: () => Promise<void>
}) {
  const [partnerPrice, setPartnerPrice] = useState(String(vehicle.visiblePrice))
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api(`/api/vehicles/${vehicle.id}/prices`, {
        method: 'POST',
        body: JSON.stringify({ partnerPrice: Number(partnerPrice), notes }),
      })
      await onCreated()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '价格更新失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop">
      <form className="quote-form price-entry-form" onSubmit={submit}>
        <div className="modal-title">
          <div><p className="eyebrow">价格维护</p><h2>更新基础合作价</h2><span>{vehicle.model} · {vehicle.trim}</span></div>
          <button aria-label="关闭" onClick={onClose} type="button">×</button>
        </div>
        <div className="price-snapshot">
          <span>当前合作价</span><strong>{formatUsd(vehicle.visiblePrice)}</strong>
          <small>{vehicle.isPriceValid ? `有效至 ${formatDate(vehicle.priceValidUntil)}` : '当前价格已过期'}</small>
        </div>
        <label>新合作价（USD）<input min="1" onChange={(event) => setPartnerPrice(event.target.value)} required type="number" value={partnerPrice} /></label>
        <label>更新说明<textarea onChange={(event) => setNotes(event.target.value)} placeholder="例如供应商调价、批量价格更新" value={notes} /></label>
        <div className="entry-form-note">保存后立即生效，有效期自动设置为14天；旧价格继续保留在历史记录中。</div>
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions">
          <button className="secondary-button" onClick={onClose} type="button">取消</button>
          <button className="primary-button" disabled={busy} type="submit">{busy ? '更新中...' : '确认更新价格'}</button>
        </div>
      </form>
    </div>
  )
}

function SupplierSourceForm({
  vehicle,
  onClose,
  onCreated,
  source,
}: {
  vehicle: Vehicle
  onClose: () => void
  onCreated: () => Promise<void>
  source?: SupplierSource
}) {
  const [supplierName, setSupplierName] = useState(source?.supplierName ?? '')
  const [supplierPrice, setSupplierPrice] = useState(source ? String(source.supplierPrice) : '')
  const [canPreorder, setCanPreorder] = useState(source?.canPreorder ?? true)
  const [preorderMinDays, setPreorderMinDays] = useState(source ? String(source.preorderMinDays) : '7')
  const [preorderMaxDays, setPreorderMaxDays] = useState(source ? String(source.preorderMaxDays) : '14')
  const [stockColors, setStockColors] = useState(
    source?.stockColors.length
      ? source.stockColors.map((entry) => ({ color: entry.color, quantity: entry.quantity }))
      : [{ color: '', quantity: 1 }],
  )
  const [notes, setNotes] = useState(source?.notes ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api(`/api/vehicles/${vehicle.id}/supplier-sources${source ? `/${source.id}` : ''}`, {
        method: source ? 'PATCH' : 'POST',
        body: JSON.stringify({
          supplierName,
          supplierPrice: Number(supplierPrice),
          canPreorder,
          preorderMinDays: Number(preorderMinDays),
          preorderMaxDays: Number(preorderMaxDays),
          stockColors: stockColors.filter((entry) => entry.color.trim() && entry.quantity > 0),
          notes,
        }),
      })
      await onCreated()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '添加失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop">
      <form className="quote-form supplier-entry-form" onSubmit={submit}>
        <div className="modal-title">
          <div><p className="eyebrow">内部供应商资料</p><h2>{source ? '编辑供应商车源' : '添加供应商车源'}</h2><span>{vehicle.model} · {vehicle.trim}</span></div>
          <button aria-label="关闭" onClick={onClose} type="button">×</button>
        </div>
        <div className="form-grid">
          <label>供应商名称<input onChange={(event) => setSupplierName(event.target.value)} required value={supplierName} /></label>
          <label>供应商报价（USD）<input min="1" onChange={(event) => setSupplierPrice(event.target.value)} required type="number" value={supplierPrice} /></label>
        </div>
        <div className="source-stock-section">
          <div className="form-section-label">现车颜色与数量</div>
          {stockColors.map((entry, index) => (
            <div className="stock-color-entry" key={index}>
              <input
                aria-label={`现车颜色 ${index + 1}`}
                onChange={(event) => setStockColors((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, color: event.target.value } : item))}
                placeholder="颜色，没有现车可留空"
                value={entry.color}
              />
              <input
                aria-label={`现车数量 ${index + 1}`}
                min="1"
                onChange={(event) => setStockColors((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: Number(event.target.value) } : item))}
                type="number"
                value={entry.quantity}
              />
              <button
                aria-label={`删除现车颜色 ${index + 1}`}
                disabled={stockColors.length === 1}
                onClick={() => setStockColors((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                type="button"
              >×</button>
            </div>
          ))}
          <button className="add-stock-color" onClick={() => setStockColors((current) => [...current, { color: '', quantity: 1 }])} type="button"><Plus size={15} />增加颜色</button>
        </div>
        <label className="preorder-toggle"><input checked={canPreorder} onChange={(event) => setCanPreorder(event.target.checked)} type="checkbox" /><span><strong>该供应商接受预订</strong><small>关闭后，这条车源只统计现车，不参与预订周期汇总</small></span></label>
        {canPreorder && (
          <div className="form-grid">
            <label>最快预订周期（天）<input min="1" onChange={(event) => setPreorderMinDays(event.target.value)} required type="number" value={preorderMinDays} /></label>
            <label>最长预订周期（天）<input min={preorderMinDays || '1'} onChange={(event) => setPreorderMaxDays(event.target.value)} required type="number" value={preorderMaxDays} /></label>
          </div>
        )}
        <label>内部备注<textarea onChange={(event) => setNotes(event.target.value)} placeholder="例如现车信息已确认、价格需再次确认" value={notes} /></label>
        <div className="entry-form-note">只需要录入已知的颜色和数量；保存后系统会自动汇总现车数量、颜色和预订周期。</div>
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions">
          <button className="secondary-button" onClick={onClose} type="button">取消</button>
          <button className="primary-button" disabled={busy} type="submit">{busy ? '保存中...' : source ? '保存车源修改' : '添加车源'}</button>
        </div>
      </form>
    </div>
  )
}

function QuoteItemDialog({
  vehicle,
  onCancel,
  onConfirm,
}: {
  vehicle: Vehicle
  onCancel: () => void
  onConfirm: (quantity: number) => void
}) {
  const [quantity, setQuantity] = useState(1)
  return (
    <div className="modal-backdrop">
      <div className="quantity-dialog">
        <div className="modal-title">
          <div><p className="eyebrow">加入询价清单</p><h2>{vehicle.model}</h2><span>{vehicle.trim} · {vehicle.color}</span></div>
          <button aria-label="关闭" onClick={onCancel} type="button">×</button>
        </div>
        <div className="price-snapshot">
          <span>{vehicle.priceLabel}</span><strong>{vehicle.canSeePrice ? formatUsd(vehicle.visiblePrice) : '待报价'}</strong>
          <small>
            {vehicle.stockQuantity > 0
              ? `当前现车 ${vehicle.stockQuantity} 台，询价数量可超过现车数量`
              : vehicle.status === 'preorder'
                ? `当前无现车，可按计划采购数量询价`
                : `当前暂时缺货，仍可提交需求由管理员确认价格和交期`}
          </small>
        </div>
        <label>询价数量<input min="1" onChange={(event) => setQuantity(Number(event.target.value))} type="number" value={quantity} /></label>
        {quantity > vehicle.stockQuantity && vehicle.stockQuantity > 0 && (
          <div className="quantity-availability-note">
            现车可覆盖 {vehicle.stockQuantity} 台，其余 {quantity - vehicle.stockQuantity} 台需要确认预订价格和交期。
          </div>
        )}
        <div className="form-actions">
          <button className="secondary-button" onClick={onCancel} type="button">取消</button>
          <button className="primary-button" disabled={!Number.isInteger(quantity) || quantity < 1} onClick={() => onConfirm(quantity)} type="button">加入清单</button>
        </div>
      </div>
    </div>
  )
}

function QuoteRequestForm({
  items,
  onClose,
  onCreated,
  onRemove,
}: {
  items: QuoteBasketItem[]
  onClose: () => void
  onCreated: () => Promise<void>
  onRemove: (vehicleId: string) => void
}) {
  const [destinationPort, setDestinationPort] = useState('Djibouti')
  const [tradeTerm, setTradeTerm] = useState('CIF')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      await api('/api/quote-requests', {
        method: 'POST',
        body: JSON.stringify({
          items: items.map((item) => ({
            vehicleId: item.vehicle.id,
            quantity: item.quantity,
          })),
          destinationPort,
          tradeTerm,
          notes,
        }),
      })
      await onCreated()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '提交失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-backdrop">
      <form className="quote-form" onSubmit={submit}>
        <div className="modal-title">
          <div><p className="eyebrow">批量报价申请</p><h2>{items.length} 款车辆 · {items.reduce((sum, item) => sum + item.quantity, 0)} 台</h2></div>
          <button aria-label="关闭" onClick={onClose} type="button">×</button>
        </div>
        <div className="basket-items">
          {items.map((item) => (
            <div className="basket-item" key={item.vehicle.id}>
              <div><strong>{item.vehicle.model}</strong><span>{item.vehicle.trim} · {item.vehicle.color}</span></div>
              <div>
                <span>{item.vehicle.canSeePrice ? `${item.quantity} 台 × ${formatUsd(item.vehicle.visiblePrice)}` : `${item.quantity} 台 · 询价后报价`}</span>
                <strong>{item.vehicle.canSeePrice ? formatUsd(item.vehicle.visiblePrice * item.quantity) : '待报价'}</strong>
              </div>
              <button aria-label={`移除 ${item.vehicle.model}`} onClick={() => onRemove(item.vehicle.id)} type="button">×</button>
            </div>
          ))}
        </div>
        <div className="form-grid">
          <label>目的港<input onChange={(event) => setDestinationPort(event.target.value)} value={destinationPort} /></label>
          <label>贸易条款<select onChange={(event) => setTradeTerm(event.target.value)} value={tradeTerm}><option>CIF</option><option>FOB</option><option>CNF</option><option>EXW</option></select></label>
        </div>
        <label>其他要求<textarea onChange={(event) => setNotes(event.target.value)} placeholder="颜色、配置、交期或随车配件" value={notes} /></label>
        <div className="quote-preview">
          基础合作价小计 <strong>{items.every((item) => item.vehicle.canSeePrice) ? formatUsd(items.reduce((sum, item) => sum + item.vehicle.visiblePrice * item.quantity, 0)) : '待报价'}</strong>
          <span>最终报价由管理员设置 FOB费用、CIF费用、融资费用和利润后发布</span>
        </div>
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions">
          <button className="secondary-button" onClick={onClose} type="button">取消</button>
          <button className="primary-button" disabled={submitting} type="submit">{submitting ? '提交中...' : '提交报价申请'}</button>
        </div>
      </form>
    </div>
  )
}

function QuoteRequestBoard({
  assignees,
  requests,
  role,
  vehicles,
  onChanged,
}: {
  assignees: StaffUser[]
  requests: QuoteRequest[]
  role: Role
  vehicles: Vehicle[]
  onChanged: () => Promise<void>
}) {
  const { language, statusLabel } = useI18n()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState(ALL_STATUSES)
  const filteredRequests = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase()
    return requests.filter((request) => {
      const matchesStatus = statusFilter === ALL_STATUSES || request.status === statusFilter
      const searchableText = [
        request.requestNo,
        request.destinationPort,
        request.tradeTerm,
        request.notes,
        ...request.items.flatMap((item) => [
          item.vehicleModel,
          item.vehicleTrim,
          item.vehicleColor,
        ]),
      ].join(' ').toLowerCase()
      return matchesStatus && (!keyword || searchableText.includes(keyword))
    })
  }, [requests, searchTerm, statusFilter])
  const requestStatuses = [...new Set(requests.map((request) => request.status))].sort()

  if (requests.length === 0) return <EmptyState text="还没有报价申请，请从库存车辆发起。" />
  const selected = selectedId === null
    ? null
    : requests.find((request) => request.id === selectedId) ?? null

  if (selected) {
    return (
      <div className="request-detail-page">
        <button className="back-to-list" onClick={() => setSelectedId(null)} type="button">← 返回询价列表</button>
        <QuoteRequestCard assignees={assignees} onChanged={onChanged} request={selected} role={role} vehicles={vehicles} />
      </div>
    )
  }

  return (
    <div className="request-index-page">
      <div className="request-index-tools">
        <label className="request-search">
          <Search size={17} />
          <input
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="搜索车型、版本、询价编号或目的港"
            value={searchTerm}
          />
        </label>
        <select
          aria-label="筛选询价状态"
          onChange={(event) => setStatusFilter(event.target.value)}
          value={statusFilter}
        >
          <option value={ALL_STATUSES}>{language === 'zh' ? '全部状态' : 'All statuses'}</option>
          {requestStatuses.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
        </select>
        <span className="request-result-count">共 {filteredRequests.length} 笔询价</span>
      </div>
      <div className="request-index">
        <div className="request-index-head">
          <span>车辆询价摘要</span><span>交付条件</span><span>最新报价</span><span>当前状态</span><span>更新时间</span><span />
        </div>
        {filteredRequests.map((request) => {
          const firstItem = request.items[0]
          const vehicleTitle = firstItem
            ? `${firstItem.vehicleModel} · ${firstItem.vehicleTrim}${request.items.length > 1 ? ` 等 ${request.items.length} 款` : ''}`
            : request.vehicleModel
          const itemSummary = request.items
            .map((item) => `${item.vehicleModel} × ${item.quantity}`)
            .join(' · ')

          return (
            <button className="request-index-row" key={request.id} onClick={() => setSelectedId(request.id)} type="button">
              <div className="request-identity">
                <strong>{vehicleTitle}</strong>
                <span>{itemSummary}</span>
                <small>{request.requestNo} · 共 {request.quantity} 台</small>
                {(role === 'admin' || role === 'sales') && (
                  <small>负责人：{assignees.find((user) => user.username === request.assignedTo)?.displayName ?? '未分配'}</small>
                )}
                <div className="request-summary-popover" role="tooltip">
                  <div className="request-popover-head">
                    <div>
                      <strong>车辆需求明细</strong>
                      <span>{request.requestNo}</span>
                    </div>
                    <Badge label={request.status} />
                  </div>
                  <div className="request-popover-items">
                    {request.items.map((item) => (
                      <div key={item.id}>
                        <div>
                          <strong>{item.vehicleModel}</strong>
                          <span>{item.vehicleTrim} · {item.vehicleColor}</span>
                        </div>
                        <strong>{item.quantity} 台</strong>
                      </div>
                    ))}
                  </div>
                  <div className="request-popover-meta">
                    <div><span>交付条件</span><strong>{request.tradeTerm} · {request.destinationPort}</strong></div>
                    <div><span>最新报价</span><strong>{request.versions[0] ? formatUsd(request.versions[0].total) : '待报价'}</strong></div>
                    <div><span>最后更新</span><strong>{new Date(request.updatedAt).toLocaleDateString()}</strong></div>
                  </div>
                  {request.notes && <p>{request.notes}</p>}
                </div>
              </div>
              <div className="request-delivery">
                <strong>{request.tradeTerm}</strong>
                <span>{request.destinationPort}</span>
              </div>
              <strong>{request.versions[0] ? formatUsd(request.versions[0].total) : '待报价'}</strong>
              <Badge label={request.status} />
              <span className="request-updated">{new Date(request.updatedAt).toLocaleDateString()}</span>
              <span className="row-link">查看详情 →</span>
            </button>
          )
        })}
        {filteredRequests.length === 0 && (
          <div className="request-index-empty">没有找到符合条件的询价</div>
        )}
      </div>
    </div>
  )
}

function QuoteRequestCard({
  assignees,
  request,
  role,
  vehicles,
  onChanged,
}: {
  assignees: StaffUser[]
  request: QuoteRequest
  role: Role
  vehicles: Vehicle[]
  onChanged: () => Promise<void>
}) {
  const { roleLabel, language } = useI18n()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [revisionMessage, setRevisionMessage] = useState('')
  const [editingInquiry, setEditingInquiry] = useState(false)

  async function action(url: string, options?: RequestInit) {
    setBusy(true)
    setError('')
    try {
      await api(url, options)
      await onChanged()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="request-card">
      <header>
        <div><strong>{request.requestNo}</strong><span>{request.items.length} 款车辆 · {request.quantity} 台</span></div>
        <div className="request-header-actions">
          {request.canAssign ? (
            <label className="assignee-select">
              <span>{language === 'zh' ? '负责人' : 'Owner'}</span>
              <select
                onChange={(event) => action(`/api/quote-requests/${request.id}/assignment`, {
                  method: 'PATCH',
                  body: JSON.stringify({ assignedTo: event.target.value || null }),
                })}
                value={request.assignedTo ?? ''}
              >
                <option value="">{language === 'zh' ? '未分配' : 'Unassigned'}</option>
                {assignees.map((user) => (
                  <option key={user.username} value={user.username}>
                    {user.displayName} · {roleLabel(user.role)}
                  </option>
                ))}
              </select>
            </label>
          ) : role === 'sales' ? (
            <span className="assigned-owner">
              {language === 'zh' ? '负责人' : 'Owner'}：{assignees.find((user) => user.username === request.assignedTo)?.displayName ?? request.assignedTo}
            </span>
          ) : null}
          {request.canEditInquiry && (
            <button onClick={() => setEditingInquiry(true)} type="button">修改询价需求</button>
          )}
          <Badge label={request.status} />
        </div>
      </header>
      <div className="request-section-title">
        <strong>客户当前需求</strong>
        <span>{request.tradeTerm} · {request.destinationPort}</span>
      </div>
      <div className="request-item-list compact">
        {request.items.map((item) => (
          <div className="request-item-row" key={item.id}>
            <div>
              <strong>{item.vehicleModel}</strong>
              <span>{item.vehicleTrim} · {item.vehicleColor}</span>
            </div>
            <div><span>数量</span><strong>{item.quantity} 台</strong></div>
            <div><span>{role === 'customer' ? '报价状态' : '基础合作价快照'}</span><strong>{role === 'customer' ? '待报价' : formatUsd(item.basePriceSnapshot)}</strong></div>
          </div>
        ))}
      </div>
      {request.notes && <p className="request-note">{request.notes}</p>}

      {editingInquiry && (
        <InquiryEditForm
          onCancel={() => setEditingInquiry(false)}
          onSaved={async () => {
            setEditingInquiry(false)
            await onChanged()
          }}
          request={request}
          vehicles={vehicles}
        />
      )}

      {request.versions.length > 0 && (
        <div className="quote-version-list">
          <div className="request-section-title"><strong>报价版本历史</strong><span>共 {request.versions.length} 个版本</span></div>
          {request.versions.map((version) => (
            <QuoteVersionView
              key={version.id}
              onAccept={() => action(`/api/quote-requests/${request.id}/versions/${version.id}/accept`, { method: 'POST' })}
              version={version}
            />
          ))}
        </div>
      )}

      {request.revisionRequests.length > 0 && (
        <div className="revision-history">
          <strong>修改记录</strong>
          {request.revisionRequests.map((revision) => (
            <div key={revision.id}>
              <span>{revision.createdBy} · {new Date(revision.createdAt).toLocaleString()}</span>
              <p>{revision.message}</p>
              <Badge label={revision.status} />
            </div>
          ))}
        </div>
      )}

      {request.canCreateVersion && (role === 'admin' || role === 'sales') && (
        <QuoteVersionBuilder onChanged={onChanged} request={request} vehicles={vehicles} />
      )}

      {(role === 'partner' || role === 'customer') && request.versions.length > 0 && !lockedQuoteRequestStatuses.has(request.status) && (
        <div className="revision-box">
          <label>
            要求修改报价
            <textarea
              onChange={(event) => setRevisionMessage(event.target.value)}
              placeholder="例如：增加一台 Galaxy E5；减少一台 Song Plus；改为 FOB；请调整船运费。"
              value={revisionMessage}
            />
          </label>
          <button
            disabled={busy || !revisionMessage.trim()}
            onClick={() => action(`/api/quote-requests/${request.id}/revision-requests`, {
              method: 'POST',
              body: JSON.stringify({
                quoteVersionId: request.versions[0]?.id ?? null,
                message: revisionMessage,
              }),
            }).then(() => setRevisionMessage(''))}
            type="button"
          >
            提交修改要求
          </button>
        </div>
      )}

      <div className="request-actions">
        {request.canGeneratePi && <button disabled={busy} onClick={() => action(`/api/quote-requests/${request.id}/generate-pi`, { method: 'POST' })} type="button"><FileCheck2 size={16} />生成 PI</button>}
        {request.canConfirmPi && <button disabled={busy} onClick={() => action(`/api/quote-requests/${request.id}/confirm-pi`, { method: 'POST' })} type="button"><CheckCircle2 size={16} />确认 PI</button>}
        {request.piNumber && <span className="pi-reference">PI：{request.piNumber}</span>}
      </div>
      {error && <p className="form-error">{error}</p>}
    </article>
  )
}

function InquiryEditForm({
  request,
  vehicles,
  onCancel,
  onSaved,
}: {
  request: QuoteRequest
  vehicles: Vehicle[]
  onCancel: () => void
  onSaved: () => Promise<void>
}) {
  const [items, setItems] = useState(
    request.items.map((item) => ({ vehicleId: item.vehicleId, quantity: item.quantity })),
  )
  const [destinationPort, setDestinationPort] = useState(request.destinationPort)
  const [tradeTerm, setTradeTerm] = useState(request.tradeTerm)
  const [notes, setNotes] = useState(request.notes)
  const [newVehicleId, setNewVehicleId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function addVehicle() {
    if (!newVehicleId || items.some((item) => item.vehicleId === newVehicleId)) return
    setItems((current) => [...current, { vehicleId: newVehicleId, quantity: 1 }])
    setNewVehicleId('')
  }

  async function save() {
    setBusy(true)
    setError('')
    try {
      await api(`/api/quote-requests/${request.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ items, destinationPort, tradeTerm, notes }),
      })
      await onSaved()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="inquiry-editor">
      <div className="request-section-title">
        <strong>修改询价需求</strong>
        <span>{request.versions.length > 0 ? '保存后管理员会收到通知，并重新发布报价版本' : '管理员尚未发布首次报价'}</span>
      </div>
      <div className="inquiry-edit-items">
        {items.map((item) => {
          const vehicle = vehicles.find((entry) => entry.id === item.vehicleId)
          return (
            <div key={item.vehicleId}>
              <div><strong>{vehicle?.model ?? item.vehicleId}</strong><span>{vehicle?.trim} · {vehicle?.color}</span></div>
              <label>数量
                <input
                  min="1"
                  onChange={(event) => setItems((current) => current.map((entry) => entry.vehicleId === item.vehicleId ? { ...entry, quantity: Number(event.target.value) } : entry))}
                  type="number"
                  value={item.quantity}
                />
              </label>
              <button
                aria-label={`删除 ${vehicle?.model ?? item.vehicleId}`}
                disabled={items.length === 1}
                onClick={() => setItems((current) => current.filter((entry) => entry.vehicleId !== item.vehicleId))}
                type="button"
              >
                ×
              </button>
            </div>
          )
        })}
      </div>
      <div className="add-vehicle-row">
        <select onChange={(event) => setNewVehicleId(event.target.value)} value={newVehicleId}>
          <option value="">增加一款车辆</option>
          {vehicles
            .filter((vehicle) => !items.some((item) => item.vehicleId === vehicle.id))
            .map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.model} · {vehicle.trim} · {vehicle.color}</option>)}
        </select>
        <button onClick={addVehicle} type="button">加入询价</button>
      </div>
      <div className="form-grid">
        <label>目的港<input onChange={(event) => setDestinationPort(event.target.value)} value={destinationPort} /></label>
        <label>贸易条款<select onChange={(event) => setTradeTerm(event.target.value)} value={tradeTerm}><option>FOB</option><option>CIF</option><option>CNF</option><option>EXW</option></select></label>
      </div>
      <label className="change-reason">需求备注<textarea onChange={(event) => setNotes(event.target.value)} value={notes} /></label>
      {error && <p className="form-error">{error}</p>}
      <div className="form-actions">
        <button className="secondary-button" onClick={onCancel} type="button">取消</button>
        <button className="primary-button" disabled={busy || items.length === 0} onClick={save} type="button">{busy ? '保存中...' : '保存需求'}</button>
      </div>
    </section>
  )
}

function QuoteVersionView({
  version,
  onAccept,
}: {
  version: QuoteVersion
  onAccept: () => Promise<void>
}) {
  return (
    <section className="quote-version">
      <header>
        <div><strong>V{version.versionNo} · {version.tradeTerm}</strong><span>{new Date(version.createdAt).toLocaleString()} · {version.createdBy}</span></div>
        <Badge label={version.status} />
      </header>
      {version.changeReason && <p className="version-reason">{version.changeReason}</p>}
      <div className="version-table-wrap">
        <div className="version-table-head">
          <span>车型</span><span>数量</span><span>FOB费用/台</span><span>CIF费用/台</span><span>融资费用/台</span><span>利润/台</span><span>最终单价</span><span>小计</span>
        </div>
        {version.items.map((item) => (
          <div className="version-table-row" key={item.id}>
            <div>
              <strong>{item.vehicleModel}</strong>
              <span>{item.vehicleTrim} · {item.vehicleColor}</span>
              {item.hasFinancingEstimate && (
                <small className="version-financing-note">
                  预付 {item.customerDepositRate}% · 融资 {item.financingDays} 天 · 月费率 {item.monthlyFinancingRate}%
                  {item.advanceAmount !== undefined && <em>内部垫资 {formatUsd(item.advanceAmount)}</em>}
                </small>
              )}
            </div>
            <span>{item.quantity} 台</span>
            <span>{formatUsd(item.fobPrice)}</span>
            <span>{formatUsd(item.shippingFee)}</span>
            <span>{formatUsd(item.financingFee)}</span>
            <span>{formatUsd(item.profit)}</span>
            <strong>{formatUsd(item.unitPrice)}</strong>
            <strong>{formatUsd(item.subtotal)}</strong>
          </div>
        ))}
      </div>
      <div className="version-total">
        <span>{version.items.reduce((sum, item) => sum + item.quantity, 0)} 台车辆</span>
        <strong>报价总额 {formatUsd(version.total)}</strong>
      </div>
      {version.canAccept && <button className="accept-quote" onClick={onAccept} type="button"><CheckCircle2 size={16} />接受 V{version.versionNo} 报价</button>}
    </section>
  )
}

function QuoteVersionBuilder({
  request,
  vehicles,
  onChanged,
}: {
  request: QuoteRequest
  vehicles: Vehicle[]
  onChanged: () => Promise<void>
}) {
  const latestVersionItems = request.versions[0]?.items ?? []
  const useCurrentDemand = request.status === 'customer_changed' || request.versions.length === 0
  const sourceItems = useCurrentDemand ? request.items.map((item) => {
    const previous = latestVersionItems.find((entry) => entry.vehicleId === item.vehicleId)
    return {
    id: item.id,
    vehicleId: item.vehicleId,
    vehicleModel: item.vehicleModel,
    vehicleTrim: item.vehicleTrim,
    vehicleColor: item.vehicleColor,
    quantity: item.quantity,
    basePrice: item.basePriceSnapshot,
    fobPrice: item.basePriceSnapshot,
    shippingFee: previous?.shippingFee ?? 0,
    customerDepositRate: previous?.customerDepositRate ?? 20,
    supplierPaymentRate: previous?.supplierPaymentRate ?? 100,
    financingDays: previous?.financingDays ?? 30,
    monthlyFinancingRate: previous?.monthlyFinancingRate ?? 1,
    profit: previous?.profit ?? 500,
    unitPrice: item.basePriceSnapshot + 500,
    subtotal: (item.basePriceSnapshot + 500) * item.quantity,
  }
  }) : latestVersionItems
  const [items, setItems] = useState(sourceItems.map((item) => ({
    vehicleId: item.vehicleId,
    quantity: item.quantity,
    fobPrice: item.fobPrice,
    shippingFee: item.shippingFee,
    customerDepositRate: item.customerDepositRate ?? 20,
    supplierPaymentRate: item.supplierPaymentRate ?? 100,
    financingDays: item.financingDays ?? 30,
    monthlyFinancingRate: item.monthlyFinancingRate ?? 1,
    profit: item.profit,
  })))
  const [tradeTerm, setTradeTerm] = useState(request.versions[0]?.tradeTerm ?? request.tradeTerm ?? 'CIF')
  const [newVehicleId, setNewVehicleId] = useState('')
  const [changeReason, setChangeReason] = useState(request.versions.length === 0 ? '首次报价' : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function updateItem(
    vehicleId: string,
    field: 'quantity' | 'fobPrice' | 'shippingFee' | 'customerDepositRate' | 'supplierPaymentRate' | 'financingDays' | 'monthlyFinancingRate' | 'profit',
    value: number,
  ) {
    setItems((current) => current.map((item) => item.vehicleId === vehicleId ? { ...item, [field]: value } : item))
  }

  function addVehicle() {
    if (!newVehicleId || items.some((item) => item.vehicleId === newVehicleId)) return
    const vehicle = vehicles.find((entry) => entry.id === newVehicleId)
    setItems((current) => [...current, {
      vehicleId: newVehicleId,
      quantity: 1,
      fobPrice: vehicle?.visiblePrice ?? 0,
      shippingFee: 0,
      customerDepositRate: 20,
      supplierPaymentRate: 100,
      financingDays: 30,
      monthlyFinancingRate: 1,
      profit: 500,
    }])
    setNewVehicleId('')
  }

  async function publish() {
    setBusy(true)
    setError('')
    try {
      await api(`/api/quote-requests/${request.id}/versions`, {
        method: 'POST',
        body: JSON.stringify({
          tradeTerm,
          items,
          changeReason,
        }),
      })
      await onChanged()
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : '发布失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="version-builder">
      <div className="request-section-title">
        <strong>制作报价 V{request.versions.length + 1}</strong>
        <select onChange={(event) => setTradeTerm(event.target.value)} value={tradeTerm}><option>FOB</option><option>CIF</option><option>CNF</option><option>EXW</option></select>
      </div>
      <div className="quote-formula-note">
        融资费用按垫资金额、月费率和预计融资天数自动计算。最终单价 = FOB费用 + CIF费用 + 融资费用 + 利润。
      </div>
      <div className="builder-items">
        {items.map((item) => {
          const vehicle = vehicles.find((entry) => entry.id === item.vehicleId)
          const requestItem = request.items.find((entry) => entry.vehicleId === item.vehicleId)
          const cooperationPrice = requestItem?.basePriceSnapshot ?? vehicle?.visiblePrice ?? 0
          const advanceAmount = Math.max(
            (vehicle?.cost ?? 0) * item.supplierPaymentRate / 100
              - cooperationPrice * item.customerDepositRate / 100,
            0,
          )
          const financingFee = advanceAmount * item.monthlyFinancingRate / 100 * item.financingDays / 30
          return (
            <div className="builder-item" key={item.vehicleId}>
              <div className="builder-pricing-row">
                <div><strong>{vehicle?.model ?? item.vehicleId}</strong><span>{vehicle?.trim} · {vehicle?.color}</span></div>
                <label>数量<input min="1" onChange={(event) => updateItem(item.vehicleId, 'quantity', Number(event.target.value))} type="number" value={item.quantity} /></label>
                <label>FOB费用/台<input min="0" onChange={(event) => updateItem(item.vehicleId, 'fobPrice', Number(event.target.value))} type="number" value={item.fobPrice} /></label>
                <label>CIF费用/台<input min="0" onChange={(event) => updateItem(item.vehicleId, 'shippingFee', Number(event.target.value))} type="number" value={item.shippingFee} /></label>
                <label>利润/台<input min="0" onChange={(event) => updateItem(item.vehicleId, 'profit', Number(event.target.value))} type="number" value={item.profit} /></label>
                <button aria-label={`移除 ${vehicle?.model ?? item.vehicleId}`} onClick={() => setItems((current) => current.filter((entry) => entry.vehicleId !== item.vehicleId))} type="button">×</button>
              </div>
              <div className="financing-calculator">
                <label>客户预付款比例
                  <div className="percent-input"><input max="100" min="0" onChange={(event) => updateItem(item.vehicleId, 'customerDepositRate', Number(event.target.value))} type="number" value={item.customerDepositRate} /><span>%</span></div>
                </label>
                <label>供应商付款比例
                  <div className="percent-input"><input max="100" min="0" onChange={(event) => updateItem(item.vehicleId, 'supplierPaymentRate', Number(event.target.value))} type="number" value={item.supplierPaymentRate} /><span>%</span></div>
                </label>
                <label>预计融资时间
                  <div className="percent-input"><input min="0" onChange={(event) => updateItem(item.vehicleId, 'financingDays', Number(event.target.value))} type="number" value={item.financingDays} /><span>天</span></div>
                </label>
                <label>月融资费率
                  <div className="percent-input"><input min="0" onChange={(event) => updateItem(item.vehicleId, 'monthlyFinancingRate', Number(event.target.value))} step="0.1" type="number" value={item.monthlyFinancingRate} /><span>%</span></div>
                </label>
                <div className="financing-result">
                  <span>基础合作价</span><strong>{formatUsd(cooperationPrice)}</strong>
                  <span>内部采购成本</span><strong>{formatUsd(vehicle?.cost ?? 0)}</strong>
                  <span>预计垫资金额</span><strong>{formatUsd(advanceAmount)}</strong>
                  <span>融资费用/台</span><strong className="price-current">{formatUsd(financingFee)}</strong>
                </div>
              </div>
            </div>
          )
        })}
      </div>
      <div className="add-vehicle-row">
        <select onChange={(event) => setNewVehicleId(event.target.value)} value={newVehicleId}>
          <option value="">增加一款车辆</option>
          {vehicles.filter((vehicle) => !items.some((item) => item.vehicleId === vehicle.id)).map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.model} · {vehicle.trim} · {vehicle.color}</option>)}
        </select>
        <button onClick={addVehicle} type="button">加入报价</button>
      </div>
      <label className="change-reason">本次修改说明<textarea onChange={(event) => setChangeReason(event.target.value)} placeholder="例如：根据客户要求增加一台车，并更新海运费。" value={changeReason} /></label>
      <div className="builder-actions">
        <button disabled={busy || items.length === 0} onClick={publish} type="button">{busy ? '发布中...' : `发布 V${request.versions.length + 1} 报价`}</button>
      </div>
      {error && <p className="form-error">{error}</p>}
    </section>
  )
}

function getPaymentSummary(order: Order) {
  const paid = order.payments.reduce((sum, payment) => sum + payment.amount, 0)
  const depositPaid = order.payments.filter((payment) => payment.type === 'deposit' || payment.type === '定金').reduce((sum, payment) => sum + payment.amount, 0)
  return {
    paid,
    depositPaid,
    balance: Math.max(order.total - paid, 0),
    depositBalance: Math.max(order.depositDue - depositPaid, 0),
    progress: Math.min(Math.round((paid / order.total) * 100), 100),
    depositProgress: Math.min(Math.round((depositPaid / order.depositDue) * 100), 100),
  }
}

function OrderDetail({ order, role }: { order: Order; role: Role }) {
  const { language } = useI18n()
  return (
    <div className="order-detail">
      <div className="order-main">
        <div><span className="label">{language === 'zh' ? '订单编号' : 'Order No.'}</span><strong>{order.id}</strong></div>
        <div><span className="label">{language === 'zh' ? '客户' : 'Customer'}</span><strong>{order.customer}</strong></div>
        <div><span className="label">{language === 'zh' ? '车型' : 'Vehicle'}</span><strong>{order.model}</strong></div>
        <div><span className="label">{language === 'zh' ? '状态' : 'Status'}</span><Badge label={order.status} /></div>
        {role === 'admin' && order.internalProfit !== undefined && <div><span className="label">{language === 'zh' ? '内部预计利润' : 'Internal Profit'}</span><strong className="sensitive">{formatUsd(order.internalProfit)}</strong></div>}
      </div>
      <PaymentBoard order={order} showProof={role !== 'customer'} compact />
    </div>
  )
}

function PaymentBoard({ order, showProof, compact = false }: { order: Order; showProof: boolean; compact?: boolean }) {
  const { language, statusLabel } = useI18n()
  const summary = useMemo(() => getPaymentSummary(order), [order])
  return (
    <div className="payment-board">
      <div className="payment-summary">
        <Metric label={language === 'zh' ? '订单金额' : 'Order Total'} value={formatUsd(order.total)} note={language === 'zh' ? `关联报价 ${order.quoteId}` : `Quote ${order.quoteId}`} />
        <Metric label={language === 'zh' ? '应收定金' : 'Deposit Due'} value={formatUsd(order.depositDue)} note={language === 'zh' ? `已收 ${formatUsd(summary.depositPaid)}` : `Received ${formatUsd(summary.depositPaid)}`} />
        <Metric label={language === 'zh' ? '剩余金额' : 'Balance'} value={formatUsd(summary.balance)} note={language === 'zh' ? `总收款进度 ${summary.progress}%` : `Payment progress ${summary.progress}%`} />
      </div>
      <div className="progress-card">
        <div><span>{language === 'zh' ? '定金收款进度' : 'Deposit Progress'}</span><strong>{summary.depositProgress}%</strong></div>
        <div className="progress-track"><div style={{ width: `${summary.depositProgress}%` }} /></div>
        <small>{language === 'zh' ? `已收定金 ${formatUsd(summary.depositPaid)}，定金未收 ${formatUsd(summary.depositBalance)}` : `Deposit received ${formatUsd(summary.depositPaid)}, outstanding ${formatUsd(summary.depositBalance)}`}</small>
      </div>
      {!compact && <div className="table-wrap"><table>
        <thead><tr><th>{language === 'zh' ? '日期' : 'Date'}</th><th>{language === 'zh' ? '类型' : 'Type'}</th><th>{language === 'zh' ? '金额' : 'Amount'}</th>{showProof && <th>{language === 'zh' ? '方式' : 'Method'}</th>}{showProof && <th>{language === 'zh' ? '凭证' : 'Proof'}</th>}</tr></thead>
        <tbody>{order.payments.map((payment) => <tr key={payment.id}><td>{payment.date}</td><td>{statusLabel(payment.type)}</td><td>{formatUsd(payment.amount)}</td>{showProof && <td>{payment.method}</td>}{showProof && <td>{payment.proof}</td>}</tr>)}</tbody>
      </table></div>}
    </div>
  )
}

function LogisticsTimeline({ logistics }: { logistics: LogisticsStep[] }) {
  return <div className="timeline">{logistics.map((item) => <div className={`timeline-item ${item.status}`} key={item.step}><div className="timeline-dot" /><div><strong>{item.step}</strong><span>{item.date}</span><small>{item.owner}</small></div></div>)}</div>
}

function FileList({ role }: { role: Role }) {
  const files = role === 'customer'
    ? ['最终报价单 QT-001-C.pdf', '订单确认书 ORD-202606-001.pdf', '车辆装运照片.zip']
    : ['报价单 QT-001-C.pdf', '定金凭证 PAY-001.jpg', '车辆照片 EV-001.zip', '商业发票草稿.xlsx']
  return <div className="file-list">{files.map((file) => <div className="file-row" key={file}><FileText size={18} /><span>{file}</span><button type="button">查看</button></div>)}</div>
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state">{text}</div>
}

function Badge({ label }: { label: string }) {
  const { statusLabel } = useI18n()
  const positive = ['accepted', 'deposit_received', 'in_stock', 'quote_accepted', '已接受', '已收定金', '可售', '已报价'].includes(label)
  return <span className={`badge ${positive ? 'green' : ''}`}>{statusLabel(label)}</span>
}

export default App
