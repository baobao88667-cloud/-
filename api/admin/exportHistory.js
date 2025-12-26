import { kv } from '../_db.js';

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, msg: 'Method not allowed' });
  }
  
  try {
    const { name, limit } = req.query;
    
    if (!name) {
      return res.json({ ok: false, msg: '用户名不能为空' });
    }
    
    const username = name.trim().toLowerCase();
    const maxRecords = Math.min(parseInt(limit) || 100, 500);
    
    // 获取用户信息
    const userData = await kv.hgetall(`user:${username}`);
    if (!userData) {
      return res.json({ ok: false, msg: '用户不存在' });
    }
    
    // 获取导出历史
    const historyRaw = await kv.lrange(`export_history:${username}`, 0, maxRecords - 1);
    const history = historyRaw.map(item => {
      try {
        return JSON.parse(item);
      } catch (e) {
        return null;
      }
    }).filter(Boolean);
    
    // 计算统计信息
    const totalCount = parseInt(userData.exportCount) || 0;
    const totalRecords = await kv.llen(`export_history:${username}`);
    
    return res.json({ 
      ok: true, 
      username: username,
      totalExportCount: totalCount,
      totalRecords: totalRecords,
      history: history
    });
    
  } catch (error) {
    console.error('Get export history error:', error);
    return res.status(500).json({ ok: false, msg: '服务器错误' });
  }
}
