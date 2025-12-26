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
    const { usernames, line } = req.body;
    
    if (!usernames || !Array.isArray(usernames) || usernames.length === 0) {
      return res.json({ ok: false, msg: '请选择要设置的用户' });
    }
    
    // 检查线路是否存在（如果指定了线路）
    if (line) {
      const lineData = await kv.hgetall(`line:${line}`);
      if (!lineData) {
        return res.json({ ok: false, msg: '指定的线路不存在' });
      }
    }
    
    let successCount = 0;
    let failCount = 0;
    const errors = [];
    
    for (const username of usernames) {
      const cleanUsername = username.trim().toLowerCase();
      
      // 检查用户是否存在
      const userData = await kv.hgetall(`user:${cleanUsername}`);
      if (!userData) {
        failCount++;
        errors.push(`${cleanUsername}: 用户不存在`);
        continue;
      }
      
      // 更新用户线路
      await kv.hset(`user:${cleanUsername}`, {
        line: line || ''
      });
      
      successCount++;
    }
    
    let msg = `成功设置 ${successCount} 个用户`;
    if (line) {
      msg += `到线路 ${line}`;
    } else {
      msg += '（移除线路分配）';
    }
    
    if (failCount > 0) {
      msg += `，${failCount} 个失败`;
    }
    
    return res.json({ 
      ok: true, 
      msg,
      successCount,
      failCount,
      errors: errors.length > 0 ? errors : undefined
    });
    
  } catch (error) {
    console.error('Batch set line error:', error);
    return res.status(500).json({ ok: false, msg: '服务器错误' });
  }
}
