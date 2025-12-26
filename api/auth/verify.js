import { kv } from '../_db.js';

// 获取系统配置
async function getSystemConfig() {
  const config = await kv.hgetall('system:config');
  return config || {};
}

// 获取线路信息
async function getLine(lineName) {
  if (!lineName) return null;
  return await kv.hgetall(`line:${lineName}`);
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
    const { username, token, deviceId } = req.body;
    
    if (!username || !token) {
      return res.json({ ok: false, msg: '缺少验证信息', code: 'INVALID' });
    }
    
    const cleanUsername = username.trim().toLowerCase();
    
    // 检查系统维护状态
    const sysConfig = await getSystemConfig();
    if (sysConfig.maintenance === 'true') {
      return res.json({ 
        ok: false, 
        msg: sysConfig.maintenanceMessage || '系统维护中，请稍后再试',
        code: 'MAINTENANCE'
      });
    }
    
    // 检查全局踢出
    const lastGlobalKick = parseInt(sysConfig.lastGlobalKick) || 0;
    
    // 获取用户信息
    const userData = await kv.hgetall(`user:${cleanUsername}`);
    if (!userData) {
      return res.json({ ok: false, msg: '用户不存在', code: 'INVALID' });
    }
    
    // 验证 Token
    if (userData.currentToken !== token) {
      return res.json({ 
        ok: false, 
        msg: '登录已失效，请重新登录（可能在其他设备登录）',
        code: 'TOKEN_INVALID'
      });
    }
    
    // 检查 Token 是否在全局踢出之前创建
    const tokenCreatedAt = parseInt(userData.tokenCreatedAt) || 0;
    if (lastGlobalKick > 0 && tokenCreatedAt < lastGlobalKick) {
      return res.json({ 
        ok: false, 
        msg: '登录已失效，请重新登录',
        code: 'KICKED'
      });
    }
    
    // 检查用户状态
    const status = userData.status || 'pending';
    
    if (status === 'pending') {
      return res.json({ ok: false, msg: '账号正在等待审核', code: 'PENDING' });
    }
    
    if (status === 'disabled' || userData.enabled === 'false') {
      return res.json({ ok: false, msg: '账号已被禁用', code: 'DISABLED' });
    }
    
    // 检查有效期
    const expireAt = parseInt(userData.expireAt) || 0;
    if (expireAt > 0 && Date.now() > expireAt) {
      return res.json({ 
        ok: false, 
        msg: '账号使用期限已到，如需继续使用请联系管理员',
        code: 'EXPIRED'
      });
    }
    
    // 检查线路配额
    const lineName = userData.line;
    let lineInfo = null;
    
    if (lineName) {
      const lineData = await getLine(lineName);
      if (lineData) {
        const quota = parseInt(lineData.quota) || 0;
        const used = parseInt(lineData.used) || 0;
        
        lineInfo = {
          name: lineName,
          quota: quota,
          used: used
        };
        
        if (quota > 0 && used >= quota) {
          // 锁定用户
          await kv.hset(`user:${cleanUsername}`, { status: 'locked' });
          return res.json({ 
            ok: false, 
            msg: `已达到 ${quota.toLocaleString()} 数量待机中，如需继续使用请联系管理员`,
            code: 'QUOTA_EXCEEDED'
          });
        }
      }
    }
    
    if (status === 'locked') {
      // 检查是否应该解锁
      if (lineInfo && (lineInfo.quota === 0 || lineInfo.used < lineInfo.quota)) {
        await kv.hset(`user:${cleanUsername}`, { status: 'approved' });
      } else {
        return res.json({ 
          ok: false, 
          msg: `已达到配额上限，如需继续使用请联系管理员`,
          code: 'QUOTA_EXCEEDED'
        });
      }
    }
    
    // 更新最后活跃时间
    let devices = [];
    try {
      devices = JSON.parse(userData.devices || '[]');
    } catch (e) {
      devices = [];
    }
    
    if (devices.length > 0) {
      devices[0].lastSeen = new Date().toISOString();
      await kv.hset(`user:${cleanUsername}`, { devices: JSON.stringify(devices) });
    }
    
    // 计算剩余时间
    let remainingDays = null;
    if (expireAt > 0) {
      remainingDays = Math.ceil((expireAt - Date.now()) / (1000 * 60 * 60 * 24));
    }
    
    return res.json({ 
      ok: true, 
      msg: '验证成功',
      user: {
        username: cleanUsername,
        line: lineName || '未分配',
        expireAt: expireAt,
        remainingDays: remainingDays,
        exportCount: parseInt(userData.exportCount) || 0
      },
      lineInfo: lineInfo,
      serverTime: Date.now()
    });
    
  } catch (error) {
    console.error('Verify error:', error);
    return res.status(500).json({ ok: false, msg: '服务器错误' });
  }
}
