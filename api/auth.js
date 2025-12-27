/**
 * 统一认证 API
 * POST /api/auth?action=register|login|verify|check
 * v6.0.0 - 新增访客/正常用户模式系统
 * 
 * 用户模式 (userMode):
 * - guest: 访客模式，可登录但不能使用任何功能
 * - normal: 正常用户，可使用所有功能（必须有有效期+积分）
 * 
 * 访客模式触发条件：
 * 1. 新用户审核通过后默认为访客
 * 2. 时间到期自动变为访客
 * 3. 积分用完自动变为访客
 * 4. 管理员手动设置为访客
 */

import { kv, crypto } from './_db.js';

// 辅助函数：检查 enabled 字段是否为真
function isEnabled(value) {
  return value === 'true' || value === true || value === '1' || value === 1;
}

/**
 * 计算用户的实际模式状态
 * 使用 OR 逻辑：有效期 OR 积分，任一满足即可是正常用户
 * 只有当有效期用完 AND 积分也用完时，才变为访客
 * @param {Object} user - 用户数据
 * @param {Object} lineData - 团队数据（可选）
 * @returns {Object} - { mode: 'guest'|'normal', reason: string|null }
 */
function calculateUserMode(user, lineData = null) {
  const userMode = user.userMode || 'guest';
  
  // 如果管理员设置为访客，直接返回访客
  if (userMode === 'guest') {
    return { mode: 'guest', reason: 'admin_set' };
  }
  
  // 检查有效期
  const expireAt = parseInt(user.expireAt) || 0;
  const hasValidTime = expireAt > 0 && Date.now() < expireAt;  // 有效期还有效
  const timeExpired = expireAt > 0 && Date.now() > expireAt;   // 有效期已过期
  
  // 检查积分
  const personalCredits = parseInt(user.personalQuota) || 0;
  const usedCount = parseInt(user.exportCount) || 0;
  let hasCredits = false;
  let creditsExhausted = false;
  
  if (personalCredits > 0) {
    // 有个人积分设置
    hasCredits = usedCount < personalCredits;  // 积分还有剩余
    creditsExhausted = usedCount >= personalCredits;  // 积分已用完
  } else if (user.line && lineData) {
    // 使用团队积分
    const lineCredits = parseInt(lineData.quota) || 0;
    const lineUsed = parseInt(lineData.used) || 0;
    if (lineCredits > 0) {
      hasCredits = lineUsed < lineCredits;  // 团队积分还有剩余
      creditsExhausted = lineUsed >= lineCredits;  // 团队积分已用完
    } else {
      // 团队积分为0表示无限制
      hasCredits = true;
    }
  }
  // 如果没有个人积分也没有团队，hasCredits 保持 false
  
  // OR 逻辑：有效期 OR 积分，任一满足即可
  if (hasValidTime || hasCredits) {
    return { mode: 'normal', reason: null };
  }
  
  // 两者都不满足，返回访客并说明原因
  if (timeExpired && creditsExhausted) {
    return { mode: 'guest', reason: 'both_exhausted' };  // 时间和积分都用完
  } else if (timeExpired) {
    return { mode: 'guest', reason: 'expired' };  // 只有时间过期
  } else if (creditsExhausted) {
    return { mode: 'guest', reason: 'credits_exhausted' };  // 只有积分用完
  } else if (expireAt === 0 && !hasCredits) {
    return { mode: 'guest', reason: 'no_time_no_credits' };  // 没有设置时间也没有积分
  } else if (expireAt === 0) {
    return { mode: 'guest', reason: 'no_time' };  // 没有设置时间
  } else {
    return { mode: 'guest', reason: 'no_credits' };  // 没有积分
  }
}

/**
 * 获取访客原因的中文描述
 */
function getGuestReasonMessage(reason) {
  const messages = {
    'admin_set': '您当前为访客模式，请联系管理员升级',
    'expired': '您的时间已到期且积分已用完，请联系管理员',
    'no_time': '您没有使用时间且没有积分，请联系管理员',
    'credits_exhausted': '您的积分已用完且时间已到期，请联系管理员',
    'line_credits_exhausted': '您的团队积分已用完且时间已到期，请联系管理员',
    'no_credits': '您没有积分且时间已到期，请联系管理员',
    'both_exhausted': '您的时间和积分都已用完，请联系管理员',
    'no_time_no_credits': '您没有设置时间和积分，请联系管理员'
  };
  return messages[reason] || '您当前为访客模式';
}

// CORS 头
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req, res) {
  // 设置 CORS
  Object.entries(corsHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, msg: '方法不允许' });
  }

  const action = req.query.action;
  const body = req.body || {};

  try {
    switch (action) {
      case 'register':
        return await handleRegister(body, res);
      case 'login':
        return await handleLogin(body, res);
      case 'verify':
        return await handleVerify(body, res);
      case 'check':
        return await handleCheck(body, res);
      default:
        return res.status(400).json({ ok: false, msg: '未知操作' });
    }
  } catch (error) {
    console.error('Auth API error:', error);
    return res.status(500).json({ ok: false, msg: '服务器错误' });
  }
}

// 注册
async function handleRegister(body, res) {
  const { username, password } = body;

  if (!username || !password) {
    return res.status(400).json({ ok: false, msg: '用户名和密码不能为空' });
  }

  // 用户名格式验证：只能是字母和数字
  const usernameRegex = /^[a-zA-Z0-9]{3,20}$/;
  if (!usernameRegex.test(username)) {
    return res.status(400).json({ 
      ok: false, 
      msg: '用户名只能包含字母和数字，长度3-20位' 
    });
  }

  // 密码格式验证
  const passwordRegex = /^[a-zA-Z0-9]{6,30}$/;
  if (!passwordRegex.test(password)) {
    return res.status(400).json({ 
      ok: false, 
      msg: '密码只能包含字母和数字，长度6-30位' 
    });
  }

  // 检查用户是否已存在
  const existingUser = await kv.hgetall(`user:${username}`);
  if (existingUser) {
    return res.status(400).json({ ok: false, msg: '用户名已存在' });
  }

  // 检查是否在待审核列表
  const isPending = await kv.sismember('pending_users', username);
  if (isPending) {
    return res.status(400).json({ ok: false, msg: '该用户名正在等待审核' });
  }

  // 创建待审核用户
  const userData = {
    password: password, // 明文存储便于管理员查看
    status: 'pending',
    enabled: 'true',
    userMode: 'guest',           // 【新增】默认为访客模式
    line: '',
    expireAt: '0',               // 0 表示没有时间
    exportCount: '0',            // 已使用积分数
    personalQuota: '0',          // 个人积分总量（0表示没有积分）
    maxDevices: '1',
    currentToken: '',
    tokenCreatedAt: '0',
    createdAt: Date.now().toString()
  };

  await kv.hset(`user:${username}`, userData);
  await kv.sadd('pending_users', username);

  return res.status(200).json({ ok: true, msg: '注册成功，请等待管理员审核' });
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
      msg: config.maintenanceMessage || '系统维护中，请稍后再试',
      code: 'MAINTENANCE'
    });
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

  // 检查用户状态
  if (user.status === 'pending') {
    return res.status(403).json({ ok: false, msg: '账号正在等待审核', code: 'PENDING' });
  }

  // 使用兼容多种格式的 enabled 检查
  if (!isEnabled(user.enabled)) {
    return res.status(403).json({ ok: false, msg: '账号已被禁用', code: 'DISABLED' });
  }

  // 【修改】移除 locked 状态检查，允许登录
  // 【修改】移除有效期检查，允许登录

  // 生成新 Token（踢出旧设备）
  const token = crypto.generateToken();
  await kv.hset(`user:${username}`, {
    currentToken: token,
    tokenCreatedAt: Date.now().toString()
  });

  // 获取团队数据（用于计算用户模式）
  let lineData = null;
  if (user.line) {
    lineData = await kv.hgetall(`line:${user.line}`);
  }

  // 【新增】计算用户实际模式
  const modeResult = calculateUserMode(user, lineData);

  // 获取公告
  let announcement = null;
  if (isEnabled(config.announcementEnabled) && config.announcement) {
    announcement = config.announcement;
  }

  const expireAt = parseInt(user.expireAt) || 0;

  return res.status(200).json({
    ok: true,
    msg: '登录成功',
    token,
    user: {
      username,
      line: user.line || '',
      expireAt: expireAt,
      usedCount: parseInt(user.exportCount) || 0,
      personalCredits: parseInt(user.personalQuota) || 0,
      userMode: modeResult.mode,           // 【新增】实际用户模式
      guestReason: modeResult.reason       // 【新增】访客原因
    },
    // 【新增】用户模式信息
    modeInfo: {
      mode: modeResult.mode,
      reason: modeResult.reason,
      message: modeResult.mode === 'guest' ? getGuestReasonMessage(modeResult.reason) : null
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

  // 使用兼容多种格式的 enabled 检查
  if (!isEnabled(user.enabled)) {
    return res.status(403).json({ ok: false, msg: '账号已被禁用', code: 'DISABLED' });
  }

  // 【修改】移除 locked 状态检查，允许继续验证
  // 【修改】移除有效期检查，允许继续验证

  // 获取团队数据
  let lineData = null;
  if (user.line) {
    lineData = await kv.hgetall(`line:${user.line}`);
  }

  // 【新增】计算用户实际模式
  const modeResult = calculateUserMode(user, lineData);

  // 构建积分信息
  let creditsInfo = null;
  const personalCredits = parseInt(user.personalQuota) || 0;
  const usedCount = parseInt(user.exportCount) || 0;
  const expireAt = parseInt(user.expireAt) || 0;

  if (personalCredits > 0) {
    // 个人积分
    creditsInfo = {
      type: 'personal',
      credits: personalCredits,
      used: usedCount,
      remaining: Math.max(0, personalCredits - usedCount)
    };
  } else if (user.line && lineData) {
    // 团队积分
    const lineCredits = parseInt(lineData.quota) || 0;
    const lineUsed = parseInt(lineData.used) || 0;
    if (lineCredits > 0) {
      creditsInfo = {
        type: 'line',
        lineName: user.line,
        credits: lineCredits,
        used: lineUsed,
        remaining: Math.max(0, lineCredits - lineUsed)
      };
    }
  }

  // 获取公告信息
  let announcement = null;
  if (isEnabled(config.announcementEnabled) && config.announcement) {
    announcement = config.announcement;
  }

  return res.status(200).json({
    ok: true,
    msg: '验证成功',
    user: {
      username,
      line: user.line || '',
      expireAt: expireAt,
      usedCount,
      personalCredits,
      userMode: modeResult.mode,           // 【新增】实际用户模式
      guestReason: modeResult.reason       // 【新增】访客原因
    },
    // 【新增】用户模式信息
    modeInfo: {
      mode: modeResult.mode,
      reason: modeResult.reason,
      message: modeResult.mode === 'guest' ? getGuestReasonMessage(modeResult.reason) : null
    },
    creditsInfo,
    announcement
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

  // 获取团队数据
  let lineData = null;
  if (user.line) {
    lineData = await kv.hgetall(`line:${user.line}`);
  }

  // 计算用户实际模式
  const modeResult = calculateUserMode(user, lineData);

  return res.status(200).json({
    ok: true,
    status: user.status,
    enabled: isEnabled(user.enabled),
    line: user.line || '',
    expireAt: parseInt(user.expireAt) || 0,
    userMode: modeResult.mode,
    guestReason: modeResult.reason
  });
}
