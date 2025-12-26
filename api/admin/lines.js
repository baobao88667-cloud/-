import { kv } from '../_db.js';

/**
 * 获取所有线路列表
 * GET /api/admin/lines
 * 返回所有线路及其配额、用量、用户数、配额模式
 */

// 获取所有线路
async function getAllLines() {
  const lineNames = await kv.smembers('lines') || [];
  const lines = [];
  
  // 获取所有用户以统计每条线路的用户数
  const allUsers = await kv.smembers('users') || [];
  const userLineMap = {};
  
  for (const username of allUsers) {
    const userData = await kv.hgetall(`user:${username}`);
    if (userData && userData.line) {
      if (!userLineMap[userData.line]) {
        userLineMap[userData.line] = [];
      }
      userLineMap[userData.line].push({
        name: username,
        exportCount: parseInt(userData.exportCount) || 0,
        personalQuota: parseInt(userData.personalQuota) || 0,
        status: userData.status || 'pending'
      });
    }
  }
  
  for (const lineName of lineNames) {
    const lineData = await kv.hgetall(`line:${lineName}`);
    if (lineData) {
      const lineUsers = userLineMap[lineName] || [];
      
      lines.push({
        name: lineName,
        quota: parseInt(lineData.quota) || 0,
        used: parseInt(lineData.used) || 0,
        quotaMode: lineData.quotaMode || 'shared',  // shared | split
        enabled: lineData.enabled !== 'false',
        userCount: lineUsers.length,
        users: lineUsers,  // 包含用户详情
        createdAt: lineData.createdAt
      });
    }
  }
  
  // 按创建时间排序
  lines.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  
  return lines;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, msg: 'Method not allowed' });
  
  try {
    const lines = await getAllLines();
    return res.json({ ok: true, lines });
  } catch (error) {
    console.error('Get lines error:', error);
    return res.status(500).json({ ok: false, msg: '服务器错误' });
  }
}
