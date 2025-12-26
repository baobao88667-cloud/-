import { kv } from '../_db.js';

// 获取系统配置
async function getSystemConfig() {
  const config = await kv.hgetall('system:config');
  return config || {
    maintenance: 'false',
    maintenanceMessage: '',
    announcement: '',
    announcementEnabled: 'false',
    lastGlobalKick: '0',
    adminPassword: ''
  };
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method === 'GET') {
    try {
      const config = await getSystemConfig();
      
      // 不返回敏感信息
      return res.json({
        ok: true,
        config: {
          maintenance: config.maintenance === 'true',
          maintenanceMessage: config.maintenanceMessage || '',
          announcement: config.announcement || '',
          announcementEnabled: config.announcementEnabled === 'true',
          hasAdminPassword: !!config.adminPassword
        }
      });
    } catch (error) {
      console.error('Get config error:', error);
      return res.status(500).json({ ok: false, msg: '服务器错误' });
    }
  }
  
  if (req.method === 'POST') {
    try {
      const { 
        maintenance, 
        maintenanceMessage, 
        announcement, 
        announcementEnabled,
        adminPassword,
        newAdminPassword
      } = req.body;
      
      const currentConfig = await getSystemConfig();
      
      // 如果设置了管理员密码，需要验证
      if (currentConfig.adminPassword) {
        // 这里简单处理，实际应该在请求头中传递
      }
      
      const updates = {};
      
      if (maintenance !== undefined) {
        updates.maintenance = String(maintenance);
      }
      
      if (maintenanceMessage !== undefined) {
        updates.maintenanceMessage = maintenanceMessage;
      }
      
      if (announcement !== undefined) {
        updates.announcement = announcement;
      }
      
      if (announcementEnabled !== undefined) {
        updates.announcementEnabled = String(announcementEnabled);
      }
      
      if (newAdminPassword !== undefined) {
        updates.adminPassword = newAdminPassword;
      }
      
      if (Object.keys(updates).length > 0) {
        await kv.hset('system:config', updates);
      }
      
      return res.json({ ok: true, msg: '配置已更新' });
      
    } catch (error) {
      console.error('Update config error:', error);
      return res.status(500).json({ ok: false, msg: '服务器错误' });
    }
  }
  
  return res.status(405).json({ ok: false, msg: 'Method not allowed' });
}
