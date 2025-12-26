import { kv } from './_db.js';

// 获取系统配置
async function getSystemConfig() {
  const config = await kv.hgetall('system:config');
  return config || {
    maintenance: 'false',
    maintenanceMessage: '',
    announcement: '',
    announcementEnabled: 'false',
    lastGlobalKick: '0'
  };
}

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
    const config = await getSystemConfig();
    
    return res.json({
      ok: true,
      maintenance: config.maintenance === 'true',
      maintenanceMessage: config.maintenanceMessage || '系统维护中，请稍后再试',
      announcement: config.announcementEnabled === 'true' ? config.announcement : '',
      announcementEnabled: config.announcementEnabled === 'true',
      serverTime: Date.now()
    });
    
  } catch (error) {
    console.error('Status error:', error);
    return res.status(500).json({ ok: false, msg: '服务器错误' });
  }
}
