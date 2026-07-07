import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'

const repoUrl = 'https://github.com/swoiow/autohome.git'
const dataRoot = join(tmpdir(), 'autohome-data-check')
const dataDir = join(dataRoot, 'data')
const dbPath = join(process.cwd(), 'data', 'ev-export.db')
const sourceName = 'AutoHome public dataset / 汽车之家公开参数数据'
const sourceUrl = 'https://github.com/swoiow/autohome'
const autohomeSpecSourceName = 'AutoHome live specification page / 汽车之家实时参数页'
const autohomeWebSupplementSourceName = 'AutoHome rendered page data / 汽车之家网页参数补抓'
const autohomeSupplementCache = new Map()

const sourcePriorityRules = [
  { rank: 1, name: 'primary-auto', pattern: /(^https:\/\/car\.autohome\.com\.cn|autohome|汽车之家|dongchedi|懂车帝)/i },
  { rank: 2, name: 'official', pattern: /(wuling\.com|sgmw\.com|leapmotor\.cn|toyota\.com|官方)/i },
  { rank: 3, name: 'secondary-auto', pattern: /(sohu\.com|pcauto\.com\.cn|yiche\.com|evlook\.com|xchuxing\.com|zol\.com\.cn)/i },
]

const auditPolicy = [
  'Prices missing from static HTML should be checked with a rendered page pass before user review.',
  'Model names and trim names follow the source website text.',
  'Text labels and units follow the source website text.',
  'Unit-only differences are not treated as business data conflicts.',
  'Only unresolved value conflicts are marked for user review.',
]

function sourcePriority(source) {
  const text = String(source ?? '')
  return sourcePriorityRules.find((rule) => rule.pattern.test(text)) || { rank: 9, name: 'other' }
}

const targetSeries = [
  { brand: 'BYD', model: '元UP', file: '比亚迪_元UP.csv' },
  { brand: 'BYD', model: '元PLUS', file: '比亚迪_元PLUS.csv' },
  { brand: 'BYD', model: '宋PLUS新能源', file: '比亚迪_宋PLUS新能源.csv', pureElectricOnly: true },
  { brand: 'BYD', model: '唐L', file: '比亚迪_唐L.csv', pureElectricOnly: true },
  { brand: 'BYD', model: '海狮07 EV', file: '比亚迪_海狮07 EV.csv' },
  { brand: 'BYD', model: '海鸥', file: '比亚迪_海鸥.csv' },
  { brand: 'BYD', model: '海豚', file: '比亚迪_海豚.csv' },
  { brand: '方程豹', model: '钛3', file: '方程豹_钛3.csv' },
  { brand: '方程豹', model: '豹5', file: '方程豹_豹5.csv' },
  { brand: '方程豹', model: '豹8', file: '方程豹_豹8.csv' },
  { brand: '零跑', model: 'B10', file: '零跑汽车_零跑B10.csv' },
  { brand: '零跑', model: 'A10', webOnly: true },
  { brand: '零跑', model: 'C10', file: '零跑汽车_零跑C10.csv' },
  { brand: '零跑', model: 'C11', file: '零跑汽车_零跑C11.csv', allowOlderYears: true },
  { brand: '零跑', model: 'C16', file: '零跑汽车_零跑C16.csv', allowOlderYears: true },
  { brand: '零跑', model: 'D19', webOnly: true },
  { brand: '零跑', model: 'Lafa5', webOnly: true },
  { brand: '吉利银河', model: '星愿', file: '吉利银河_星愿.csv' },
  { brand: '吉利银河', model: '银河E5', file: '吉利银河_银河E5.csv' },
  { brand: '吉利雷达', model: '雷达地平线', file: '吉利雷达_雷达地平线.csv' },
  { brand: '极氪', model: '极氪7X', file: '极氪_极氪7X.csv' },
  { brand: '极氪', model: '极氪X', file: '极氪_极氪X.csv' },
  { brand: '领克', model: '领克Z10', file: '领克_领克Z10.csv' },
  { brand: '埃安', model: 'AION V', file: '埃安_AION V.csv' },
  { brand: '埃安', model: 'AION UT', file: '埃安_AION UT.csv' },
  { brand: '昊铂', model: 'HYPTEC HT', file: '昊铂_昊铂HT.csv' },
  { brand: '东风', model: '纳米01', file: '东风纳米_纳米01.csv' },
  { brand: '东风', model: 'eπ008', file: '东风奕派_eπ008.csv' },
  { brand: '东风', model: '风神L7 EV', file: '东风风神_风神L7.csv', pureElectricOnly: true },
  { brand: '长安', model: '深蓝S05', file: '深蓝汽车_深蓝S05.csv', allowOlderYears: true },
  { brand: '长安', model: '深蓝S07', file: '深蓝汽车_深蓝S07.csv' },
  { brand: '长安', model: '启源Q05', file: '长安启源_长安启源Q05.csv' },
  { brand: '名爵', model: 'MG4 EV', file: '名爵_MG4 EV.csv' },
  { brand: '丰田', model: 'bZ3', file: '丰田_丰田bZ3.csv', allowOlderYears: true },
  { brand: '丰田', model: '铂智3X', file: '丰田_铂智3X.csv' },
  { brand: '丰田', model: 'bZ5', webOnly: true },
  { brand: '奇瑞', model: 'iCAR V23', file: 'iCAR_奇瑞iCAR V23.csv' },
  { brand: '奇瑞', model: 'iCAR V27', webOnly: true },
  { brand: '五菱', model: '星光 EV', file: '五菱汽车_五菱星光.csv', pureElectricOnly: true },
  { brand: '五菱', model: '星光S EV', file: '五菱汽车_五菱星光S.csv', pureElectricOnly: true },
  { brand: '五菱', model: '星光L', webOnly: true },
  { brand: '五菱', model: '星光730 EV', webOnly: true },
  { brand: '五菱', model: '华境S', webOnly: true },
  { brand: '极狐', model: '阿尔法T5', file: 'ARCFOX极狐_极狐 阿尔法T5.csv' },
]

const skippedFutureOrMissing = [
  '零跑 D10',
]

const webFallbacks = [
  {
    key: '零跑 A10',
    url: 'https://car.autohome.com.cn/config/series/8433.html',
    requiredText: '零跑A10',
    profiles: [
      {
        brand: '零跑',
        model: 'A10',
        year: '2026',
        trim: '505 激光雷达版',
        energyType: '纯电动',
        batteryCapacity: '以官方配置为准',
        rangeKm: 505,
        drivetrain: '前驱',
        bodyType: '小型 SUV',
        dimensions: '4270 × 1810 × 1635 mm',
        wheelbase: '2605 mm',
        motorPower: '以官方配置为准',
        seats: '5 座',
        fastCharge: '30%-80% 最快 16 分钟',
        slowCharge: '以官方配置为准',
        officialPrice: '6.58-8.68 万元',
        notes: '网页 fallback 导入：汽车之家/央视公开资料。',
        specs: [
          ['基础信息', '品牌', '零跑'],
          ['基础信息', '车型', 'A10'],
          ['基础信息', '版本', '505 激光雷达版'],
          ['基础信息', '能源类型', '纯电动'],
          ['基础信息', '级别', '小型 SUV'],
          ['基础信息', '国内指导价参考', '6.58-8.68 万元'],
          ['车身', '长宽高', '4270 × 1810 × 1635 mm'],
          ['车身', '轴距', '2605 mm'],
          ['车身', '车身结构', '5 门 5 座 SUV'],
          ['电池/续航', 'CLTC 纯电续航', '505 km'],
          ['充电', '快充时间', '30%-80% 最快 16 分钟'],
          ['性能', '最高车速', '160 km/h'],
          ['座舱/舒适', '中控屏', '14.6 英寸 2.5K 中控屏'],
        ],
      },
    ],
  },
  {
    key: '零跑 D19',
    url: 'https://car.autohome.com.cn/config/series/8273.html',
    requiredText: '零跑D19',
    profiles: [
      {
        brand: '零跑',
        model: 'D19',
        year: '2026',
        trim: '纯电720智尊版七座',
        energyType: '纯电动',
        batteryCapacity: '以官方配置为准',
        rangeKm: 720,
        drivetrain: '四驱',
        bodyType: '中大型 SUV',
        dimensions: '5252 × 1995 × 1780 mm',
        wheelbase: '以官方配置为准',
        motorPower: '以官方配置为准',
        seats: '7 座',
        fastCharge: '以官方配置为准',
        slowCharge: '以官方配置为准',
        officialPrice: '24.98 万元',
        notes: '网页 fallback 导入：汽车之家/太平洋公开参数。',
        specs: [
          ['基础信息', '品牌', '零跑'],
          ['基础信息', '车型', 'D19'],
          ['基础信息', '版本', '纯电720智尊版七座'],
          ['基础信息', '能源类型', '纯电动'],
          ['基础信息', '级别', '中大型 SUV'],
          ['基础信息', '国内指导价参考', '24.98 万元'],
          ['车身', '长宽高', '5252 × 1995 × 1780 mm'],
          ['车身', '车身结构', '5 门 7 座 SUV'],
          ['车身', '座位数', '7 座'],
          ['动力', '驱动方式', '四驱'],
          ['电池/续航', 'CLTC 纯电续航', '720 km'],
        ],
      },
    ],
  },
  {
    key: '零跑 Lafa5',
    url: 'https://www.evlook.com/lingpaolafa5/peizhi',
    requiredText: '零跑Lafa5',
    profiles: [
      {
        brand: '零跑',
        model: 'Lafa5',
        year: '2026',
        trim: '605 Pro',
        energyType: '纯电动',
        batteryCapacity: '以官方配置为准',
        rangeKm: 605,
        drivetrain: '前驱',
        bodyType: '紧凑型车',
        dimensions: '4430 × 1880 × 1520 mm',
        wheelbase: '2735 mm',
        motorPower: '160 kW',
        seats: '5 座',
        fastCharge: '以官方配置为准',
        slowCharge: '以官方配置为准',
        officialPrice: '11.18 万元',
        notes: '网页 fallback 导入：EV视界/搜狐公开参数。',
        specs: [
          ['基础信息', '品牌', '零跑'],
          ['基础信息', '车型', 'Lafa5'],
          ['基础信息', '版本', '605 Pro'],
          ['基础信息', '能源类型', '纯电动'],
          ['基础信息', '级别', '紧凑型车'],
          ['基础信息', '国内指导价参考', '11.18 万元'],
          ['车身', '长宽高', '4430 × 1880 × 1520 mm'],
          ['车身', '轴距', '2735 mm'],
          ['车身', '车身结构', '5 门 5 座两厢车'],
          ['动力', '电机功率', '160 kW'],
          ['电池/续航', 'CLTC 纯电续航', '605 km'],
        ],
      },
    ],
  },
  {
    key: '丰田 bZ5',
    url: 'https://car.autohome.com.cn/config/series/7713.html',
    requiredText: '丰田bZ5',
    profiles: [
      {
        brand: '丰田',
        model: 'bZ5',
        year: '2026',
        trim: '550 长续航版',
        energyType: '纯电动',
        batteryCapacity: '以官方配置为准',
        rangeKm: 550,
        drivetrain: '前驱',
        bodyType: '中型 SUV',
        dimensions: '4780 × 1866 × 1510 mm',
        wheelbase: '2880 mm',
        motorPower: '以官方配置为准',
        seats: '5 座',
        fastCharge: '0.45 小时',
        slowCharge: '9.5 小时',
        officialPrice: '以官方价格为准',
        notes: '网页 fallback 导入：汽车之家/搜狐公开参数。',
        specs: [
          ['基础信息', '品牌', '丰田'],
          ['基础信息', '车型', 'bZ5'],
          ['基础信息', '版本', '550 长续航版'],
          ['基础信息', '能源类型', '纯电动'],
          ['基础信息', '级别', '中型 SUV'],
          ['车身', '长宽高', '4780 × 1866 × 1510 mm'],
          ['车身', '轴距', '2880 mm'],
          ['车身', '车身结构', '5 门 5 座 SUV'],
          ['电池/续航', 'CLTC 纯电续航', '550 km'],
          ['电池/续航', '电池类型', '磷酸铁锂电池'],
          ['充电', '快充时间', '0.45 小时'],
          ['充电', '慢充时间', '9.5 小时'],
        ],
      },
    ],
  },
  {
    key: '奇瑞 iCAR V27',
    url: 'https://car.autohome.com.cn/config/series/8232.html',
    requiredText: 'iCAR V27',
    profiles: [
      {
        brand: '奇瑞',
        model: 'iCAR V27',
        year: '2026',
        trim: '210KM 两驱猎鹰500',
        energyType: '增程式',
        batteryCapacity: '34.3 kWh',
        rangeKm: 210,
        drivetrain: '两驱',
        bodyType: '中大型 SUV',
        dimensions: '5055 × 1976 × 1855 mm',
        wheelbase: '2910 mm',
        motorPower: '252 Ps',
        seats: '5 座',
        fastCharge: '以官方配置为准',
        slowCharge: '以官方配置为准',
        officialPrice: '16.68 万元起',
        notes: '网页 fallback 导入：汽车之家/易车/什么值得买公开参数。',
        specs: [
          ['基础信息', '品牌', '奇瑞 iCAR'],
          ['基础信息', '车型', 'V27'],
          ['基础信息', '版本', '210KM 两驱猎鹰500'],
          ['基础信息', '能源类型', '增程式'],
          ['基础信息', '级别', '中大型 SUV'],
          ['基础信息', '国内指导价参考', '16.68 万元起'],
          ['车身', '长宽高', '5055 × 1976 × 1855 mm'],
          ['车身', '轴距', '2910 mm'],
          ['车身', '车身结构', '5 门 5 座 SUV'],
          ['动力', '发动机排量', '1.5T 增程器'],
          ['动力', '电机马力', '252 Ps'],
          ['电池/续航', '电池容量', '34.3 kWh'],
          ['电池/续航', 'CLTC 纯电续航', '210 km'],
        ],
      },
    ],
  },
  {
    key: '五菱 星光S EV',
    url: 'https://www.sgmw.com.cn/carDetail?id=304',
    requiredText: '五菱星光S 2025款',
    profiles: [
      {
        brand: '五菱',
        model: '星光S EV',
        year: '2025',
        trim: '510km 纯电版',
        energyType: '纯电动',
        batteryCapacity: '以官方配置为准',
        rangeKm: 510,
        drivetrain: '前驱',
        bodyType: '紧凑型 SUV',
        dimensions: '以官方配置为准',
        wheelbase: '2800 mm',
        motorPower: '以官方配置为准',
        seats: '5 座',
        fastCharge: '以官方配置为准',
        slowCharge: '以官方配置为准',
        officialPrice: '10.98-13.98 万元',
        notes: '五菱官网公开资料 fallback 导入，后续可继续细化到完整版本表。',
        specs: [
          ['基础信息', '品牌', '五菱'],
          ['基础信息', '车型', '星光S EV'],
          ['基础信息', '版本', '510km 纯电版'],
          ['基础信息', '能源类型', '纯电动'],
          ['基础信息', '级别', '紧凑型 SUV'],
          ['基础信息', '国内指导价参考', '10.98-13.98 万元'],
          ['车身', '轴距', '2800 mm'],
          ['车身', '座位数', '5 座'],
          ['电池/续航', 'CLTC 纯电续航', '510 km'],
        ],
      },
    ],
  },
  {
    key: '五菱 星光L',
    url: 'https://car.autohome.com.cn/config/series/8468.html',
    requiredText: '星光L',
    profiles: [
      {
    brand: '五菱',
    model: '星光L',
    year: '2026',
    trim: '260km 六座舒享型',
    energyType: '插电式混合动力',
    batteryCapacity: '以官方配置为准',
    rangeKm: 260,
    drivetrain: '前置前驱',
    bodyType: '中大型 SUV',
    dimensions: '4980 × 1930 × 1760 mm',
    wheelbase: '2950 mm',
    motorPower: '以官方配置为准',
    seats: '6 座',
    fastCharge: '0.25 小时',
    slowCharge: '6.3 小时',
    officialPrice: '12.28-14.28 万元预售价',
    sourceUrl: 'https://car.autohome.com.cn/diandongche/series-8468.html',
    notes: '星光L公开资料补录，官方名称不带 EV，能源类型为插电式混合动力。',
    specs: [
      ['基础信息', '品牌', '五菱'],
      ['基础信息', '车型', '星光L'],
      ['基础信息', '版本', '260km 六座舒享型'],
      ['基础信息', '能源类型', '插电式混合动力'],
      ['基础信息', '级别', '中大型 SUV'],
      ['基础信息', '国内指导价参考', '12.28-14.28 万元预售价'],
      ['车身', '长宽高', '4980 × 1930 × 1760 mm'],
      ['车身', '轴距', '2950 mm'],
      ['车身', '车身结构', '5 门 6 座 SUV'],
      ['车身', '座位数', '6 座'],
      ['动力', '发动机排量', '1.5L'],
      ['动力', '驱动方式', '前置前驱'],
      ['电池/续航', 'CLTC 纯电续航', '260 km'],
      ['充电', '快充时间', '0.25 小时'],
      ['充电', '慢充时间', '6.3 小时'],
    ],
      },
    ],
  },
  {
    key: '五菱 星光730 EV',
    url: 'https://db.m.auto.sohu.com/model_7707/config?selectedTrimId=182473&sliding=1',
    requiredText: '五菱星光730 EV',
    profiles: [
      {
    brand: '五菱',
    model: '星光730 EV',
    year: '2026',
    trim: '500km 尊享型',
    energyType: '纯电动',
    batteryCapacity: '60 kWh',
    rangeKm: 500,
    drivetrain: '前驱',
    bodyType: '紧凑型 MPV',
    dimensions: '4910 × 1850 × 1770 mm',
    wheelbase: '2910 mm',
    motorPower: '100 kW',
    seats: '7 座',
    fastCharge: '以官方配置为准',
    slowCharge: '以官方配置为准',
    officialPrice: '10.98 万元起',
    sourceUrl: 'https://www.xchuxing.com/car/series/1577',
    notes: '星光730 EV公开资料补录，后续可用官方配置表继续细化。',
    specs: [
      ['基础信息', '品牌', '五菱'],
      ['基础信息', '车型', '星光730 EV'],
      ['基础信息', '版本', '500km 尊享型'],
      ['基础信息', '能源类型', '纯电动'],
      ['基础信息', '级别', '紧凑型 MPV'],
      ['基础信息', '国内指导价参考', '10.98 万元起'],
      ['车身', '长宽高', '4910 × 1850 × 1770 mm'],
      ['车身', '轴距', '2910 mm'],
      ['车身', '车身结构', '5 门 7 座 MPV'],
      ['车身', '座位数', '7 座'],
      ['动力', '电机功率', '100 kW'],
      ['动力', '驱动方式', '前驱'],
      ['电池/续航', '电池容量', '60 kWh'],
      ['电池/续航', 'CLTC 纯电续航', '500 km'],
      ['能耗', '百公里耗电', '13.6 kWh/100km'],
    ],
      },
    ],
  },
  {
    key: '五菱 华境S',
    url: 'https://www.wuling.com/carDetail?id=325',
    requiredText: '华境S',
    profiles: [
      {
    brand: '五菱',
    model: '华境S',
    year: '2026',
    trim: '200km 乾崑悦享版',
    energyType: '插电式混合动力',
    batteryCapacity: '31 kWh',
    rangeKm: 200,
    drivetrain: '前置前驱',
    bodyType: '大型 SUV',
    dimensions: '5235 × 1999 × 1800 mm',
    wheelbase: '3105 mm',
    motorPower: '以官方配置为准',
    seats: '6 座',
    fastCharge: '14 分钟',
    slowCharge: '9.5 小时',
    officialPrice: '14.98 万元',
    sourceUrl: 'https://www.wuling.com/carDetail?id=325',
    notes: '华境S官网参数页导入，按网页四个版本拆分。',
    specs: [
      ['基础信息', '品牌', '五菱'],
      ['基础信息', '车型', '华境S'],
      ['基础信息', '版本', '200km 乾崑悦享版'],
      ['基础信息', '能源类型', '插电式混合动力'],
      ['基础信息', '级别', '大型 SUV'],
      ['基础信息', '国内指导价参考', '14.98 万元'],
      ['车身', '长宽高', '5235 × 1999 × 1800 mm'],
      ['车身', '轴距', '3105 mm'],
      ['车身', '车身结构', '5 门 6 座 SUV'],
      ['车身', '座位数', '6 座'],
      ['动力', '发动机排量', '1.5T'],
      ['动力', '驱动方式', '前置前驱'],
      ['电池/续航', '电池类型', '磷酸铁锂电池'],
      ['电池/续航', '电池特有技术', '神炼电池'],
      ['电池/续航', '电池容量', '31 kWh'],
      ['电池/续航', 'CLTC 纯电续航', '200 km'],
      ['充电', '电池充电倍率', '3C'],
      ['充电', '快充时间', '14 分钟'],
      ['充电', '慢充时间', '9.5 小时'],
      ['辅助驾驶', '驾驶辅助级别', '华为乾崑 ADS / 以版本配置为准'],
      ['座舱/舒适', '车联网/OTA', '鸿蒙座舱 HarmonySpace / 以版本配置为准'],
    ],
      },
      {
    brand: '五菱',
    model: '华境S',
    year: '2026',
    trim: '255km 乾崑臻享版',
    energyType: '插电式混合动力',
    batteryCapacity: '41.9 kWh',
    rangeKm: 255,
    drivetrain: '前置前驱',
    bodyType: '大型 SUV',
    dimensions: '5235 × 1999 × 1800 mm',
    wheelbase: '3105 mm',
    motorPower: '以官方配置为准',
    seats: '6 座',
    fastCharge: '12 分钟',
    slowCharge: '6 小时',
    officialPrice: '16.58 万元',
    sourceUrl: 'https://www.wuling.com/carDetail?id=325',
    notes: '华境S官网参数页导入，按网页四个版本拆分。',
    specs: [
      ['基础信息', '品牌', '五菱'],
      ['基础信息', '车型', '华境S'],
      ['基础信息', '版本', '255km 乾崑臻享版'],
      ['基础信息', '能源类型', '插电式混合动力'],
      ['基础信息', '级别', '大型 SUV'],
      ['基础信息', '国内指导价参考', '16.58 万元'],
      ['车身', '长宽高', '5235 × 1999 × 1800 mm'],
      ['车身', '轴距', '3105 mm'],
      ['车身', '车身结构', '5 门 6 座 SUV'],
      ['车身', '座位数', '6 座'],
      ['动力', '发动机排量', '1.5T'],
      ['动力', '驱动方式', '前置前驱'],
      ['电池/续航', '电池类型', '磷酸铁锂电池'],
      ['电池/续航', '电池特有技术', '神炼电池'],
      ['电池/续航', '电池容量', '41.9 kWh'],
      ['电池/续航', 'CLTC 纯电续航', '255 km'],
      ['充电', '电池充电倍率', '3.5C'],
      ['充电', '快充时间', '12 分钟'],
      ['充电', '慢充时间', '6 小时'],
      ['辅助驾驶', '驾驶辅助级别', '华为乾崑 ADS / 以版本配置为准'],
      ['座舱/舒适', '车联网/OTA', '鸿蒙座舱 HarmonySpace / 以版本配置为准'],
    ],
      },
      {
    brand: '五菱',
    model: '华境S',
    year: '2026',
    trim: '255km 乾崑尊享版',
    energyType: '插电式混合动力',
    batteryCapacity: '41.9 kWh',
    rangeKm: 255,
    drivetrain: '前置前驱',
    bodyType: '大型 SUV',
    dimensions: '5235 × 1999 × 1800 mm',
    wheelbase: '3105 mm',
    motorPower: '以官方配置为准',
    seats: '6 座',
    fastCharge: '12 分钟',
    slowCharge: '6 小时',
    officialPrice: '17.58 万元',
    sourceUrl: 'https://www.wuling.com/carDetail?id=325',
    notes: '华境S官网参数页导入，按网页四个版本拆分。',
    specs: [
      ['基础信息', '品牌', '五菱'],
      ['基础信息', '车型', '华境S'],
      ['基础信息', '版本', '255km 乾崑尊享版'],
      ['基础信息', '能源类型', '插电式混合动力'],
      ['基础信息', '级别', '大型 SUV'],
      ['基础信息', '国内指导价参考', '17.58 万元'],
      ['车身', '长宽高', '5235 × 1999 × 1800 mm'],
      ['车身', '轴距', '3105 mm'],
      ['车身', '车身结构', '5 门 6 座 SUV'],
      ['车身', '座位数', '6 座'],
      ['动力', '发动机排量', '1.5T'],
      ['动力', '驱动方式', '前置前驱'],
      ['电池/续航', '电池类型', '磷酸铁锂电池'],
      ['电池/续航', '电池特有技术', '神炼电池'],
      ['电池/续航', '电池容量', '41.9 kWh'],
      ['电池/续航', 'CLTC 纯电续航', '255 km'],
      ['充电', '电池充电倍率', '3.5C'],
      ['充电', '快充时间', '12 分钟'],
      ['充电', '慢充时间', '6 小时'],
      ['辅助驾驶', '驾驶辅助级别', '华为乾崑 ADS / 以版本配置为准'],
      ['座舱/舒适', '车联网/OTA', '鸿蒙座舱 HarmonySpace / 以版本配置为准'],
    ],
      },
      {
    brand: '五菱',
    model: '华境S',
    year: '2026',
    trim: '235km 四驱乾崑尊享版',
    energyType: '插电式混合动力',
    batteryCapacity: '41.9 kWh',
    rangeKm: 235,
    drivetrain: '前置+后置四驱',
    bodyType: '大型 SUV',
    dimensions: '5235 × 1999 × 1800 mm',
    wheelbase: '3105 mm',
    motorPower: '以官方配置为准',
    seats: '6 座',
    fastCharge: '12 分钟',
    slowCharge: '6 小时',
    officialPrice: '19.38 万元',
    sourceUrl: 'https://www.wuling.com/carDetail?id=325',
    notes: '华境S官网参数页导入，按网页四个版本拆分。',
    specs: [
      ['基础信息', '品牌', '五菱'],
      ['基础信息', '车型', '华境S'],
      ['基础信息', '版本', '235km 四驱乾崑尊享版'],
      ['基础信息', '能源类型', '插电式混合动力'],
      ['基础信息', '级别', '大型 SUV'],
      ['基础信息', '国内指导价参考', '19.38 万元'],
      ['车身', '长宽高', '5235 × 1999 × 1800 mm'],
      ['车身', '轴距', '3105 mm'],
      ['车身', '车身结构', '5 门 6 座 SUV'],
      ['车身', '座位数', '6 座'],
      ['动力', '发动机排量', '1.5T'],
      ['动力', '驱动方式', '前置+后置四驱'],
      ['动力', '驱动电机数', '双电机'],
      ['电池/续航', '电池类型', '磷酸铁锂电池'],
      ['电池/续航', '电池特有技术', '神炼电池'],
      ['电池/续航', '电池容量', '41.9 kWh'],
      ['电池/续航', 'CLTC 纯电续航', '235 km'],
      ['充电', '电池充电倍率', '3.5C'],
      ['充电', '快充时间', '12 分钟'],
      ['充电', '慢充时间', '6 小时'],
      ['辅助驾驶', '驾驶辅助级别', '华为乾崑 ADS / 以版本配置为准'],
      ['座舱/舒适', '车联网/OTA', '鸿蒙座舱 HarmonySpace / 以版本配置为准'],
    ],
      },
    ],
  },
]

const wantedSpecNames = new Set([
  '上市时间',
  '长*宽*高(mm)',
  '长度(mm)',
  '宽度(mm)',
  '高度(mm)',
  '轴距(mm)',
  '车身结构',
  '座位数(个)',
  '整备质量(kg)',
  '电动机总功率(kW)',
  '电动机总扭矩(N·m)',
  '前电动机最大功率(kW)',
  '后电动机最大功率(kW)',
  '驱动方式',
  '驱动电机数',
  'CLTC纯电续航里程(km)',
  '工信部纯电续航里程(km)',
  '电池能量(kWh)',
  '电池类型',
  '电池特有技术',
  '电池快充时间(小时)_x',
  '电池快充时间(小时)_y',
  '电池慢充时间(小时)_x',
  '电池慢充时间(小时)_y',
  '快充电量(%)',
  '快充功能',
  '快充功率(kW)',
  '快充接口位置',
  '慢充接口位置',
  '慢充时间(小时)',
  '百公里耗电量(kWh/100km)',
  '最高车速(km/h)',
  '官方0-100km/h加速(s)',
  '前悬架类型',
  '后悬架类型',
  '助力类型',
  '车体结构',
  '前制动器类型',
  '后制动器类型',
  '驻车制动类型',
  '前轮胎规格',
  '后轮胎规格',
  '天窗类型',
  '车顶行李架',
  '远光灯光源',
  '近光灯光源',
  '外后视镜功能',
  '前/后驻车雷达',
  '驾驶辅助影像',
  '透明底盘/540度影像',
  '超声波雷达数量',
  '毫米波雷达数量',
  '激光雷达数量',
  '激光雷达线数',
  '激光雷达品牌',
  '激光雷达型号',
  '主动刹车/主动安全系统',
  '车道偏离预警系统',
  '车道保持辅助系统',
  '车道居中保持',
  '辅助泊车入位',
  '车身稳定控制(ESC/ESP/DSC等)',
  '胎压监测功能',
  '主/副驾驶座安全气囊',
  '前/后排侧气囊',
  '前/后排头部气囊(气帘)',
  '前排中间气囊',
  'ISOFIX儿童座椅接口',
  '驾驶辅助级别',
  '巡航系统',
  '360度全景影像',
  '中控彩色屏幕',
  '中控屏幕类型',
  '中控屏幕尺寸',
  '中控屏幕分辨率',
  '车机智能芯片',
  '车机系统内存(GB)',
  '车机系统存储(GB)',
  '车联网',
  'OTA升级',
  '座椅材质',
  '主座椅调节方式',
  '副座椅调节方式',
  '前排座椅功能',
  '第二排座椅调节',
  '第二排座椅功能',
  '后排座椅放倒形式',
  '电动座椅记忆功能',
  '零重力座椅',
  '无钥匙进入功能',
  '无钥匙启动系统',
  '钥匙类型',
  '空调温度控制方式',
  '后排独立空调',
  '热泵空调',
  '对外放电',
  '音响品牌',
  '扬声器数量',
  '扬声器品牌名称',
])

function shouldImportSpec(groupName) {
  return groupName !== '基础信息'
}

const profileFields = {
  name: ['车型名称'],
  energyType: ['能源类型'],
  price: ['厂商指导价(元)'],
  bodyType: ['级别', '车身结构'],
  dimensions: ['长*宽*高(mm)'],
  wheelbase: ['轴距(mm)'],
  seats: ['座位数(个)'],
  motorPower: ['电动机总功率(kW)', '前电动机最大功率(kW)', '后电动机最大功率(kW)'],
  batteryCapacity: ['电池能量(kWh)'],
  range: ['CLTC纯电续航里程(km)', '工信部纯电续航里程(km)'],
  drivetrain: ['驱动方式', '驱动电机数'],
  fastCharge: ['电池快充时间(小时)_x', '电池快充时间(小时)_y'],
  slowCharge: ['慢充时间(小时)'],
}

function ensureDataset() {
  if (existsSync(dataDir)) return
  if (existsSync(dataRoot)) rmSync(dataRoot, { recursive: true, force: true })
  execFileSync('git', ['clone', '--depth', '1', repoUrl, dataRoot], { stdio: 'inherit' })
}

function printSourcePolicy() {
  console.log('Source policy: 1) AutoHome / Dongchedi first; 2) official manufacturer pages; 3) other large auto sites as fallback.')
  console.log(`Audit policy: ${auditPolicy.join(' ')}`)
}

function parseCsv(content) {
  const rows = []
  let row = []
  let value = ''
  let quoted = false
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index]
    const next = content[index + 1]
    if (quoted) {
      if (char === '"' && next === '"') {
        value += '"'
        index += 1
      } else if (char === '"') {
        quoted = false
      } else {
        value += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(value)
      value = ''
    } else if (char === '\n') {
      row.push(value.replace(/\r$/, ''))
      rows.push(row)
      row = []
      value = ''
    } else {
      value += char
    }
  }
  if (value || row.length) {
    row.push(value.replace(/\r$/, ''))
    rows.push(row)
  }
  return rows.filter((current) => current.some((cell) => cell.trim()))
}

function normalizeSpecName(name) {
  return name.replace(/_(x|y)$/i, '').trim()
}

function cleanValue(value) {
  return String(value ?? '').trim()
}

function get(rowMap, columnIndex, names) {
  for (const name of names) {
    for (const candidate of [name, `${name}_x`, `${name}_y`]) {
      const row = rowMap.get(candidate)
      const value = row ? cleanValue(row[columnIndex]) : ''
      if (value && value !== '-') return value
    }
  }
  return ''
}

function extractYear(name) {
  const match = String(name).match(/(20\d{2})款/)
  return match ? match[1] : ''
}

function extractTrim(seriesLabel, name, year) {
  return String(name)
    .replace(seriesLabel, '')
    .replace(`${year}款`, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function numericRange(value) {
  const match = String(value).match(/\d+/)
  return match ? Number(match[0]) : 0
}

function autohomeSpecUrl(specId) {
  return `https://car.autohome.com.cn/config/spec/${specId}.html`
}

function cleanHtmlValue(value) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractJsObject(html, variableName) {
  const marker = `var ${variableName} = `
  let index = html.indexOf(marker)
  if (index < 0) return null
  index += marker.length
  while (html[index] && html[index] !== '{') index += 1
  let depth = 0
  let inString = false
  let escape = false
  for (let cursor = index; cursor < html.length; cursor += 1) {
    const char = html[cursor]
    if (inString) {
      if (escape) escape = false
      else if (char === '\\') escape = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') depth += 1
    if (char === '}') {
      depth -= 1
      if (depth === 0) return JSON.parse(html.slice(index, cursor + 1))
    }
  }
  return null
}

function valueFromAutohomeItem(item, specId) {
  const valueItem = item.valueitems?.find((current) => String(current.specid) === String(specId))
  if (!valueItem) return ''
  const directValue = cleanHtmlValue(valueItem.value)
  if (directValue && directValue !== '-') return directValue
  const subValues = (valueItem.sublist || [])
    .filter((sub) => sub.subvalue !== 0 && sub.subvalue !== '0')
    .map((sub) => cleanHtmlValue(sub.subname || sub.subvalue))
    .filter(Boolean)
  if (subValues.length) return subValues.join(' / ')
  return directValue
}

async function fetchAutohomeSupplementSpecs(sourceUrl, specId) {
  if (!/^https:\/\/car\.autohome\.com\.cn\/config\/spec\/\d+\.html/.test(sourceUrl)) return []
  if (autohomeSupplementCache.has(sourceUrl)) return autohomeSupplementCache.get(sourceUrl)

  const response = await fetch(sourceUrl, {
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; EVExportProfileImporter/1.0)',
      accept: 'text/html,application/xhtml+xml',
    },
  })
  if (!response.ok) {
    autohomeSupplementCache.set(sourceUrl, [])
    return []
  }

  const html = await response.text()
  const config = extractJsObject(html, 'config')
  const option = extractJsObject(html, 'option')
  const supplementItems = [
    { source: config?.result?.paramtypeitems, listKey: 'paramitems', id: 1222, groupName: '制动/轮胎', name: '轮胎规格' },
    { source: config?.result?.paramtypeitems, listKey: 'paramitems', id: 9036, groupName: '电池/续航', name: '对外放电功率(kW)' },
    { source: option?.result?.configtypeitems, listKey: 'configitems', id: 50, groupName: '外部配置', name: '天窗类型' },
    { source: option?.result?.configtypeitems, listKey: 'configitems', id: 31, groupName: '辅助驾驶', name: '前/后驻车雷达' },
    { source: option?.result?.configtypeitems, listKey: 'configitems', id: 34, groupName: '辅助驾驶', name: '巡航系统' },
    { source: option?.result?.configtypeitems, listKey: 'configitems', id: 35, groupName: '辅助驾驶', name: '辅助泊车入位' },
    { source: option?.result?.configtypeitems, listKey: 'configitems', id: 66, groupName: '座舱/舒适', name: '钥匙类型' },
    { source: option?.result?.configtypeitems, listKey: 'configitems', id: 7623, groupName: '电池/续航', name: '对外放电' },
    { source: option?.result?.configtypeitems, listKey: 'configitems', id: 8438, groupName: '辅助驾驶', name: '超声波雷达数量' },
    { source: option?.result?.configtypeitems, listKey: 'configitems', id: 8439, groupName: '辅助驾驶', name: '毫米波雷达数量' },
    { source: option?.result?.configtypeitems, listKey: 'configitems', id: 110, groupName: '座舱/舒适', name: '中控彩色屏幕' },
    { source: option?.result?.configtypeitems, listKey: 'configitems', id: 111, groupName: '座舱/舒适', name: '中控屏幕尺寸' },
    { source: option?.result?.configtypeitems, listKey: 'configitems', id: 8772, groupName: '座舱/舒适', name: '中控屏幕分辨率' },
    { source: option?.result?.configtypeitems, listKey: 'configitems', id: 86, groupName: '座舱/舒适', name: '手机无线充电功能' },
    { source: option?.result?.configtypeitems, listKey: 'configitems', id: 87, groupName: '座舱/舒适', name: '座椅材质' },
    { source: option?.result?.configtypeitems, listKey: 'configitems', id: 90, groupName: '座舱/舒适', name: '主座椅调节方式' },
    { source: option?.result?.configtypeitems, listKey: 'configitems', id: 91, groupName: '座舱/舒适', name: '副座椅调节方式' },
    { source: option?.result?.configtypeitems, listKey: 'configitems', id: 92, groupName: '座舱/舒适', name: '电动座椅记忆功能' },
    { source: option?.result?.configtypeitems, listKey: 'configitems', id: 93, groupName: '座舱/舒适', name: '前排座椅功能' },
    { source: option?.result?.configtypeitems, listKey: 'configitems', id: 99, groupName: '座舱/舒适', name: '第二排座椅调节' },
    { source: option?.result?.configtypeitems, listKey: 'configitems', id: 105, groupName: '座舱/舒适', name: '后排座椅放倒形式' },
    { source: option?.result?.configtypeitems, listKey: 'configitems', id: 117, groupName: '座舱/舒适', name: '车联网' },
    { source: option?.result?.configtypeitems, listKey: 'configitems', id: 150, groupName: '座舱/舒适', name: '空调温度控制方式' },
    { source: option?.result?.configtypeitems, listKey: 'configitems', id: 8417, groupName: '座舱/舒适', name: '热泵空调' },
  ]

  const specs = []
  for (const supplement of supplementItems) {
    for (const group of supplement.source || []) {
      const item = (group[supplement.listKey] || []).find((current) => current.id === supplement.id)
      if (!item) continue
      const value = valueFromAutohomeItem(item, specId)
      if (!value) continue
      specs.push({
        groupName: supplement.groupName,
        name: supplement.name,
        value,
        sourceName: autohomeWebSupplementSourceName,
        sourceUrl,
      })
      break
    }
  }

  autohomeSupplementCache.set(sourceUrl, specs)
  return specs
}

function normalizeForAudit(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/×/g, 'x')
    .replace(/\*/g, 'x')
    .replace(/[，,。/（）()【】\[\]\s-]/g, '')
    .replace(/公里/g, 'km')
    .replace(/千瓦时/g, 'kwh')
    .replace(/小时/g, 'h')
    .replace(/分钟/g, 'min')
}

function auditTokens(value) {
  const normalized = normalizeForAudit(value)
  if (!normalized || normalized.includes('以官方配置为准') || normalized.includes('以版本配置为准')) return []
  const numbers = [...normalized.matchAll(/\d+(?:\.\d+)?/g)].map((match) => match[0])
  return numbers.length ? numbers : [normalized]
}

function auditValueCandidates(label, value) {
  const candidates = [String(value ?? '')]
  if (label === '车型') {
    const aliases = {
      '星光 EV': ['星光', '五菱星光'],
      '星光S EV': ['星光S', '五菱星光S'],
      'HYPTEC HT': ['昊铂HT'],
      '阿尔法T5': ['极狐 阿尔法T5'],
    }
    candidates.push(...(aliases[value] || []))
  }
  if (label === '版本') {
    candidates.push(String(value ?? '').replace(/^[A-Za-z0-9\u4e00-\u9fa5]+[\s·-]+/, ''))
  }
  if (label === '能源类型') {
    const aliases = {
      纯电动: ['纯电'],
      插电式混合动力: ['插混', '插电混动'],
      增程式: ['增程'],
    }
    candidates.push(...(aliases[value] || []))
  }
  return [...new Set(candidates.filter(Boolean))]
}

function groupForSpec(name) {
  if (/车型|厂商|级别|能源|上市|环保|整车|保修/.test(name)) return '基础信息'
  if (/速度|加速|车速/.test(name)) return '性能'
  if (/充电|快充|慢充/.test(name)) return '充电'
  if (/电池|续航|电量|耗电|对外放电/.test(name)) return '电池/续航'
  if (/制动|轮胎|驻车/.test(name)) return '制动/轮胎'
  if (/长|宽|高|轴距|座位|车身|整备|质量|行李厢|车门/.test(name)) return '车身'
  if (/电动机|发动机|功率|扭矩|驱动|电机|变速箱/.test(name)) return '动力'
  if (/悬架|助力|车体|转向/.test(name)) return '底盘/转向'
  if (/天窗|车顶|车窗|后视镜|灯|轮圈|外观/.test(name)) return '外部配置'
  if (/刹车|安全|气囊|稳定|胎压|预警|哨兵/.test(name)) return '安全配置'
  if (/辅助|巡航|泊车|影像|雷达|驾驶|导航/.test(name)) return '辅助驾驶'
  if (/座椅|屏|车机|音响|空调|方向盘|无线|蓝牙|OTA|车联网|香氛/.test(name)) return '座舱/舒适'
  return '配置'
}

function tableFor(fileName) {
  const rows = parseCsv(readFileSync(join(dataDir, fileName), 'utf8'))
  const rowMap = new Map()
  for (const row of rows.slice(1)) {
    if (row[0]) rowMap.set(row[0].trim(), row)
  }
  return { header: rows[0], rowMap }
}

function upsertProfile(db, profile) {
  db.prepare(`
    INSERT INTO vehicle_profiles (
      brand, model, year, trim, energy_type, battery_capacity, range_km,
      drivetrain, body_type, dimensions, wheelbase, motor_power, seats,
      fast_charge_time, slow_charge_time, official_price, source_url, notes,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(brand, model, year, trim) DO UPDATE SET
      energy_type = excluded.energy_type,
      battery_capacity = excluded.battery_capacity,
      range_km = excluded.range_km,
      drivetrain = excluded.drivetrain,
      body_type = excluded.body_type,
      dimensions = excluded.dimensions,
      wheelbase = excluded.wheelbase,
      motor_power = excluded.motor_power,
      seats = excluded.seats,
      fast_charge_time = excluded.fast_charge_time,
      slow_charge_time = excluded.slow_charge_time,
      official_price = excluded.official_price,
      source_url = excluded.source_url,
      notes = excluded.notes,
      updated_at = excluded.updated_at
  `).run(
    profile.brand,
    profile.model,
    profile.year,
    profile.trim,
    profile.energyType || '纯电',
    profile.batteryCapacity,
    profile.rangeKm,
    profile.drivetrain,
    profile.bodyType,
    profile.dimensions,
    profile.wheelbase,
    profile.motorPower,
    profile.seats,
    profile.fastCharge,
    profile.slowCharge,
    profile.officialPrice,
    profile.sourceUrl || sourceUrl,
    profile.notes,
    profile.now,
    profile.now,
  )
  return db.prepare(`
    SELECT id FROM vehicle_profiles
    WHERE brand = ? AND model = ? AND year = ? AND trim = ?
  `).get(profile.brand, profile.model, profile.year, profile.trim).id
}

function upsertSpec(db, profileId, spec, sortOrder, now) {
  db.prepare(`
    INSERT INTO vehicle_profile_specs (
      profile_id, group_name, spec_name, spec_value, sort_order,
      source_name, source_url, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(profile_id, group_name, spec_name) DO UPDATE SET
      spec_value = excluded.spec_value,
      sort_order = excluded.sort_order,
      source_name = excluded.source_name,
      source_url = excluded.source_url,
      updated_at = excluded.updated_at
  `).run(
    profileId,
    spec.groupName,
    spec.name,
    spec.value,
    sortOrder,
    spec.sourceName || sourceName,
    spec.sourceUrl || sourceUrl,
    now,
    now,
  )
}

async function importWebFallback(db, series, now) {
  const key = `${series.brand} ${series.model}`
  const candidates = webFallbacks
    .filter((item) => item.key === key)
    .sort((left, right) => sourcePriority(left.url).rank - sourcePriority(right.url).rank)
  if (!candidates.length) return { imported: 0, reason: 'no web fallback' }

  let fallback = null
  let lastReason = 'no matching web source'
  for (const candidate of candidates) {
    const response = await fetch(candidate.url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; EVExportProfileImporter/1.0)',
        accept: 'text/html,application/xhtml+xml',
      },
    })
    if (!response.ok) {
      lastReason = `web ${response.status}`
      continue
    }

    const html = await response.text()
    if (candidate.requiredText && !html.includes(candidate.requiredText)) {
      lastReason = 'web page unmatched'
      continue
    }
    fallback = candidate
    break
  }
  if (!fallback) return { imported: 0, reason: lastReason }

  const priority = sourcePriority(fallback.url)

  for (const profile of fallback.profiles) {
    const profileId = upsertProfile(db, {
      ...profile,
      sourceUrl: fallback.url,
      notes: `${profile.notes} Source priority: ${priority.name}. Source page fetched automatically when CSV data was unavailable or outdated.`,
      now,
    })
    profile.specs.forEach(([groupName, name, value], index) => {
        if (!shouldImportSpec(groupName)) return
        upsertSpec(db, profileId, {
          groupName,
        name,
        value,
        sourceName: profile.notes,
        sourceUrl: fallback.url,
      }, index + 1, now)
    })
  }

  return { imported: fallback.profiles.length, reason: `web fallback: ${priority.name}` }
}

function refreshImportedProfiles(db) {
  const urls = [
    sourceUrl,
    'https://car.autohome.com.cn/diandongche/series-8468.html',
    'https://www.xchuxing.com/car/series/1577',
    'https://www.wuling.com/mobile/huajing',
    ...webFallbacks.map((fallback) => fallback.url),
  ]
  const placeholders = urls.map(() => '?').join(', ')
  const importedProfileIds = db.prepare(`
    SELECT id FROM vehicle_profiles
    WHERE source_url IN (${placeholders})
       OR source_url LIKE 'https://car.autohome.com.cn/config/spec/%'
  `).all(...urls)

  const deleteSpecs = db.prepare('DELETE FROM vehicle_profile_specs WHERE profile_id = ?')
  const deleteProfile = db.prepare('DELETE FROM vehicle_profiles WHERE id = ?')
  for (const { id } of importedProfileIds) {
    deleteSpecs.run(id)
    deleteProfile.run(id)
  }
}

function normalizeLegacyProfileNames(db) {
  const legacyProfiles = [
    { fromBrand: 'BYD', fromModel: 'Song Plus EV', toBrand: 'BYD', toModel: '宋PLUS EV' },
    { fromBrand: 'Changan', fromModel: 'Deepal S07', toBrand: '长安', toModel: '深蓝S07' },
    { fromBrand: 'Geely', fromModel: 'Galaxy E5', toBrand: '吉利银河', toModel: '银河E5' },
  ]
  const findTarget = db.prepare(`
    SELECT id FROM vehicle_profiles
    WHERE brand = ? AND model = ? AND year = ? AND trim = ?
  `)
  const legacyRows = db.prepare(`
    SELECT id, year, trim FROM vehicle_profiles
    WHERE brand = ? AND model = ?
  `)
  const updateProfile = db.prepare('UPDATE vehicle_profiles SET brand = ?, model = ?, updated_at = ? WHERE id = ?')
  const deleteSpecs = db.prepare('DELETE FROM vehicle_profile_specs WHERE profile_id = ?')
  const deleteProfile = db.prepare('DELETE FROM vehicle_profiles WHERE id = ?')
  const now = new Date().toISOString()

  for (const legacy of legacyProfiles) {
    for (const row of legacyRows.all(legacy.fromBrand, legacy.fromModel)) {
      const target = findTarget.get(legacy.toBrand, legacy.toModel, row.year, row.trim)
      if (target) {
        deleteSpecs.run(row.id)
        deleteProfile.run(row.id)
      } else {
        updateProfile.run(legacy.toBrand, legacy.toModel, now, row.id)
      }
    }
  }
}

async function fetchSourceHtml(cache, url) {
  if (cache.has(url)) return cache.get(url)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12000)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; EVExportProfileAuditor/1.0)',
        accept: 'text/html,application/xhtml+xml',
      },
    })
    const html = response.ok ? await response.text() : ''
    cache.set(url, { ok: response.ok, status: response.status, html })
    return cache.get(url)
  } catch (error) {
    cache.set(url, { ok: false, status: error.name === 'AbortError' ? 'timeout' : 'fetch-error', html: '' })
    return cache.get(url)
  } finally {
    clearTimeout(timeout)
  }
}

function auditField(pageText, label, value) {
  const candidateTokenGroups = auditValueCandidates(label, value).map(auditTokens).filter((tokens) => tokens.length)
  if (!candidateTokenGroups.length) return null
  const matched = candidateTokenGroups.some((tokens) => tokens.some((token) => pageText.includes(token)))
  if (matched) return null

  if (label === '车型' || label === '版本') {
    return { field: label, value, category: 'source-name-policy' }
  }
  if (label === '指导价') {
    return { field: label, value, category: 'rendered-price-check' }
  }
  if (label === '长宽高' || label === '轴距' || label === '快充') {
    return { field: label, value, category: 'format-or-render-check' }
  }
  return { field: label, value, category: 'data-mismatch' }
}

async function auditImportedProfiles(db) {
  const rows = db.prepare(`
    SELECT id, brand, model, year, trim, energy_type, battery_capacity,
           range_km, dimensions, wheelbase, motor_power, seats, fast_charge_time,
           official_price, source_url
    FROM vehicle_profiles
    WHERE source_url LIKE 'http%'
      AND (
        source_url LIKE 'https://car.autohome.com.cn/config/spec/%'
        OR source_url IN (${webFallbacks.map(() => '?').join(', ')})
      )
    ORDER BY brand, model, year, trim
  `).all(...webFallbacks.map((fallback) => fallback.url))

  const cache = new Map()
  const issues = []
  let checked = 0
  for (const row of rows) {
    const source = await fetchSourceHtml(cache, row.source_url)
    if (!source.ok) {
      issues.push({
        model: `${row.brand} ${row.model} ${row.year} ${row.trim}`,
        source: row.source_url,
        reason: `source unavailable: ${source.status}`,
      })
      continue
    }

    const pageText = normalizeForAudit(source.html)
    const modelLabel = `${row.brand} ${row.model} ${row.year} ${row.trim}`
    const fieldIssues = [
      auditField(pageText, '车型', row.model),
      auditField(pageText, '版本', row.trim),
      auditField(pageText, '能源类型', row.energy_type),
      auditField(pageText, '续航', row.range_km ? `${row.range_km}` : ''),
      auditField(pageText, '电池容量', row.battery_capacity),
      auditField(pageText, '长宽高', row.dimensions),
      auditField(pageText, '轴距', row.wheelbase),
      auditField(pageText, '电机功率', row.motor_power),
      auditField(pageText, '座位数', row.seats),
      auditField(pageText, '快充', row.fast_charge_time),
      auditField(pageText, '指导价', row.official_price),
    ].filter(Boolean)

    checked += 1
    const actionableIssues = fieldIssues.filter((issue) => issue.category === 'data-mismatch')
    const autoPolicyIssues = fieldIssues.filter((issue) => issue.category !== 'data-mismatch')
    if (actionableIssues.length || autoPolicyIssues.length) {
      issues.push({
        model: modelLabel,
        source: row.source_url,
        needsUserReview: actionableIssues.length ? 'yes' : 'no',
        reason: fieldIssues.map((issue) => `${issue.field}=${issue.value}`).join('; '),
        category: [...new Set(fieldIssues.map((issue) => issue.category))].join(', '),
      })
    }
  }

  return {
    checked,
    sourceCount: cache.size,
    passed: checked - issues.length,
    userReviewCount: issues.filter((issue) => issue.needsUserReview === 'yes').length,
    issues,
  }
}

async function main() {
  printSourcePolicy()
  ensureDataset()
  if (!existsSync(dbPath)) {
    mkdirSync(join(process.cwd(), 'data'), { recursive: true })
  }

  const db = new DatabaseSync(dbPath)
  const now = new Date().toISOString()
  const stats = []
  let audit = null

  db.exec('BEGIN')
  try {
    refreshImportedProfiles(db)
    for (const series of targetSeries) {
      if (series.webOnly) {
        const fallbackResult = await importWebFallback(db, series, now)
        stats.push({ model: `${series.brand} ${series.model}`, ...fallbackResult })
        continue
      }

      const filePath = join(dataDir, series.file)
      if (!existsSync(filePath)) {
        const fallbackResult = await importWebFallback(db, series, now)
        stats.push({
          model: `${series.brand} ${series.model}`,
          imported: fallbackResult.imported,
          reason: fallbackResult.imported ? fallbackResult.reason : 'missing csv',
        })
        continue
      }

      const { header, rowMap } = tableFor(series.file)
      let imported = 0
      for (let columnIndex = 1; columnIndex < header.length; columnIndex += 1) {
        const specId = cleanValue(header[columnIndex])
        const profileSourceUrl = /^\d+$/.test(specId) ? autohomeSpecUrl(specId) : sourceUrl
        const fullName = get(rowMap, columnIndex, profileFields.name)
        if (!fullName || (series.modelFilter && !series.modelFilter.test(fullName))) continue
        const energyType = get(rowMap, columnIndex, profileFields.energyType)
        if (series.pureElectricOnly && energyType !== '纯电动') continue
        const year = extractYear(fullName)
        if (!year || (!series.allowOlderYears && Number(year) < 2025)) continue
        const trim = extractTrim(fullName.split(' ')[0], fullName, year) || fullName
        const batteryCapacity = get(rowMap, columnIndex, profileFields.batteryCapacity)
        const rangeValue = get(rowMap, columnIndex, profileFields.range)
        const profileId = upsertProfile(db, {
          brand: series.brand,
          model: series.model,
          year,
          trim,
          energyType,
          batteryCapacity: batteryCapacity ? `${batteryCapacity} kWh`.replace(/kWh kWh$/i, 'kWh') : '',
          rangeKm: numericRange(rangeValue),
          drivetrain: get(rowMap, columnIndex, profileFields.drivetrain),
          bodyType: get(rowMap, columnIndex, profileFields.bodyType),
          dimensions: get(rowMap, columnIndex, profileFields.dimensions),
          wheelbase: get(rowMap, columnIndex, profileFields.wheelbase),
          motorPower: get(rowMap, columnIndex, profileFields.motorPower),
          seats: get(rowMap, columnIndex, profileFields.seats),
          fastCharge: get(rowMap, columnIndex, profileFields.fastCharge),
          slowCharge: get(rowMap, columnIndex, profileFields.slowCharge),
          officialPrice: get(rowMap, columnIndex, profileFields.price),
          sourceUrl: profileSourceUrl,
          notes: `Imported from ${basename(series.file)}. Missing future/unlisted models are skipped until public data is available.`,
          now,
        })

        let sortOrder = 1
        for (const row of rowMap.values()) {
          const rawName = row[0]
          const value = cleanValue(row[columnIndex])
          if (!rawName || !value || value === '-') continue
          if (!wantedSpecNames.has(rawName) && !wantedSpecNames.has(normalizeSpecName(rawName))) continue
          const groupName = groupForSpec(rawName)
          if (!shouldImportSpec(groupName)) continue
          upsertSpec(db, profileId, {
            groupName,
            name: normalizeSpecName(rawName),
            value,
            sourceName: autohomeSpecSourceName,
            sourceUrl: profileSourceUrl,
          }, sortOrder, now)
          sortOrder += 1
        }
        const webSupplementSpecs = await fetchAutohomeSupplementSpecs(profileSourceUrl, specId)
        for (const spec of webSupplementSpecs) {
          upsertSpec(db, profileId, spec, sortOrder, now)
          sortOrder += 1
        }
        imported += 1
      }
      if (imported === 0) {
        const fallbackResult = await importWebFallback(db, series, now)
        stats.push({ model: `${series.brand} ${series.model}`, ...fallbackResult })
      } else {
        stats.push({ model: `${series.brand} ${series.model}`, imported })
      }
    }
    normalizeLegacyProfileNames(db)
    audit = await auditImportedProfiles(db)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  } finally {
    db.close()
  }

  console.table(stats)
  if (audit) {
    console.log(`Audit checked ${audit.checked} profiles across ${audit.sourceCount} source pages. Passed: ${audit.passed}. Issues: ${audit.issues.length}. User review required: ${audit.userReviewCount}.`)
    if (audit.issues.length) {
      console.table(audit.issues.slice(0, 30))
      if (audit.issues.length > 30) {
        console.log(`Audit issue output truncated. Remaining issues: ${audit.issues.length - 30}`)
      }
    }
  }
  if (skippedFutureOrMissing.length) {
    console.log(`Skipped as unavailable/future in current source: ${skippedFutureOrMissing.join(', ')}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
