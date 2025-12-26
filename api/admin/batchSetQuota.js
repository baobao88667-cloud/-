import { kv } from '../_db.js';

/**
 * 批量设置用户配额
 * POST /api/admin/batchSetQuota
 * 
 * 模式1 - 平摊配额（针对整条线路）:
 * Body: { line: string, totalQuota: number, mode: 'split' }
 * 将 totalQuota 平均分配给线路下所有用户作为个人配额
 * 
 * 模式2 - 自定义个人配额:
 * Body: { usernames: string[], personalQuota: number }
 * 给指定用户设置固定的个人配额
 * 
 * 模式3 - 设置线路共享配额:
 * Body: { line: string, totalQuota: number, mode: 'shared' }
 * 设置线路总配额，所有用户共享
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, msg: 'Method not allowed' });
  
  try {
    const { line, totalQuota, mode, usernames, personalQuota } = req.body;
    
    // 模式1和模式3：针对线路设置
    if (line && totalQuota !== undefined && mode) {
      // 检查线路是否存在
      const lineData = await kv.hgetall(`line:${line}`);
      if (!lineData) {
        return res.json({ ok: false, msg: '线路不存在' });
      }
      
      // 获取线路下所有用户
      const allUsernames = await kv.smembers('users') || [];
      const lineUsers = [];
      for (const username of allUsernames) {
        const userData = await kv.hgetall(`user:${username}`);
        if (userData && userData.line === line) {
          lineUsers.push(username);
        }
      }
      
      if (mode === 'split') {
        // 平摊模式：将总配额平均分配给每个用户
        if (lineUsers.length === 0) {
          return res.json({ ok: false, msg: '该线路下没有用户，无法平摊' });
        }
        
        const perUserQuota = Math.floor(totalQuota / lineUsers.length);
        
        // 更新线路配额模式
        await kv.hset(`line:${line}`, {
          quota: String(totalQuota),
          quotaMode: 'split'
        });
        
        // 给每个用户设置个人配额
        for (const username of lineUsers) {
          await kv.hset(`user:${username}`, {
            personalQuota: String(perUserQuota)
          });
        }
        
        return res.json({ 
          ok: true, 
          msg: `已将 ${totalQuota.toLocaleString()} 配额平摊给 ${lineUsers.length} 个用户，每人 ${perUserQuota.toLocaleString()}`,
          userCount: lineUsers.length,
          perUserQuota
        });
        
      } else if (mode === 'shared') {
        // 共享模式：设置线路总配额，清除用户个人配额
        await kv.hset(`line:${line}`, {
          quota: String(totalQuota),
          quotaMode: 'shared'
        });
        
        // 清除用户个人配额（设为0表示跟随线路）
        for (const username of lineUsers) {
          await kv.hset(`user:${username}`, {
            personalQuota: '0'
          });
        }
        
        return res.json({ 
          ok: true, 
          msg: `已设置线路 ${line} 为共享模式，总配额 ${totalQuota.toLocaleString()}`,
          userCount: lineUsers.length
        });
      } else {
        return res.json({ ok: false, msg: '无效的配额模式，请使用 split 或 shared' });
      }
    }
    
    // 模式2：自定义个人配额
    if (usernames && Array.isArray(usernames) && usernames.length > 0 && personalQuota !== undefined) {
      let successCount = 0;
      let failCount = 0;
      
      for (const username of usernames) {
        const cleanUsername = username.trim().toLowerCase();
        const userData = await kv.hgetall(`user:${cleanUsername}`);
        
        if (!userData) {
          failCount++;
          continue;
        }
        
        await kv.hset(`user:${cleanUsername}`, {
          personalQuota: String(personalQuota)
        });
        
        successCount++;
      }
      
      const quotaText = personalQuota > 0 ? personalQuota.toLocaleString() : '无限制';
      let msg = `成功设置 ${successCount} 个用户的个人配额为 ${quotaText}`;
      if (failCount > 0) msg += `，${failCount} 个失败`;
      
      return res.json({ ok: true, msg, successCount, failCount });
    }
    
    return res.json({ ok: false, msg: '参数错误，请检查请求格式' });
    
  } catch (error) {
    console.error('Batch set quota error:', error);
    return res.status(500).json({ ok: false, msg: '服务器错误' });
  }
}
