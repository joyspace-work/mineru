import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('data/ev-export.db');
const FEISHU_BASE_TOKEN = 'Xvdfbpk7cadLrnsVCFFcHbhOnCb';
const FEISHU_SUPPLIERS_TABLE_ID = 'tblRnBLfMzZZQk7Z';

async function syncSuppliersFromFeishu() {
  try {
    const args = ['base', '+record-list', '--base-token', FEISHU_BASE_TOKEN, '--table-id', FEISHU_SUPPLIERS_TABLE_ID, '--as', 'user', '--limit', '200', '--format', 'json'];
    const result = execFileSync('lark-cli', args, { encoding: 'utf8', timeout: 15000 });
    const parsed = JSON.parse(result);
    if (!parsed.ok) return console.log('Parsed failed', parsed);
    const fields = parsed.data?.fields || [];
    const records = parsed.data?.data || [];
    const recordIds = parsed.data?.record_id_list || [];

    const channelTypeMapReverse = { '源头供应商': 'primary_source', '渠道商': 'distributor', '代理商': 'agent', '其他': 'unknown' };

    const localSuppliers = db.prepare('SELECT * FROM vehicle_source_suppliers').all();
    const localMapByRecordId = new Map(localSuppliers.filter(s => s.feishu_record_id).map(s => [s.feishu_record_id, s]));
    const localMapByName = new Map(localSuppliers.map(s => [s.supplier_name, s]));

    const feishuRecordIds = new Set(recordIds);

    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      const recordId = recordIds[i];
      const vals = {};
      if (Array.isArray(r)) {
        fields.forEach((name, j) => { vals[name] = r[j]; });
      }
      
      const supplierName = vals['Supplier Name'] || vals['供应商名称'] || '';
      if (!supplierName) continue;

      const contactName = vals['Contact Person'] || vals['联系人'] || '';
      const phone = vals['Phone'] || vals['电话'] || '';
      const wechat = vals['WeChat'] || vals['微信'] || '';
      const location = vals['Region'] || vals['区域'] || '';
      const channelTypeFeishu = vals['Channel Type'] || vals['渠道类型'] || '其他';
      const channelType = channelTypeMapReverse[channelTypeFeishu] || 'unknown';
      const status = vals['Status'] || vals['状态'] || 'Active';
      const isActive = status === 'Active' ? 1 : 0;
      const notes = vals['Notes'] || vals['备注'] || '';
      const createdAt = vals['Created At'] || vals['创建时间'] || new Date().toISOString();
      const updatedAt = new Date().toISOString();

      const existing = localMapByRecordId.get(recordId) || localMapByName.get(supplierName);

      if (existing) {
        db.prepare(`
          UPDATE vehicle_source_suppliers SET
            supplier_name = ?, contact_name = ?, phone = ?, wechat = ?, location = ?,
            channel_type = ?, notes = ?, is_active = ?, updated_at = ?, feishu_record_id = ?
          WHERE id = ?
        `).run(supplierName, contactName, phone, wechat, location, channelType, notes, isActive, updatedAt, recordId, existing.id);
      } else {
        db.prepare(`
          INSERT INTO vehicle_source_suppliers (
            supplier_name, contact_name, phone, wechat, location,
            channel_type, notes, is_active, created_by, created_at, updated_at, feishu_record_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(supplierName, contactName, phone, wechat, location, channelType, notes, isActive, 'system', createdAt, updatedAt, recordId);
      }
    }

    // Delete local ones no longer in Feishu
    for (const local of localSuppliers) {
      if (local.feishu_record_id && !feishuRecordIds.has(local.feishu_record_id)) {
        db.prepare('DELETE FROM vehicle_source_suppliers WHERE id = ?').run(local.id);
      }
    }
    console.log('Sync complete');
  } catch (err) {
    console.error('Fetch error:', err.message);
  }
}

await syncSuppliersFromFeishu();
const result = db.prepare('SELECT * FROM vehicle_source_suppliers').all();
console.log(result);
