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
    const { name, resetUsers } = req.body;
    
    if (!name) {
      return res.json({ ok: false, msg: '线路名称不能为空' });
    }
    
    // 检查线路是否存在
    const lineData = await kv.hgetall(`line:${name}`);
    if (!lineData) {
      return res.json({ ok: false, msg: '线路不存在' });
    }
    
    // 重置线路用量
    await kv.hset(`line:${name}`, { used: '0' });
    
    // 如果需要，同时重置该线路所有用户的导出数量
    if (resetUsers) {
      const allUsers = await kv.smembers('users') || [];
      for (const username of allUsers) {
        const userData = await kv.hgetall(`user:${username}`);
        if (userData && userData.line === name) {
          await kv.hset(`user:${username}`, { 
            exportCount: '0',
            status: userData.status === 'locked' ? 'approved' : userData.status
          });
        }
      }
    }
    
    // 解锁该线路下被锁定的用户
    const allUsers = await kv.smembers('users') || [];
    for (const username of allUsers) {
      const userData = await kv.hgetall(`user:${username}`);
      if (userData && userData.line === name && userData.status === 'locked') {
        await kv.hset(`user:${username}`, { status: 'approved' });
      }
    }
    
    return res.json({ ok: true, msg: '用量已重置' });
    
  } catch (error) {
    console.error('Reset line usage error:', error);
    return res.status(500).json({ ok: false, msg: '服务器错误' });
  }
}
