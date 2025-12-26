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
    // 更新全局踢出时间戳
    // 所有在此时间之前创建的 Token 都会失效
    await kv.hset('system:config', {
      lastGlobalKick: String(Date.now())
    });
    
    // 同时清空所有用户的设备信息（可选，更彻底）
    const allUsers = await kv.smembers('users') || [];
    
    for (const username of allUsers) {
      await kv.hset(`user:${username}`, {
        currentToken: '',
        devices: '[]'
      });
    }
    
    return res.json({ 
      ok: true, 
      msg: `已踢出所有用户（共 ${allUsers.length} 个）` 
    });
    
  } catch (error) {
    console.error('Kick all error:', error);
    return res.status(500).json({ ok: false, msg: '服务器错误' });
  }
}
