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
    const { name } = req.body;
    
    if (!name) {
      return res.json({ ok: false, msg: '用户名不能为空' });
    }
    
    const username = name.trim().toLowerCase();
    
    // 删除用户数据
    await kv.del(`user:${username}`);
    
    // 从所有列表中移除
    await kv.srem('users', username);
    await kv.srem('pending_users', username);
    
    // 删除用户的导出历史
    await kv.del(`export_history:${username}`);
    
    return res.json({ ok: true, msg: '用户已删除' });
    
  } catch (error) {
    console.error('Remove user error:', error);
    return res.status(500).json({ ok: false, msg: '服务器错误' });
  }
}
