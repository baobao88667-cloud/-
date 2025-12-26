import { kv, crypto } from '../_db.js';

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
    const { username, password, deviceId } = req.body;
    
    // 验证输入
    if (!username || !password) {
      return res.json({ ok: false, msg: '用户名和密码不能为空' });
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
    
    // 获取用户信息
    const userData = await kv.hgetall(`user:${cleanUsername}`);
    if (!userData) {
      return res.json({ ok: false, msg: '用户名或密码错误' });
    }
    
    // 验证密码（明文比对）
    if (userData.password !== password) {
      return res.json({ ok: false, msg: '用户名或密码错误' });
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
    if (lineName) {
      const lineData = await getLine(lineName);
      if (lineData) {
        const quota = parseInt(lineData.quota) || 0;
        const used = parseInt(lineData.used) || 0;
        
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
      // 再次检查是否应该解锁（配额可能已重置）
      const lineData = lineName ? await getLine(lineName) : null;
      if (lineData) {
        const quota = parseInt(lineData.quota) || 0;
        const used = parseInt(lineData.used) || 0;
        if (quota === 0 || used < quota) {
          // 解锁用户
          await kv.hset(`user:${cleanUsername}`, { status: 'approved' });
        } else {
          return res.json({ 
            ok: false, 
            msg: `已达到 ${quota.toLocaleString()} 数量待机中，如需继续使用请联系管理员`,
            code: 'QUOTA_EXCEEDED'
          });
        }
      }
    }
    
    // 生成新 Token
    const newToken = crypto.generateToken();
    const tokenCreatedAt = Date.now();
    
    // 更新用户信息（单设备限制：新登录会踢出旧设备）
    const deviceInfo = {
      id: deviceId || 'unknown',
      loginTime: new Date().toISOString(),
      lastSeen: new Date().toISOString()
    };
    
    await kv.hset(`user:${cleanUsername}`, {
      currentToken: newToken,
      tokenCreatedAt: String(tokenCreatedAt),
      devices: JSON.stringify([deviceInfo])  // 单设备，直接覆盖
    });
    
    // 获取线路信息用于返回
    let lineInfo = null;
    if (lineName) {
      const lineData = await getLine(lineName);
      if (lineData) {
        lineInfo = {
          name: lineName,
          quota: parseInt(lineData.quota) || 0,
          used: parseInt(lineData.used) || 0
        };
      }
    }
    
    // 计算剩余时间
    let remainingDays = null;
    if (expireAt > 0) {
      remainingDays = Math.ceil((expireAt - Date.now()) / (1000 * 60 * 60 * 24));
    }
    
    return res.json({ 
      ok: true, 
      msg: '登录成功',
      token: newToken,
      user: {
        username: cleanUsername,
        line: lineName || '未分配',
        expireAt: expireAt,
        remainingDays: remainingDays,
        exportCount: parseInt(userData.exportCount) || 0
      },
      lineInfo: lineInfo
    });
    
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ ok: false, msg: '服务器错误' });
  }
}
