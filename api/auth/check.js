import { kv } from '../_db.js';

// 获取系统配置
async function getSystemConfig() {
  const config = await kv.hgetall('system:config');
  return config || {};
}

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
    const { username } = req.body;
    
    if (!username) {
      return res.json({ ok: false, msg: '缺少用户名' });
    }
    
    const cleanUsername = username.trim().toLowerCase();
    
    // 检查系统状态
    const sysConfig = await getSystemConfig();
    
    // 获取用户信息
    const userData = await kv.hgetall(`user:${cleanUsername}`);
    
    if (!userData) {
      return res.json({ 
        ok: false, 
        exists: false,
        msg: '用户不存在' 
      });
    }
    
    const status = userData.status || 'pending';
    
    return res.json({ 
      ok: true,
      exists: true,
      status: status,
      maintenance: sysConfig.maintenance === 'true'
    });
    
  } catch (error) {
    console.error('Check error:', error);
    return res.status(500).json({ ok: false, msg: '服务器错误' });
  }
}
