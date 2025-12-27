/**
 * 统一管理 API
 * GET/POST /api/admin?action=users|pending|lines|stats|...
 * v6.0.0 - 新增访客/正常用户模式系统
 */

import { kv } from './_db.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// 辅助函数：检查 enabled 字段是否为真
function isEnabled(value) {
  return value === 'true' || value === true || value === '1' || value === 1;
}

// 积分下限配置
const CREDITS_MIN_THRESHOLD = 100;

/**
 * 计算用户的实际模式状态
 * v6.3.0 - 时间和积分完全独立
 * 
 * 逻辑：
 * 1. 有有效时间（未到期）→ 正常用户，不消耗积分
 * 2. 时间到期或未设置时间 → 检查积分：
 *    - 积分 ≥ 100 → 正常用户，消耗积分
 *    - 积分 < 100 → 访客模式
 */
function calculateUserMode(user, lineData = null) {
  const userMode = user.userMode || 'guest';
  
  if (userMode === 'guest') {
    return { mode: 'guest', reason: 'admin_set', useCredits: false, hasValidTime: false, remainingCredits: 0 };
  }
  
  // 检查有效期
  const expireAt = parseInt(user.expireAt) || 0;
  const hasValidTime = expireAt > 0 && Date.now() < expireAt;
  
  // 如果有有效时间，直接返回正常用户，不需要消耗积分
  if (hasValidTime) {
    return { mode: 'normal', reason: null, useCredits: false, hasValidTime: true, remainingCredits: -1 };
  }
  
  // 没有有效时间（到期或未设置），检查积分
  const personalCredits = parseInt(user.personalQuota) || 0;
  const usedCount = parseInt(user.exportCount) || 0;
  const remainingCredits = personalCredits - usedCount;
  
  if (personalCredits > 0) {
    // 有个人积分设置，检查是否 >= 100
    if (remainingCredits >= CREDITS_MIN_THRESHOLD) {
      return { mode: 'normal', reason: null, useCredits: true, hasValidTime: false, remainingCredits };
    } else {
      return { mode: 'guest', reason: 'credits_below_threshold', useCredits: false, hasValidTime: false, remainingCredits };
    }
  } else if (user.line && lineData) {
    // 使用团队积分
    const lineCredits = parseInt(lineData.quota) || 0;
    const lineUsed = parseInt(lineData.used) || 0;
    const lineRemaining = lineCredits - lineUsed;
    
    if (lineCredits > 0) {
      if (lineRemaining >= CREDITS_MIN_THRESHOLD) {
        return { mode: 'normal', reason: null, useCredits: true, hasValidTime: false, remainingCredits: lineRemaining };
      } else {
        return { mode: 'guest', reason: 'line_credits_below_threshold', useCredits: false, hasValidTime: false, remainingCredits: lineRemaining };
      }
    } else {
      // 团队积分为0表示无限制
      return { mode: 'normal', reason: null, useCredits: false, hasValidTime: false, remainingCredits: -1 };
    }
  }
  
  return { mode: 'guest', reason: 'no_time_no_credits', useCredits: false, hasValidTime: false, remainingCredits: 0 };
}

export default async function handler(req, res) {
  Object.entries(corsHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const action = req.query.action;
  const body = req.body || {};

  try {
    // GET 请求
    if (req.method === 'GET') {
      switch (action) {
        case 'users':
          return await getUsers(req, res);
        case 'pending':
          return await getPending(res);
        case 'lines':
          return await getLines(res);
        case 'stats':
          return await getStats(res);
        case 'config':
          return await getConfig(res);
        case 'exportHistory':
          return await getExportHistory(req, res);
        // 【v6.4.3 新增】版本控制配置
        case 'versionControl':
          return await getVersionControl(res);
        default:
          return res.status(400).json({ ok: false, msg: '未知操作' });
      }
    }

    // POST 请求
    if (req.method === 'POST') {
      switch (action) {
        case 'approve':
          return await approveUser(body, res);
        case 'reject':
          return await rejectUser(body, res);
        case 'toggleUser':
          return await toggleUser(body, res);
        case 'kickUser':
          return await kickUser(body, res);
        case 'removeUser':
          return await removeUser(body, res);
        case 'setLine':
          return await setLine(body, res);
        case 'setExpire':
          return await setExpire(body, res);
        case 'setQuota':
          return await setQuota(body, res);
        case 'resetExport':
          return await resetExport(body, res);
        case 'addLine':
          return await addLine(body, res);
        case 'setLineQuota':
          return await setLineQuota(body, res);
        case 'resetLineUsage':
          return await resetLineUsage(body, res);
        case 'removeLine':
          return await removeLine(body, res);
        case 'batchSetLine':
          return await batchSetLine(body, res);
        case 'batchSetExpire':
          return await batchSetExpire(body, res);
        case 'batchSetQuota':
          return await batchSetQuota(body, res);
        case 'batchResetExport':
          return await batchResetExport(body, res);
        case 'setConfig':
          return await setConfig(body, res);
        case 'kickAll':
          return await kickAll(res);
        case 'setLineUsersExpire':
          return await setLineUsersExpire(body, res);
        // 【新增】用户模式相关操作
        case 'setUserMode':
          return await setUserMode(body, res);
        case 'batchSetUserMode':
          return await batchSetUserMode(body, res);
        // 【v6.4.3 新增】版本控制设置
        case 'setVersionControl':
          return await setVersionControl(body, res);
        default:
          return res.status(400).json({ ok: false, msg: '未知操作' });
      }
    }

    return res.status(405).json({ ok: false, msg: '方法不允许' });
  } catch (error) {
    console.error('Admin API error:', error);
    return res.status(500).json({ ok: false, msg: '服务器错误: ' + error.message });
  }
}

// ========== GET 操作 ==========

// 获取用户列表 - 【修改】添加 userMode 和实际模式计算
async function getUsers(req, res) {
  const users = await kv.smembers('users');
  const result = [];

  // 预加载所有线路数据
  const lines = await kv.smembers('lines');
  const lineDataMap = {};
  for (const lineName of lines) {
    lineDataMap[lineName] = await kv.hgetall(`line:${lineName}`);
  }

  for (const username of users) {
    const user = await kv.hgetall(`user:${username}`);
    if (user) {
      const enabledValue = user.enabled;
      const isEnabledVal = enabledValue === 'true' || enabledValue === true || enabledValue === '1' || enabledValue === 1;
      
      // 【新增】计算实际用户模式
      const lineData = user.line ? lineDataMap[user.line] : null;
      const modeResult = calculateUserMode(user, lineData);
      
      result.push({
        username,
        password: user.password || '',
        status: user.status || 'approved',
        enabled: isEnabledVal,
        line: user.line || '',
        expireAt: parseInt(user.expireAt) || 0,
        exportCount: parseInt(user.exportCount) || 0,
        personalQuota: parseInt(user.personalQuota) || 0,
        createdAt: parseInt(user.createdAt) || 0,
        hasToken: !!user.currentToken,
        // 【新增】用户模式信息
        userMode: user.userMode || 'guest',           // 管理员设置的模式
        actualMode: modeResult.mode,                   // 实际生效的模式
        modeReason: modeResult.reason                  // 访客原因
      });
    }
  }

  // 按创建时间倒序
  result.sort((a, b) => b.createdAt - a.createdAt);

  return res.status(200).json({ ok: true, users: result });
}

// 获取待审核列表
async function getPending(res) {
  const pendingUsers = await kv.smembers('pending_users');
  const result = [];

  for (const username of pendingUsers) {
    const user = await kv.hgetall(`user:${username}`);
    if (user) {
      result.push({
        username,
        password: user.password || '',
        createdAt: parseInt(user.createdAt) || 0
      });
    }
  }

  result.sort((a, b) => b.createdAt - a.createdAt);

  return res.status(200).json({ ok: true, users: result });
}

// 获取线路列表
async function getLines(res) {
  const lines = await kv.smembers('lines');
  const result = [];

  for (const lineName of lines) {
    const line = await kv.hgetall(`line:${lineName}`);
    if (line) {
      // 统计该线路用户数
      const allUsers = await kv.smembers('users');
      let userCount = 0;
      for (const username of allUsers) {
        const user = await kv.hgetall(`user:${username}`);
        if (user && user.line === lineName) {
          userCount++;
        }
      }

      result.push({
        name: lineName,
        quota: parseInt(line.quota) || 0,
        used: parseInt(line.used) || 0,
        quotaMode: line.quotaMode || 'shared',
        enabled: line.enabled !== 'false',
        userCount,
        createdAt: parseInt(line.createdAt) || 0
      });
    }
  }

  return res.status(200).json({ ok: true, lines: result });
}

// 获取统计数据
async function getStats(res) {
  const users = await kv.smembers('users');
  const pendingUsers = await kv.smembers('pending_users');
  const lines = await kv.smembers('lines');

  let activeUsers = 0;
  let totalExports = 0;

  for (const username of users) {
    const user = await kv.hgetall(`user:${username}`);
    if (user) {
      const isEnabledVal = user.enabled === 'true' || user.enabled === true;
      if (isEnabledVal && user.status === 'approved') {
        activeUsers++;
      }
      totalExports += parseInt(user.exportCount) || 0;
    }
  }

  return res.status(200).json({
    ok: true,
    stats: {
      totalUsers: users.length,
      pendingUsers: pendingUsers.length,
      activeUsers,
      totalLines: lines.length,
      totalExports
    }
  });
}

// 获取系统配置
async function getConfig(res) {
  const config = await kv.hgetall('system:config') || {};
  
  const announcementEnabled = config.announcementEnabled === 'true' || config.announcementEnabled === true || config.announcementEnabled === '1';
  
  return res.status(200).json({
    ok: true,
    config: {
      maintenance: config.maintenance === 'true' || config.maintenance === true,
      maintenanceMessage: config.maintenanceMessage || '',
      announcement: config.announcement || '',
      announcementEnabled: announcementEnabled
    }
  });
}

// 获取导出历史
async function getExportHistory(req, res) {
  const username = req.query.username;
  if (!username) {
    return res.status(400).json({ ok: false, msg: '用户名不能为空' });
  }

  const history = await kv.lrange(`export_history:${username}`, 0, 99);
  const result = history.map(item => {
    if (typeof item === 'string') {
      try {
        return JSON.parse(item);
      } catch {
        return item;
      }
    }
    return item;
  });

  return res.status(200).json({ ok: true, history: result });
}

// ========== POST 操作 ==========

// 【修改】审核通过 - 默认设置为访客模式
async function approveUser(body, res) {
  const { username, line, expireDays, personalQuota } = body;

  if (!username) {
    return res.status(400).json({ ok: false, msg: '用户名不能为空' });
  }

  const user = await kv.hgetall(`user:${username}`);
  if (!user) {
    return res.status(404).json({ ok: false, msg: '用户不存在' });
  }

  // 计算有效期
  let expireAt = 0;
  if (expireDays && expireDays > 0) {
    expireAt = Date.now() + expireDays * 24 * 60 * 60 * 1000;
  }

  // 【修改】审核通过后默认为访客模式
  await kv.hset(`user:${username}`, {
    status: 'approved',
    enabled: 'true',
    userMode: 'guest',           // 【新增】默认为访客
    line: line || '',
    expireAt: expireAt.toString(),
    personalQuota: (personalQuota || 0).toString()
  });

  // 从待审核移到正式用户
  await kv.srem('pending_users', username);
  await kv.sadd('users', username);

  return res.status(200).json({ ok: true, msg: '审核通过（用户默认为访客模式）' });
}

// 拒绝注册
async function rejectUser(body, res) {
  const { username } = body;

  if (!username) {
    return res.status(400).json({ ok: false, msg: '用户名不能为空' });
  }

  await kv.srem('pending_users', username);
  await kv.del(`user:${username}`);

  return res.status(200).json({ ok: true, msg: '已拒绝' });
}

// 启用/禁用用户
async function toggleUser(body, res) {
  const { username, enabled } = body;

  if (!username) {
    return res.status(400).json({ ok: false, msg: '用户名不能为空' });
  }

  const user = await kv.hgetall(`user:${username}`);
  if (!user) {
    return res.status(404).json({ ok: false, msg: '用户不存在' });
  }

  const enabledStr = (enabled === true || enabled === 'true' || enabled === 1 || enabled === '1') ? 'true' : 'false';

  await kv.hset(`user:${username}`, {
    enabled: enabledStr
  });

  return res.status(200).json({ ok: true, msg: enabledStr === 'true' ? '已启用' : '已禁用' });
}

// 踢出用户
async function kickUser(body, res) {
  const { username } = body;

  if (!username) {
    return res.status(400).json({ ok: false, msg: '用户名不能为空' });
  }

  await kv.hset(`user:${username}`, {
    currentToken: '',
    tokenCreatedAt: '0'
  });

  return res.status(200).json({ ok: true, msg: '已踢出' });
}

// 删除用户
async function removeUser(body, res) {
  const { username } = body;

  if (!username) {
    return res.status(400).json({ ok: false, msg: '用户名不能为空' });
  }

  await kv.srem('users', username);
  await kv.del(`user:${username}`);
  await kv.del(`export_history:${username}`);

  return res.status(200).json({ ok: true, msg: '已删除' });
}

// 设置用户线路
async function setLine(body, res) {
  const { username, line } = body;

  if (!username) {
    return res.status(400).json({ ok: false, msg: '用户名不能为空' });
  }

  await kv.hset(`user:${username}`, { line: line || '' });

  return res.status(200).json({ ok: true, msg: '线路已更新' });
}

// 设置有效期
async function setExpire(body, res) {
  const { username, expireDays } = body;

  if (!username) {
    return res.status(400).json({ ok: false, msg: '用户名不能为空' });
  }

  let expireAt = 0;
  if (expireDays && expireDays > 0) {
    expireAt = Date.now() + expireDays * 24 * 60 * 60 * 1000;
  }

  await kv.hset(`user:${username}`, { expireAt: expireAt.toString() });

  return res.status(200).json({ ok: true, msg: '有效期已更新' });
}

// 设置个人积分
// v6.4.1 修改：设置积分时同时重置已用数
async function setQuota(body, res) {
  const { username, personalQuota } = body;

  if (!username) {
    return res.status(400).json({ ok: false, msg: '用户名不能为空' });
  }

  // 设置新积分时同时重置已用数为0
  await kv.hset(`user:${username}`, { 
    personalQuota: (personalQuota || 0).toString(),
    exportCount: '0'  // 重置已用数
  });

  return res.status(200).json({ ok: true, msg: '积分已更新，已用数已重置' });
}

// 重置导出数
async function resetExport(body, res) {
  const { username } = body;

  if (!username) {
    return res.status(400).json({ ok: false, msg: '用户名不能为空' });
  }

  await kv.hset(`user:${username}`, { exportCount: '0' });

  return res.status(200).json({ ok: true, msg: '已清零' });
}

// 添加线路
async function addLine(body, res) {
  const { name, quota, quotaMode } = body;

  if (!name) {
    return res.status(400).json({ ok: false, msg: '线路名称不能为空' });
  }

  const existing = await kv.hgetall(`line:${name}`);
  if (existing) {
    return res.status(400).json({ ok: false, msg: '线路已存在' });
  }

  await kv.hset(`line:${name}`, {
    quota: (quota || 0).toString(),
    used: '0',
    quotaMode: quotaMode || 'shared',
    enabled: 'true',
    createdAt: Date.now().toString()
  });

  await kv.sadd('lines', name);

  return res.status(200).json({ ok: true, msg: '线路已添加' });
}

// 设置线路积分
async function setLineQuota(body, res) {
  const { name, quota, quotaMode } = body;

  if (!name) {
    return res.status(400).json({ ok: false, msg: '线路名称不能为空' });
  }

  const updateData = { quota: (quota || 0).toString() };
  if (quotaMode) {
    updateData.quotaMode = quotaMode;
  }

  await kv.hset(`line:${name}`, updateData);

  return res.status(200).json({ ok: true, msg: '积分已更新' });
}

// 重置线路用量
async function resetLineUsage(body, res) {
  const { name } = body;

  if (!name) {
    return res.status(400).json({ ok: false, msg: '线路名称不能为空' });
  }

  await kv.hset(`line:${name}`, { used: '0' });

  return res.status(200).json({ ok: true, msg: '用量已重置' });
}

// 删除线路
async function removeLine(body, res) {
  const { name } = body;

  if (!name) {
    return res.status(400).json({ ok: false, msg: '线路名称不能为空' });
  }

  // 清除该线路下所有用户的线路设置
  const allUsers = await kv.smembers('users');
  for (const username of allUsers) {
    const user = await kv.hgetall(`user:${username}`);
    if (user && user.line === name) {
      await kv.hset(`user:${username}`, { line: '' });
    }
  }

  await kv.srem('lines', name);
  await kv.del(`line:${name}`);

  return res.status(200).json({ ok: true, msg: '线路已删除' });
}

// 批量设置线路
async function batchSetLine(body, res) {
  const { usernames, line } = body;

  if (!usernames || usernames.length === 0) {
    return res.status(400).json({ ok: false, msg: '请选择用户' });
  }

  for (const username of usernames) {
    await kv.hset(`user:${username}`, { line: line || '' });
  }

  return res.status(200).json({ ok: true, msg: `已为 ${usernames.length} 个用户设置线路` });
}

// 批量设置有效期
async function batchSetExpire(body, res) {
  const { usernames, expireDays } = body;

  if (!usernames || usernames.length === 0) {
    return res.status(400).json({ ok: false, msg: '请选择用户' });
  }

  let expireAt = 0;
  if (expireDays && expireDays > 0) {
    expireAt = Date.now() + expireDays * 24 * 60 * 60 * 1000;
  }

  for (const username of usernames) {
    await kv.hset(`user:${username}`, { expireAt: expireAt.toString() });
  }

  return res.status(200).json({ ok: true, msg: `已为 ${usernames.length} 个用户设置有效期` });
}

// 批量设置积分
async function batchSetQuota(body, res) {
  const { usernames, line, totalQuota, personalQuota, mode } = body;

  // 模式1: 给整条线路平摊积分
  // v6.4.1 修改：同时重置已用数
  if (line && totalQuota && mode === 'split') {
    const allUsers = await kv.smembers('users');
    const lineUsers = [];
    
    for (const username of allUsers) {
      const user = await kv.hgetall(`user:${username}`);
      if (user && user.line === line) {
        lineUsers.push(username);
      }
    }

    if (lineUsers.length === 0) {
      return res.status(400).json({ ok: false, msg: '该线路没有用户' });
    }

    const perUserQuota = Math.floor(totalQuota / lineUsers.length);
    for (const username of lineUsers) {
      await kv.hset(`user:${username}`, { personalQuota: perUserQuota.toString(), exportCount: '0' });
    }

    // 更新线路积分模式
    await kv.hset(`line:${line}`, { quotaMode: 'split', quota: totalQuota.toString() });

    return res.status(200).json({ 
      ok: true, 
      msg: `已将 ${totalQuota} 积分平摊给 ${lineUsers.length} 个用户，每人 ${perUserQuota}` 
    });
  }

  // 模式2: 给整条线路设置共享积分
  if (line && totalQuota && mode === 'shared') {
    await kv.hset(`line:${line}`, { quotaMode: 'shared', quota: totalQuota.toString() });

    // 清除该线路用户的个人积分
    const allUsers = await kv.smembers('users');
    for (const username of allUsers) {
      const user = await kv.hgetall(`user:${username}`);
      if (user && user.line === line) {
        await kv.hset(`user:${username}`, { personalQuota: '0' });
      }
    }

    return res.status(200).json({ ok: true, msg: `已设置线路 ${line} 共享积分为 ${totalQuota}` });
  }

  // 模式3: 给选中用户设置个人积分
  // v6.4.1 修改：同时重置已用数
  if (usernames && usernames.length > 0 && personalQuota !== undefined) {
    for (const username of usernames) {
      await kv.hset(`user:${username}`, { personalQuota: personalQuota.toString(), exportCount: '0' });
    }
    return res.status(200).json({ ok: true, msg: `已为 ${usernames.length} 个用户设置个人积分，已用数已重置` });
  }

  return res.status(400).json({ ok: false, msg: '参数不完整' });
}

// 批量重置导出数
async function batchResetExport(body, res) {
  const { usernames, line } = body;

  let targetUsers = usernames || [];

  // 如果指定了线路，获取该线路所有用户
  if (line) {
    const allUsers = await kv.smembers('users');
    for (const username of allUsers) {
      const user = await kv.hgetall(`user:${username}`);
      if (user && user.line === line && !targetUsers.includes(username)) {
        targetUsers.push(username);
      }
    }
  }

  if (targetUsers.length === 0) {
    return res.status(400).json({ ok: false, msg: '没有找到目标用户' });
  }

  for (const username of targetUsers) {
    await kv.hset(`user:${username}`, { exportCount: '0' });
  }

  return res.status(200).json({ ok: true, msg: `已重置 ${targetUsers.length} 个用户的导出数` });
}

// 设置系统配置
async function setConfig(body, res) {
  const { maintenance, maintenanceMessage, announcement, announcementEnabled } = body;

  const config = {};
  if (maintenance !== undefined) config.maintenance = maintenance ? 'true' : 'false';
  if (maintenanceMessage !== undefined) config.maintenanceMessage = maintenanceMessage;
  if (announcement !== undefined) config.announcement = announcement;
  if (announcementEnabled !== undefined) config.announcementEnabled = announcementEnabled ? 'true' : 'false';

  await kv.hset('system:config', config);

  return res.status(200).json({ ok: true, msg: '配置已保存' });
}

// 一键踢出所有用户
async function kickAll(res) {
  await kv.hset('system:config', {
    lastGlobalKick: Date.now().toString()
  });

  return res.status(200).json({ ok: true, msg: '已踢出所有用户' });
}

// 设置线路所有用户有效期
async function setLineUsersExpire(body, res) {
  const { lineName, expireDays } = body;

  if (!lineName) {
    return res.status(400).json({ ok: false, msg: '线路名称不能为空' });
  }

  const allUsers = await kv.smembers('users');
  const lineUsers = [];
  
  for (const username of allUsers) {
    const user = await kv.hgetall(`user:${username}`);
    if (user && user.line === lineName) {
      lineUsers.push(username);
    }
  }

  if (lineUsers.length === 0) {
    return res.status(400).json({ ok: false, msg: '该线路没有用户' });
  }

  let expireAt = 0;
  if (expireDays && expireDays > 0) {
    expireAt = Date.now() + expireDays * 24 * 60 * 60 * 1000;
  }

  for (const username of lineUsers) {
    await kv.hset(`user:${username}`, { expireAt: expireAt.toString() });
  }

  const expireText = expireDays > 0 ? `${expireDays}天` : '无';
  return res.status(200).json({ 
    ok: true, 
    msg: `已为 ${lineName} 线路的 ${lineUsers.length} 个用户设置有效期为 ${expireText}` 
  });
}

// ========== 【新增】用户模式相关操作 ==========

/**
 * 设置单个用户模式
 * @param {Object} body - { username, userMode: 'guest' | 'normal' }
 */
async function setUserMode(body, res) {
  const { username, userMode } = body;

  if (!username) {
    return res.status(400).json({ ok: false, msg: '用户名不能为空' });
  }

  if (!userMode || !['guest', 'normal'].includes(userMode)) {
    return res.status(400).json({ ok: false, msg: '用户模式无效，必须是 guest 或 normal' });
  }

  const user = await kv.hgetall(`user:${username}`);
  if (!user) {
    return res.status(404).json({ ok: false, msg: '用户不存在' });
  }

  // 如果要设置为正常用户，检查是否有有效期 OR 积分（任一满足即可）
  if (userMode === 'normal') {
    const expireAt = parseInt(user.expireAt) || 0;
    const personalQuota = parseInt(user.personalQuota) || 0;
    const exportCount = parseInt(user.exportCount) || 0;
    
    // 检查有效期
    const hasValidTime = expireAt > 0 && Date.now() < expireAt;
    
    // 检查积分
    let hasCredits = false;
    if (personalQuota > 0) {
      hasCredits = exportCount < personalQuota;
    } else if (user.line) {
      const lineData = await kv.hgetall(`line:${user.line}`);
      if (lineData) {
        const lineQuota = parseInt(lineData.quota) || 0;
        const lineUsed = parseInt(lineData.used) || 0;
        // 团队积分为0表示无限制，或者还有剩余
        hasCredits = lineQuota === 0 || lineUsed < lineQuota;
      }
    }
    
    // OR 逻辑：有效期 OR 积分，任一满足即可
    if (!hasValidTime && !hasCredits) {
      return res.status(400).json({ 
        ok: false, 
        msg: '无法设置为正常用户：该用户没有有效的时间或积分（需要至少有其中一个）' 
      });
    }
  }

  await kv.hset(`user:${username}`, { userMode });

  const modeText = userMode === 'normal' ? '正常用户' : '访客';
  return res.status(200).json({ ok: true, msg: `已将用户设置为${modeText}` });
}

/**
 * 批量设置用户模式
 * @param {Object} body - { usernames: string[], userMode: 'guest' | 'normal' }
 */
async function batchSetUserMode(body, res) {
  const { usernames, userMode } = body;

  if (!usernames || usernames.length === 0) {
    return res.status(400).json({ ok: false, msg: '请选择用户' });
  }

  if (!userMode || !['guest', 'normal'].includes(userMode)) {
    return res.status(400).json({ ok: false, msg: '用户模式无效，必须是 guest 或 normal' });
  }

  const results = {
    success: [],
    failed: []
  };

  // 预加载所有线路数据
  const lines = await kv.smembers('lines');
  const lineDataMap = {};
  for (const lineName of lines) {
    lineDataMap[lineName] = await kv.hgetall(`line:${lineName}`);
  }

  for (const username of usernames) {
    const user = await kv.hgetall(`user:${username}`);
    if (!user) {
      results.failed.push({ username, reason: '用户不存在' });
      continue;
    }

    // 如果要设置为正常用户，检查条件（OR 逻辑：有效期 OR 积分）
    if (userMode === 'normal') {
      const expireAt = parseInt(user.expireAt) || 0;
      const personalQuota = parseInt(user.personalQuota) || 0;
      const exportCount = parseInt(user.exportCount) || 0;
      
      // 检查有效期
      const hasValidTime = expireAt > 0 && Date.now() < expireAt;
      
      // 检查积分
      let hasCredits = false;
      if (personalQuota > 0 && exportCount < personalQuota) {
        hasCredits = true;
      } else if (user.line && lineDataMap[user.line]) {
        const lineData = lineDataMap[user.line];
        const lineQuota = parseInt(lineData.quota) || 0;
        const lineUsed = parseInt(lineData.used) || 0;
        if (lineQuota === 0 || lineUsed < lineQuota) {
          hasCredits = true;
        }
      }
      
      // OR 逻辑：有效期 OR 积分，任一满足即可
      if (!hasValidTime && !hasCredits) {
        results.failed.push({ username, reason: '没有有效的时间或积分' });
        continue;
      }
    }

    await kv.hset(`user:${username}`, { userMode });
    results.success.push(username);
  }

  const modeText = userMode === 'normal' ? '正常用户' : '访客';
  let msg = `已将 ${results.success.length} 个用户设置为${modeText}`;
  if (results.failed.length > 0) {
    msg += `，${results.failed.length} 个用户设置失败`;
  }

  return res.status(200).json({ 
    ok: true, 
    msg,
    results
  });
}


// ========== 【v6.4.3 新增】版本控制相关操作 ==========

/**
 * 获取版本控制配置
 */
async function getVersionControl(res) {
  const config = await kv.hgetall('system:version_control') || {};
  
  // 调试：返回原始数据
  return res.status(200).json({
    ok: true,
    versionControl: {
      enabled: config.enabled === 'true',
      minVersion: config.minVersion || '',
      lockMessage: config.lockMessage || '已更新请找管理员拿最新版本'
    },
    _debug_raw: config
  });
}

/**
 * 设置版本控制配置
 * @param {Object} body - { enabled, minVersion, lockMessage }
 */
async function setVersionControl(body, res) {
  const { enabled, minVersion, lockMessage } = body;
  
  // 验证版本号格式
  if (enabled && minVersion) {
    const versionRegex = /^\d+\.\d+\.\d+$/;
    if (!versionRegex.test(minVersion)) {
      return res.status(400).json({ 
        ok: false, 
        msg: '版本号格式无效，必须为 x.y.z 格式（如 6.4.3）' 
      });
    }
  }
  
  const config = {
    enabled: enabled ? 'true' : 'false',
    minVersion: minVersion || '',
    lockMessage: lockMessage || '已更新请找管理员拿最新版本'
  };
  
  console.log('Saving version control config:', config);
  
  try {
    await kv.hset('system:version_control', config);
    console.log('Version control config saved successfully');
  } catch (err) {
    console.error('Error saving version control config:', err);
    return res.status(500).json({ ok: false, msg: '保存失败: ' + err.message });
  }
  
  // 验证保存结果
  const saved = await kv.hgetall('system:version_control');
  console.log('Verified saved config:', saved);
  
  const statusText = enabled ? `已启用，最低版本 ${minVersion}` : '已禁用';
  return res.status(200).json({ 
    ok: true, 
    msg: `版本控制${statusText}`,
    _debug_saved: saved
  });
}
