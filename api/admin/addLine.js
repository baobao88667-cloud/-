import { kv } from '../_db.js';

/**
 * 添加线路/团队
 * POST /api/admin/addLine
 * Body: { name: string, quota?: number, quotaMode?: 'shared' | 'split' }
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, msg: 'Method not allowed' });
  
  try {
    const { name, quota, quotaMode } = req.body;
    
    if (!name || !name.trim()) {
      return res.json({ ok: false, msg: '团队名称不能为空' });
    }
    
    const lineName = name.trim();
    
    // 检查线路是否已存在
    const existing = await kv.hgetall(`line:${lineName}`);
    if (existing) {
      return res.json({ ok: false, msg: '该团队已存在' });
    }
    
    // 创建新线路
    await kv.hset(`line:${lineName}`, {
      name: lineName,
      quota: String(quota || 0),  // 0 表示无限制
      used: '0',
      quotaMode: quotaMode || 'shared',  // shared | split
      enabled: 'true',
      createdAt: new Date().toISOString()
    });
    
    // 添加到线路列表
    await kv.sadd('lines', lineName);
    
    const modeText = quotaMode === 'split' ? '平摊模式' : '共享模式';
    const quotaText = quota > 0 ? `配额 ${quota}` : '无限制';
    
    return res.json({ 
      ok: true, 
      msg: `团队 ${lineName} 创建成功（${modeText}，${quotaText}）` 
    });
    
  } catch (error) {
    console.error('Add line error:', error);
    return res.status(500).json({ ok: false, msg: '服务器错误' });
  }
}
