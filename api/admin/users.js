import { kv } from '../_db.js';

/**
 * 获取所有用户列表
 * GET /api/admin/users
 * 返回所有用户（包括待审核），包含密码、配额等信息
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, msg: 'Method not allowed' });
  
  try {
    const usernames = await kv.smembers('users') || [];
    const pendingUsers = await kv.smembers('pending_users') || [];
    
    const allUsernames = [...new Set([...usernames, ...pendingUsers])];
    const users = [];
    
    for (const username of allUsernames) {
      const userData = await kv.hgetall(`user:${username}`);
      if (userData) {
        let devices = [];
        try {
          devices = JSON.parse(userData.devices || '[]');
        } catch (e) {
          devices = [];
        }
        
        users.push({
          name: username,
          password: userData.password || '',
          status: userData.status || 'pending',
          enabled: userData.enabled === 'true',
          line: userData.line || '',
          expireAt: parseInt(userData.expireAt) || 0,
          exportCount: parseInt(userData.exportCount) || 0,
          personalQuota: parseInt(userData.personalQuota) || 0,  // 个人配额
          maxDevices: parseInt(userData.maxDevices) || 1,
          devices: devices,
          createdAt: userData.createdAt
        });
      }
    }
    
    // 按创建时间排序，最新的在前
    users.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    return res.json({ ok: true, users });
  } catch (error) {
    console.error('Get users error:', error);
    return res.status(500).json({ ok: false, msg: '服务器错误' });
  }
}
