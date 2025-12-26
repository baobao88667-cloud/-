import { kv } from '../_db.js';

/**
 * 审核通过用户
 * POST /api/admin/approve
 * Body: { name: string, line?: string, expireDays?: number, personalQuota?: number }
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, msg: 'Method not allowed' });
  
  try {
    const { name, line, expireDays, personalQuota } = req.body;
    
    if (!name) {
      return res.json({ ok: false, msg: '用户名不能为空' });
    }
    
    const username = name.trim().toLowerCase();
    
    // 检查用户是否存在
    const userData = await kv.hgetall(`user:${username}`);
    if (!userData) {
      return res.json({ ok: false, msg: '用户不存在' });
    }
    
    // 检查线路是否存在（如果指定了线路）
    if (line) {
      const lineData = await kv.hgetall(`line:${line}`);
      if (!lineData) {
        return res.json({ ok: false, msg: '指定的团队不存在' });
      }
    }
    
    // 计算有效期
    let expireAt = 0;
    if (expireDays && expireDays > 0) {
      expireAt = Date.now() + (expireDays * 24 * 60 * 60 * 1000);
    }
    
    // 更新用户状态
    await kv.hset(`user:${username}`, {
      status: 'approved',
      enabled: 'true',
      line: line || '',
      expireAt: String(expireAt),
      personalQuota: String(personalQuota || 0)
    });
    
    // 从待审核列表移除，添加到正式用户列表
    await kv.srem('pending_users', username);
    await kv.sadd('users', username);
    
    let msg = `用户 ${username} 已通过审核`;
    if (line) msg += `，分配到团队 ${line}`;
    if (expireDays > 0) msg += `，有效期 ${expireDays} 天`;
    if (personalQuota > 0) msg += `，个人配额 ${personalQuota}`;
    
    return res.json({ ok: true, msg });
    
  } catch (error) {
    console.error('Approve user error:', error);
    return res.status(500).json({ ok: false, msg: '服务器错误' });
  }
}
