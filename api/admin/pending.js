import { kv } from '../_db.js';

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, msg: 'Method not allowed' });
  }
  
  try {
    const pendingUsers = await kv.smembers('pending_users') || [];
    const users = [];
    
    for (const username of pendingUsers) {
      const userData = await kv.hgetall(`user:${username}`);
      if (userData && userData.status === 'pending') {
        users.push({
          name: username,
          createdAt: userData.createdAt
        });
      }
    }
    
    // 按注册时间排序
    users.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    
    return res.json({ ok: true, users, count: users.length });
  } catch (error) {
    console.error('Get pending users error:', error);
    return res.status(500).json({ ok: false, msg: '服务器错误' });
  }
}
