import { kv } from '../_db.js';

/**
 * 批量重置用户导出数量
 * POST /api/admin/batchResetExport
 * Body: { usernames: string[] } 或 { line: string }
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, msg: 'Method not allowed' });
  
  try {
    const { usernames, line } = req.body;
    
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
      
      // 重置导出数量
      await kv.hset(`user:${cleanUsername}`, {
        exportCount: '0'
      });
      
      // 如果用户因配额锁定，检查是否应该解锁
      if (userData.status === 'locked') {
        const personalQuota = parseInt(userData.personalQuota) || 0;
        
        // 如果有个人配额且重置后未超限，解锁用户
        if (personalQuota > 0) {
          await kv.hset(`user:${cleanUsername}`, {
            status: 'approved'
          });
        } else if (userData.line) {
          // 检查线路配额
          const lineData = await kv.hgetall(`line:${userData.line}`);
          if (lineData) {
            const lineQuota = parseInt(lineData.quota) || 0;
            const lineUsed = parseInt(lineData.used) || 0;
            if (lineQuota === 0 || lineUsed < lineQuota) {
              await kv.hset(`user:${cleanUsername}`, {
                status: 'approved'
              });
            }
          }
        }
      }
      
      successCount++;
    }
    
    let msg = `成功重置 ${successCount} 个用户的导出数量`;
    if (failCount > 0) msg += `，${failCount} 个失败`;
    
    return res.json({ ok: true, msg, successCount, failCount });
    
  } catch (error) {
    console.error('Batch reset export error:', error);
    return res.status(500).json({ ok: false, msg: '服务器错误' });
  }
}
