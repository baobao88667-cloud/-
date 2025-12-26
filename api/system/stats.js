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
    // 获取用户统计
    const allUsers = await kv.smembers('users') || [];
    const pendingUsers = await kv.smembers('pending_users') || [];
    
    let activeUsers = 0;
    let disabledUsers = 0;
    let lockedUsers = 0;
    let expiredUsers = 0;
    let totalExports = 0;
    let onlineUsers = 0;
    
    const now = Date.now();
    const onlineThreshold = 5 * 60 * 1000;  // 5分钟内活跃算在线
    
    for (const username of allUsers) {
      const userData = await kv.hgetall(`user:${username}`);
      if (userData) {
        const status = userData.status || 'pending';
        const expireAt = parseInt(userData.expireAt) || 0;
        
        if (status === 'approved' && userData.enabled === 'true') {
          if (expireAt > 0 && now > expireAt) {
            expiredUsers++;
          } else {
            activeUsers++;
          }
        } else if (status === 'disabled' || userData.enabled === 'false') {
          disabledUsers++;
        } else if (status === 'locked') {
          lockedUsers++;
        }
        
        totalExports += parseInt(userData.exportCount) || 0;
        
        // 检查是否在线
        try {
          const devices = JSON.parse(userData.devices || '[]');
          if (devices.length > 0 && devices[0].lastSeen) {
            const lastSeen = new Date(devices[0].lastSeen).getTime();
            if (now - lastSeen < onlineThreshold) {
              onlineUsers++;
            }
          }
        } catch (e) {}
      }
    }
    
    // 获取线路统计
    const lineNames = await kv.smembers('lines') || [];
    const lines = [];
    
    for (const lineName of lineNames) {
      const lineData = await kv.hgetall(`line:${lineName}`);
      if (lineData) {
        lines.push({
          name: lineName,
          quota: parseInt(lineData.quota) || 0,
          used: parseInt(lineData.used) || 0
        });
      }
    }
    
    return res.json({
      ok: true,
      stats: {
        users: {
          total: allUsers.length,
          active: activeUsers,
          disabled: disabledUsers,
          locked: lockedUsers,
          expired: expiredUsers,
          pending: pendingUsers.length,
          online: onlineUsers
        },
        exports: {
          total: totalExports
        },
        lines: lines,
        serverTime: now
      }
    });
    
  } catch (error) {
    console.error('Get stats error:', error);
    return res.status(500).json({ ok: false, msg: '服务器错误' });
  }
}
