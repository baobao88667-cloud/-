import { kv } from '../_db.js';

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, msg: 'Method not allowed' });
  }
  
  try {
    const { name, clearHistory } = req.body;
    
    if (!name) {
      return res.json({ ok: false, msg: '用户名不能为空' });
    }
    
    const username = name.trim().toLowerCase();
    
    // 检查用户是否存在
    const userData = await kv.hgetall(`user:${username}`);
    if (!userData) {
      return res.json({ ok: false, msg: '用户不存在' });
    }
    
    // 重置导出数量
    await kv.hset(`user:${username}`, { exportCount: '0' });
    
    // 如果需要，清空导出历史
    if (clearHistory) {
      await kv.del(`export_history:${username}`);
    }
    
    return res.json({ ok: true, msg: '导出数量已重置' });
    
  } catch (error) {
    console.error('Reset export error:', error);
    return res.status(500).json({ ok: false, msg: '服务器错误' });
  }
}
