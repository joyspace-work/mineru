import {
  Bell,
  Boxes,
  Car,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  ClipboardList,
  CreditCard,
  FileText,
  FileCheck2,
  Eye,
  EyeOff,
  LayoutDashboard,
  LogOut,
  Menu,
  PackageCheck,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Ship,
  Trash2,
  Users,
} from 'lucide-react'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'

type Role = 'admin' | 'sales' | 'partner' | 'customer'
type Language = 'zh' | 'en'
type NavKey =
  | 'dashboard'
  | 'vehicles'
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
  visiblePrice: number
  priceLabel: string
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
  stockColors: { color: string; quantity: number; productionMonth?: string }[]
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

type NavItem = {
  key: NavKey
  icon: typeof LayoutDashboard
  roles: Role[]
}

const navItems: NavItem[] = [
  { key: 'dashboard', icon: LayoutDashboard, roles: ['admin', 'sales', 'partner', 'customer'] },
  { key: 'vehicles', icon: Car, roles: ['admin', 'sales', 'partner', 'customer'] },
  { key: 'quotes', icon: ClipboardList, roles: ['admin', 'sales', 'partner', 'customer'] },
  { key: 'orders', icon: PackageCheck, roles: ['admin', 'partner', 'customer'] },
  { key: 'payments', icon: CreditCard, roles: ['admin'] },
  { key: 'logistics', icon: Ship, roles: ['admin', 'partner', 'customer'] },
  { key: 'customers', icon: Users, roles: ['admin'] },
  { key: 'staff', icon: ShieldCheck, roles: ['admin'] },
  { key: 'files', icon: Boxes, roles: ['admin', 'sales', 'partner', 'customer'] },
]

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
    nav_vehicles: '车辆资源',
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
    nav_vehicles: 'Vehicle Resources',
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

const ALL_STATUSES = '__all__'
const lockedQuoteRequestStatuses = new Set(['quote_accepted', 'pi_confirmed'])

type I18nContextValue = {
  language: Language
  setLanguage: (language: Language) => void
  t: (key: string) => string
  roleLabel: (role: Role) => string
  statusLabel: (label: string) => string
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

const formatProductionMonth = (value?: string) => {
  if (!value) return '生产年月待补充'
  const [year, month] = value.split('-')
  return `${year}年${Number(month)}月`
}

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: '请求失败' }))
    throw new Error(body.error || '请求失败')
  }
  return response.status === 204 ? (undefined as T) : response.json()
}

function App() {
  const [language, setLanguage] = useState<Language>(() => {
    const saved = window.localStorage.getItem('ev-language')
    return saved === 'en' ? 'en' : 'zh'
  })
  const [data, setData] = useState<AppData | null>(null)
  const [checkingSession, setCheckingSession] = useState(true)
  const [active, setActive] = useState<NavKey>('dashboard')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)

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

  const i18n = useMemo<I18nContextValue>(() => ({
    language,
    setLanguage,
    t: (key: string) => translations[language][key] ?? key,
    roleLabel: (role: Role) => translations[language][`role_${role}`] ?? role,
    statusLabel: (label: string) => statusLabels[label]?.[language] ?? label,
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
    <div className="app-shell">
      <aside className={`sidebar ${mobileNavOpen ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-mark">EV</div>
          <div>
            <strong>{i18n.t('appName')}</strong>
            <span>China / Ethiopia</span>
          </div>
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
                type="button"
              >
                <Icon size={18} />
                {i18n.t(`nav_${item.key}`)}
              </button>
            )
          })}
        </nav>
        <div className="sidebar-user">
          <div>
            <strong>{data.user.displayName}</strong>
            <span>{i18n.roleLabel(data.user.role)}</span>
          </div>
          <button aria-label={i18n.t('logout')} onClick={logout} title={i18n.t('logout')} type="button">
            <LogOut size={17} />
          </button>
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
        {active === 'vehicles' && (
          <DataPanel title={i18n.t('nav_vehicles')} subtitle={i18n.t('vehiclesSubtitle')}>
            <VehicleTable
              vehicles={data.vehicles}
              canSeeCost={data.permissions.canSeeCost}
              canRequestQuote={data.permissions.canRequestQuote}
              onCreated={loadData}
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

function VehicleTable({
  vehicles,
  canSeeCost,
  canRequestQuote,
  onCreated,
}: {
  vehicles: Vehicle[]
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
            <span>先建立车型配置，再为该配置添加一个或多个供应商车源。</span>
          </div>
          <button onClick={() => setShowVehicleForm(true)} type="button">
            <Plus size={17} />
            新增车型配置
          </button>
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
                <div><span>价格</span><strong className={group.hasCurrentPrice ? 'price-current' : 'price-expired'}>{formatUsd(group.startingPrice)} 起</strong></div>
                <span className="expand-label">{isExpanded ? '收起版本' : '查看版本'}</span>
              </button>
              {isExpanded && (
                <div className="resource-variants">
                  {group.variants.map((vehicle) => {
                    const versionExpanded = expandedVersions.includes(vehicle.id)
                    const isSelected = basket.some((item) => item.vehicle.id === vehicle.id)
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
                            <div><strong>{vehicle.year} · {vehicle.trim}</strong><span>{vehicle.rangeKm}KM · {vehicle.batteryCapacity}</span></div>
                          </button>
                          <div><span>供应状态</span><Badge label={vehicle.isListed ? vehicle.status : 'delisted'} /></div>
                          <div><span>现车</span><strong>{vehicle.stockQuantity} 台</strong></div>
                          <div><span>预订周期</span><strong>{vehicle.preorderMinDays > 0 ? `${vehicle.preorderMinDays}-${vehicle.preorderMaxDays} 天` : '待确认'}</strong></div>
                          <div><span>{vehicle.priceLabel}</span><strong className={vehicle.isPriceValid ? 'price-current' : 'price-expired'}>{formatUsd(vehicle.visiblePrice)}</strong><small>{vehicle.isPriceValid ? `有效至 ${formatDate(vehicle.priceValidUntil)}` : `已于 ${formatDate(vehicle.priceValidUntil)} 过期`}</small></div>
                        </div>
                        {versionExpanded && (
                          <VehicleResourceDetails
                            canSeeCost={canSeeCost}
                            onAddSource={() => setSourceVehicle(vehicle)}
                            onEditSource={(source) => setEditingSource({ vehicle, source })}
                            onEditVehicle={() => setEditingVehicle(vehicle)}
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
        />
      )}
      {editingVehicle && (
        <VehicleForm
          onClose={() => setEditingVehicle(null)}
          onCreated={async () => {
            setEditingVehicle(null)
            await onCreated()
          }}
          vehicle={editingVehicle}
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
  onUpdatePrice,
  onListingChanged,
  onEditSource,
  onRemoveSource,
}: {
  vehicle: Vehicle
  canSeeCost: boolean
  onAddSource: () => void
  onEditVehicle: () => void
  onUpdatePrice: () => void
  onListingChanged: () => Promise<void>
  onEditSource: (source: SupplierSource) => void
  onRemoveSource: (source: SupplierSource) => Promise<void>
}) {
  return (
    <div className="vehicle-resource-details">
      {canSeeCost && (
        <div className="vehicle-management-actions">
          <button onClick={onEditVehicle} type="button"><Pencil size={15} />编辑车型资料</button>
          <button onClick={onUpdatePrice} type="button"><CreditCard size={15} />更新合作价</button>
          <button className={vehicle.isListed ? 'danger-outline' : ''} onClick={onListingChanged} type="button">
            {vehicle.isListed ? <EyeOff size={15} /> : <Eye size={15} />}
            {vehicle.isListed ? '下架配置' : '恢复上架'}
          </button>
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
            <div><strong>供应商车源明细</strong><span>内部信息，仅管理员可见</span></div>
            <button onClick={onAddSource} type="button"><Plus size={15} />添加供应商车源</button>
          </div>
          {vehicle.supplierSources && vehicle.supplierSources.length > 0 ? (
            <div className="supplier-source-table">
              <div className="supplier-source-head"><span>供应商</span><span>现车</span><span>现车批次</span><span>预订周期</span><span>供应商价格</span><span>更新时间</span><span>操作</span></div>
              {vehicle.supplierSources.map((source) => (
                <div className="supplier-source-row" key={source.id}>
                  <div><strong>{source.supplierName}</strong><small>{source.notes}</small></div>
                  <span>{source.stockQuantity} 台</span>
                  <span>{source.stockColors.map((entry) => `${entry.color} ${entry.quantity} 台（${formatProductionMonth(entry.productionMonth)}）`).join('；') || '无'}</span>
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
            <div className="supplier-source-empty">尚未录入供应商车源，当前对外状态为暂时缺货。</div>
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
  vehicle,
}: {
  onClose: () => void
  onCreated: () => Promise<void>
  vehicle?: Vehicle
}) {
  const [form, setForm] = useState({
    brand: '',
    model: vehicle?.model ?? '',
    trim: vehicle?.trim ?? '',
    year: vehicle?.year ?? String(new Date().getFullYear()),
    energyType: vehicle?.energyType ?? '纯电',
    rangeKm: vehicle?.rangeKm ? String(vehicle.rangeKm) : '',
    batteryCapacity: vehicle?.batteryCapacity ?? '',
    drivetrain: vehicle?.drivetrain ?? '前驱',
    availableColors: vehicle?.availableColors.join('、') ?? '',
    partnerPrice: vehicle ? String(vehicle.visiblePrice) : '',
    imageUrl: vehicle?.imageUrl ?? '',
    publicNotes: vehicle?.publicNotes ?? '',
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
      await api(vehicle ? `/api/vehicles/${vehicle.id}` : '/api/vehicles', {
        method: vehicle ? 'PATCH' : 'POST',
        body: JSON.stringify({
          ...form,
          rangeKm: Number(form.rangeKm),
          partnerPrice: Number(form.partnerPrice),
          availableColors: form.availableColors.split(/[,，、]/).map((color) => color.trim()).filter(Boolean),
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
          <div><p className="eyebrow">车辆资料管理</p><h2>{vehicle ? '编辑车型配置' : '新增车型配置'}</h2><span>这些资料将用于客户查看和发起询价</span></div>
          <button aria-label="关闭" onClick={onClose} type="button">×</button>
        </div>
        <div className="form-section-label">基本信息</div>
        <div className="form-grid">
          {!vehicle && <label>品牌<input onChange={(event) => update('brand', event.target.value)} placeholder="例如 BYD" required value={form.brand} /></label>}
          <label>{vehicle ? '完整车型名称' : '车型'}<input onChange={(event) => update('model', event.target.value)} placeholder={vehicle ? '例如 BYD Song Plus EV' : '例如 Song Plus EV'} required value={form.model} /></label>
          <label>配置版本<input onChange={(event) => update('trim', event.target.value)} placeholder="例如 旗舰型 605KM" required value={form.trim} /></label>
          <label>年款<input onChange={(event) => update('year', event.target.value)} required value={form.year} /></label>
          <label>能源类型<select onChange={(event) => update('energyType', event.target.value)} value={form.energyType}><option>纯电</option><option>插电混动</option><option>增程</option></select></label>
          <label>驱动方式<select onChange={(event) => update('drivetrain', event.target.value)} value={form.drivetrain}><option>前驱</option><option>后驱</option><option>四驱</option></select></label>
          <label>续航里程（KM）<input min="0" onChange={(event) => update('rangeKm', event.target.value)} type="number" value={form.rangeKm} /></label>
          <label>电池容量<input onChange={(event) => update('batteryCapacity', event.target.value)} placeholder="例如 87 kWh" value={form.batteryCapacity} /></label>
        </div>
        <label>可选颜色<input onChange={(event) => update('availableColors', event.target.value)} placeholder="冰川蓝、雪域白、曜石黑" value={form.availableColors} /></label>
        <div className="form-section-label">{vehicle ? '展示资料' : '价格与展示'}</div>
        <div className="form-grid">
          {!vehicle && <label>基础合作价（USD）<input min="1" onChange={(event) => update('partnerPrice', event.target.value)} required type="number" value={form.partnerPrice} /></label>}
          <label>车辆图片地址<input onChange={(event) => update('imageUrl', event.target.value)} placeholder="可选，https://..." type="url" value={form.imageUrl} /></label>
        </div>
        <label>公开备注<textarea onChange={(event) => update('publicNotes', event.target.value)} placeholder="例如支持批量预订、可提供随车充电设备" value={form.publicNotes} /></label>
        <div className="entry-form-note">{vehicle ? '修改车型资料不会覆盖历史询价和报价中的快照。合作价请使用单独的“更新合作价”操作。' : '价格更新时间自动记录，有效期默认 14 天。新增后因尚无供应商车源，状态为“暂时缺货”。'}</div>
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions">
          <button className="secondary-button" onClick={onClose} type="button">取消</button>
          <button className="primary-button" disabled={busy} type="submit">{busy ? '保存中...' : vehicle ? '保存修改' : '保存车型配置'}</button>
        </div>
      </form>
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
      ? source.stockColors.map((entry) => ({ ...entry, productionMonth: entry.productionMonth ?? '' }))
      : [{ color: '', quantity: 1, productionMonth: '' }],
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
          <div className="form-section-label">现车生产批次</div>
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
              <input
                aria-label={`生产年月 ${index + 1}`}
                onChange={(event) => setStockColors((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, productionMonth: event.target.value } : item))}
                required={Boolean(entry.color.trim())}
                type="month"
                value={entry.productionMonth}
              />
              <button
                aria-label={`删除颜色 ${index + 1}`}
                disabled={stockColors.length === 1}
                onClick={() => setStockColors((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                type="button"
              >×</button>
            </div>
          ))}
          <button className="add-stock-color" onClick={() => setStockColors((current) => [...current, { color: '', quantity: 1, productionMonth: '' }])} type="button"><Plus size={15} />增加生产批次</button>
        </div>
        <label className="preorder-toggle"><input checked={canPreorder} onChange={(event) => setCanPreorder(event.target.checked)} type="checkbox" /><span><strong>该供应商接受预订</strong><small>关闭后，这条车源只统计现车，不参与预订周期汇总</small></span></label>
        {canPreorder && (
          <div className="form-grid">
            <label>最快预订周期（天）<input min="1" onChange={(event) => setPreorderMinDays(event.target.value)} required type="number" value={preorderMinDays} /></label>
            <label>最长预订周期（天）<input min={preorderMinDays || '1'} onChange={(event) => setPreorderMaxDays(event.target.value)} required type="number" value={preorderMaxDays} /></label>
          </div>
        )}
        <label>内部备注<textarea onChange={(event) => setNotes(event.target.value)} placeholder="例如现车信息已确认、价格需再次确认" value={notes} /></label>
        <div className="entry-form-note">年款属于车型配置；生产年月属于现车批次。同色车辆生产月份不同，请分成多条批次录入。保存后系统会自动汇总现车数量、颜色和预订周期。</div>
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
          <span>基础合作价</span><strong>{formatUsd(vehicle.visiblePrice)}</strong>
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
              <div><span>{item.quantity} 台 × {formatUsd(item.vehicle.visiblePrice)}</span><strong>{formatUsd(item.vehicle.visiblePrice * item.quantity)}</strong></div>
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
          基础合作价小计 <strong>{formatUsd(items.reduce((sum, item) => sum + item.vehicle.visiblePrice * item.quantity, 0))}</strong>
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
            <div><span>基础合作价快照</span><strong>{formatUsd(item.basePriceSnapshot)}</strong></div>
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
