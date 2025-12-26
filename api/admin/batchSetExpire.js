import { kv } from '../_db.js';

/**
 * 批量设置用户有效期
 * POST /api/admin/batchSetExpire
 * Body: { usernames: string[], expireDays: number } 或 { line: string, expireDays: number }
 * 
 * expireDays: 0 = 永久，>0 = 从今天开始计算的天数
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, msg: 'Method not allowed' });
  
  try {
    const { usernames, line, expireDays } = req.body;
    
    // 计算有效期时间戳
    const expireAt = expireDays > 0 
      ? Date.now() + expireDays * 24 * 60 * 60 * 1000 
      : 0;
    
    let targetUsers = [];
    
    // 如果指定了线路，获取该线路下所有用户
    if (line) {
      const allUsernames = await kv.smembers('users') || [];
      for (const username of allUsernames) {
        const userData = await kv.hgetall(`user:${username}`);
        if (userData && userData.line === line) {
          targetUsers.push(username);
        }
      }
      
      if (targetUsers.length === 0) {
        return res.json({ ok: false, msg: `线路 ${line} 下没有用户` });
      }
    } else if (usernames && Array.isArray(usernames) && usernames.length > 0) {
      targetUsers = usernames;
    } else {
      return res.json({ ok: false, msg: '请指定用户或线路' });
    }
    
    let successCount = 0;
    let failCount = 0;
    
    for (const username of targetUsers) {
      const cleanUsername = username.trim().toLowerCase();
      const userData = await kv.hgetall(`user:${cleanUsername}`);
      
      if (!userData) {
        failCount++;
        continue;
      }
      
      await kv.hset(`user:${cleanUsername}`, {
        expireAt: String(expireAt)
      });
      
      successCount++;
    }
    
    const expireText = expireDays > 0 ? `${expireDays}天` : '永久';
    let msg = `成功设置 ${successCount} 个用户的有效期为 ${expireText}`;
    if (failCount > 0) msg += `，${failCount} 个失败`;
    
    return res.json({ ok: true, msg, successCount, failCount });
    
  } catch (error) {
    console.error('Batch set expire error:', error);
    return res.status(500).json({ ok: false, msg: '服务器错误' });
  }
}
