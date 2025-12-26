/**
 * auth.js - 认证 API
 * v4.0.2 - 修复公告功能
 */

const { kv } = require('./_db');

// 【修复】辅助函数：检查 enabled 字段是否为真
function isEnabled(value) {
  return value === 'true' || value === true || value === '1' || value === 1;
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const action = req.query.action;

  try {
    switch (action) {
      case 'register':
        return await handleRegister(req.body, res);
      case 'login':
        return await handleLogin(req.body, res);
      case 'verify':
        return await handleVerify(req.body, res);
      case 'check':
        return await handleCheck(req.body, res);
      default:
        return res.status(400).json({ ok: false, msg: '未知操作' });
    }
  } catch (error) {
    console.error('Auth API error:', error);
    return res.status(500).json({ ok: false, msg: '服务器错误' });
  }
};

// 注册
async function handleRegister(body, res) {
  const { username, password } = body;

  if (!username || !password) {
    return res.status(400).json({ ok: false, msg: '用户名和密码不能为空' });
  }

  // 验证用户名格式
  if (!/^[a-zA-Z0-9]{3,20}$/.test(username)) {
    return res.status(400).json({ ok: false, msg: '用户名只能包含字母和数字，长度3-20位' });
  }
  // 检查用户名是否同时包含字母和数字
  if (!/[a-zA-Z]/.test(username) || !/[0-9]/.test(username)) {
    return res.status(400).json({ ok: false, msg: '禁止设置纯数字和纯字母作为用户名，必须同时包含字母和数字' });
  }

  // 验证密码格式
  if (!/^[a-zA-Z0-9]{6,30}$/.test(password)) {
    return res.status(400).json({ ok: false, msg: '密码只能包含字母和数字，长度6-30位' });
  }
  // 检查密码是否同时包含字母和数字
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return res.status(400).json({ ok: false, msg: '禁止设置纯数字和纯字母作为密码，必须同时包含字母和数字' });
  }

  // 检查用户名是否已存在
  const existingUser = await kv.hgetall(`user:${username}`);
  if (existingUser) {
    return res.status(400).json({ ok: false, msg: '用户名已被使用' });
  }

  // 检查待审核列表
  const pendingUser = await kv.hgetall(`pending:${username}`);
  if (pendingUser) {
    return res.status(400).json({ ok: false, msg: '该用户名已在审核中' });
  }

  // 创建待审核用户
  const userData = {
    username,
    password,
    status: 'pending',
    enabled: 'true',
    line: '',
    expireAt: '0',
    exportCount: '0',
    personalQuota: '0',
    createdAt: Date.now().toString()
  };

  await kv.hset(`pending:${username}`, userData);
  await kv.sadd('pending_users', username);

  return res.status(200).json({ 
    ok: true, 
    msg: '注册成功，请等待管理员审核' 
  });
}

// 登录
async function handleLogin(body, res) {
  const { username, password } = body;

  if (!username || !password) {
    return res.status(400).json({ ok: false, msg: '用户名和密码不能为空' });
  }

  // 检查系统维护状态
  const config = await kv.hgetall('system:config') || {};
  if (config.maintenance === 'true') {
    return res.status(503).json({ 
      ok: false, 
      msg: config.maintenanceMessage || '系统维护中',
      code: 'MAINTENANCE'
    });
  }

  // 检查用户是否在待审核
  const pendingUser = await kv.hgetall(`pending:${username}`);
  if (pendingUser) {
    return res.status(403).json({ ok: false, msg: '账号正在审核中，请等待管理员审核', code: 'PENDING' });
  }

  // 获取用户信息
  const user = await kv.hgetall(`user:${username}`);
  if (!user) {
    return res.status(401).json({ ok: false, msg: '用户名或密码错误' });
  }

  // 验证密码
  if (user.password !== password) {
    return res.status(401).json({ ok: false, msg: '用户名或密码错误' });
  }

  // 检查账号状态
  if (user.status !== 'approved') {
    return res.status(403).json({ ok: false, msg: '账号未通过审核', code: 'NOT_APPROVED' });
  }

  // 【修复】使用兼容多种格式的 enabled 检查
  if (!isEnabled(user.enabled)) {
    return res.status(403).json({ ok: false, msg: '账号已被禁用', code: 'DISABLED' });
  }

  // 检查有效期
  const expireAt = parseInt(user.expireAt) || 0;
  if (expireAt > 0 && Date.now() > expireAt) {
    return res.status(403).json({ ok: false, msg: '账号已过期', code: 'EXPIRED' });
  }

  // 生成新 Token
  const token = generateToken();
  await kv.hset(`user:${username}`, {
    currentToken: token,
    lastLogin: Date.now().toString(),
    tokenCreatedAt: Date.now().toString()
  });

  // 获取公告
  let announcement = null;
  if (config.announcementEnabled === 'true' && config.announcement) {
    announcement = config.announcement;
  }

  return res.status(200).json({
    ok: true,
    msg: '登录成功',
    token,
    user: {
      username,
      line: user.line || '',
      expireAt: expireAt || 0,
      exportCount: parseInt(user.exportCount) || 0,
      personalQuota: parseInt(user.personalQuota) || 0
    },
    announcement
  });
}

// 验证 Token
async function handleVerify(body, res) {
  const { username, token } = body;

  if (!username || !token) {
    return res.status(400).json({ ok: false, msg: '参数不完整' });
  }

  // 检查系统维护状态
  const config = await kv.hgetall('system:config') || {};
  if (config.maintenance === 'true') {
    return res.status(503).json({ 
      ok: false, 
      msg: config.maintenanceMessage || '系统维护中',
      code: 'MAINTENANCE'
    });
  }

  // 获取用户信息
  const user = await kv.hgetall(`user:${username}`);
  if (!user) {
    return res.status(401).json({ ok: false, msg: 'Token 无效', code: 'INVALID_TOKEN' });
  }

  // 验证 Token
  if (user.currentToken !== token) {
    return res.status(401).json({ ok: false, msg: '登录已失效，请重新登录', code: 'KICKED' });
  }

  // 检查全局踢出时间
  const lastGlobalKick = parseInt(config.lastGlobalKick) || 0;
  const tokenCreatedAt = parseInt(user.tokenCreatedAt) || 0;
  if (lastGlobalKick > 0 && tokenCreatedAt < lastGlobalKick) {
    return res.status(401).json({ ok: false, msg: '登录已失效，请重新登录', code: 'KICKED' });
  }

  // 【修复】使用兼容多种格式的 enabled 检查
  if (!isEnabled(user.enabled)) {
    return res.status(403).json({ ok: false, msg: '账号已被禁用', code: 'DISABLED' });
  }

  if (user.status === 'locked') {
    return res.status(403).json({ ok: false, msg: '账号已被锁定（配额用完）', code: 'LOCKED' });
  }

  // 检查有效期
  const expireAt = parseInt(user.expireAt) || 0;
  if (expireAt > 0 && Date.now() > expireAt) {
    return res.status(403).json({ ok: false, msg: '账号已过期', code: 'EXPIRED' });
  }

  // 检查配额
  let quotaInfo = null;
  const personalQuota = parseInt(user.personalQuota) || 0;
  const exportCount = parseInt(user.exportCount) || 0;

  if (personalQuota > 0) {
    quotaInfo = {
      type: 'personal',
      quota: personalQuota,
      used: exportCount,
      remaining: personalQuota - exportCount
    };
  } else if (user.line) {
    const lineData = await kv.hgetall(`line:${user.line}`);
    if (lineData) {
      const lineQuota = parseInt(lineData.quota) || 0;
      const lineUsed = parseInt(lineData.used) || 0;
      if (lineQuota > 0) {
        quotaInfo = {
          type: 'line',
          lineName: user.line,
          quota: lineQuota,
          used: lineUsed,
          remaining: lineQuota - lineUsed
        };
      }
    }
  }

  // 【修复】获取公告信息并返回
  let announcement = null;
  if (config.announcementEnabled === 'true' && config.announcement) {
    announcement = config.announcement;
  }

  return res.status(200).json({
    ok: true,
    msg: '验证成功',
    user: {
      username,
      line: user.line || '',
      expireAt: expireAt || 0,
      exportCount,
      personalQuota
    },
    quotaInfo,
    announcement  // 【修复】添加公告到返回数据
  });
}

// 检查用户状态
async function handleCheck(body, res) {
  const { username } = body;

  if (!username) {
    return res.status(400).json({ ok: false, msg: '用户名不能为空' });
  }

  const user = await kv.hgetall(`user:${username}`);
  if (!user) {
    return res.status(404).json({ ok: false, msg: '用户不存在' });
  }

  return res.status(200).json({
    ok: true,
    status: user.status,
    enabled: isEnabled(user.enabled),
    line: user.line || '',
    expireAt: parseInt(user.expireAt) || 0
  });
}

// 生成 Token
function generateToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}
