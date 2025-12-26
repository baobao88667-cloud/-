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
    const { name, expireAt, expireDays } = req.body;
    
    if (!name) {
      return res.json({ ok: false, msg: '用户名不能为空' });
    }
    
    const username = name.trim().toLowerCase();
    
    // 检查用户是否存在
    const userData = await kv.hgetall(`user:${username}`);
    if (!userData) {
      return res.json({ ok: false, msg: '用户不存在' });
    }
    
    // 计算有效期
    let newExpireAt = 0;
    
    if (expireAt !== undefined) {
      // 直接设置时间戳
      newExpireAt = parseInt(expireAt) || 0;
    } else if (expireDays !== undefined) {
      // 从现在开始计算天数
      if (expireDays > 0) {
        newExpireAt = Date.now() + (expireDays * 24 * 60 * 60 * 1000);
      } else {
        newExpireAt = 0;  // 永不过期
      }
    }
    
    // 更新用户有效期
    await kv.hset(`user:${username}`, {
      expireAt: String(newExpireAt)
    });
    
    const msg = newExpireAt === 0 
      ? '已设置为永不过期' 
      : `有效期已设置至 ${new Date(newExpireAt).toLocaleString()}`;
    
    return res.json({ ok: true, msg });
    
  } catch (error) {
    console.error('Set expire error:', error);
    return res.status(500).json({ ok: false, msg: '服务器错误' });
  }
}
