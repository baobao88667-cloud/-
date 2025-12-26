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
    const { name, enabled } = req.body;
    
    if (!name) {
      return res.json({ ok: false, msg: '用户名不能为空' });
    }
    
    const username = name.trim().toLowerCase();
    
    // 检查用户是否存在
    const userData = await kv.hgetall(`user:${username}`);
    if (!userData) {
      return res.json({ ok: false, msg: '用户不存在' });
    }
    
    // 更新用户状态
    const newEnabled = enabled === true || enabled === 'true';
    await kv.hset(`user:${username}`, {
      enabled: String(newEnabled),
      status: newEnabled ? 'approved' : 'disabled',
      // 禁用时清除 Token
      ...(newEnabled ? {} : { currentToken: '', devices: '[]' })
    });
    
    return res.json({ 
      ok: true, 
      msg: newEnabled ? '用户已启用' : '用户已禁用' 
    });
    
  } catch (error) {
    console.error('Toggle user error:', error);
    return res.status(500).json({ ok: false, msg: '服务器错误' });
  }
}
