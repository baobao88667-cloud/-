/**
 * 统一管理 API
 * GET/POST /api/admin?action=users|pending|lines|stats|...
 * v2.0.0 - 双重配额版本
 */

import { kv } from './_db.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

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
        case 'setSearchQuota':
          return await setSearchQuota(body, res);
        case 'resetExport':
          return await resetExport(body, res);
        case 'resetSearch':
          return await resetSearch(body, res);
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
        case 'batchSetSearchQuota':
          return await batchSetSearchQuota(body, res);
        case 'batchResetExport':
          return await batchResetExport(body, res);
        case 'batchResetSearch':
          return await batchResetSearch(body, res);
        case 'setConfig':
          return await setConfig(body, res);
        case 'kickAll':
          return await kickAll(res);
        case 'setLineUsersExpire':
          return await setLineUsersExpire(body, res);
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

// 获取用户列表
async function getUsers(req, res) {
  const users = await kv.smembers('users');
  const result = [];

  for (const username of users) {
    const user = await kv.hgetall(`user:${username}`);
    if (user) {
      const enabledValue = user.enabled;
      const isEnabled = enabledValue === 'true' || enabledValue === true || enabledValue === '1' || enabledValue === 1;
      
      result.push({
        username,
        password: user.password || '',
        status: user.status || 'approved',
        enabled: isEnabled,
        line: user.line || '',
        expireAt: parseInt(user.expireAt) || 0,
        exportCount: parseInt(user.exportCount) || 0,
        personalQuota: parseInt(user.personalQuota) || 0,
        searchCount: parseInt(user.searchCount) || 0,
        searchQuota: parseInt(user.searchQuota) || 0,
        createdAt: parseInt(user.createdAt) || 0,
        hasToken: !!user.currentToken
      });
    }
  }

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
  let totalSearches = 0;

  for (const username of users) {
    const user = await kv.hgetall(`user:${username}`);
    if (user) {
      const isEnabled = user.enabled === 'true' || user.enabled === true;
      if (isEnabled && user.status === 'approved') {
        activeUsers++;
      }
      totalExports += parseInt(user.exportCount) || 0;
      totalSearches += parseInt(user.searchCount) || 0;
    }
  }

  return res.status(200).json({
    ok: true,
    stats: {
      totalUsers: users.length,
      pendingUsers: pendingUsers.length,
      activeUsers,
      totalLines: lines.length,
      totalExports,
      totalSearches
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

// 审核通过
async function approveUser(body, res) {
  const { username, line, expireDays, personalQuota, searchQuota } = body;

  if (!username) {
    return res.status(400).json({ ok: false, msg: '用户名不能为空' });
  }

  const user = await kv.hgetall(`user:${username}`);
  if (!user) {
    return res.status(404).json({ ok: false, msg: '用户不存在' });
  }

  let expireAt = 0;
  if (expireDays && expireDays > 0) {
    expireAt = Date.now() + expireDays * 24 * 60 * 60 * 1000;
  }

  await kv.hset(`user:${username}`, {
    status: 'approved',
    enabled: 'true',
    line: line || '',
    expireAt: expireAt.toString(),
    personalQuota: (personalQuota || 0).toString(),
    searchQuota: (searchQuota || 0).toString()
  });

  await kv.srem('pending_users', username);
  await kv.sadd('users', username);

  return res.status(200).json({ ok: true, msg: '审核通过' });
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

  await kv.hset(`user:${username}`, { enabled: enabledStr });

  return res.status(200).json({ ok: true, msg: enabledStr === 'true' ? '已启用' : '已禁用' });
}

// 踢出用户
async function kickUser(body, res) {
  const { username } = body;

  if (!username) {
    return res.status(400).json({ ok: false, msg: '用户名不能为空' });
  }

  await kv.hset(`user:${username}`, { currentToken: '', tokenCreatedAt: '0' });

  return res.status(200).json({ ok: true, msg: '已踢出' });
}

// 删除用户
async function removeUser(body, res) {
  const { username } = body;

  if (!username) {
    return res.status(400).json({ ok: false, msg: '用户名不能为空' });
  }

  await kv.srem('users', username);
  await kv.srem('pending_users', username);
  await kv.del(`user:${username}`);
  await kv.del(`export_history:${username}`);

  return res.status(200).json({ ok: true, msg: '已删除' });
}

// 设置线路
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

// 设置导出配额
async function setQuota(body, res) {
  const { username, personalQuota } = body;

  if (!username) {
    return res.status(400).json({ ok: false, msg: '用户名不能为空' });
  }

  await kv.hset(`user:${username}`, { 
    personalQuota: (personalQuota || 0).toString() 
  });

  if (personalQuota > 0) {
    const user = await kv.hgetall(`user:${username}`);
    if (user && user.status === 'locked') {
      const exportCount = parseInt(user.exportCount) || 0;
      const searchCount = parseInt(user.searchCount) || 0;
      const searchQuota = parseInt(user.searchQuota) || 0;
      // 检查两个配额是否都满足
      const exportOk = exportCount < personalQuota;
      const searchOk = searchQuota === 0 || searchCount < searchQuota;
      if (exportOk && searchOk) {
        await kv.hset(`user:${username}`, { status: 'approved' });
      }
    }
  }

  return res.status(200).json({ ok: true, msg: '导出配额已更新' });
}

// 【新增】设置搜索配额
async function setSearchQuota(body, res) {
  const { username, searchQuota } = body;

  if (!username) {
    return res.status(400).json({ ok: false, msg: '用户名不能为空' });
  }

  await kv.hset(`user:${username}`, { 
    searchQuota: (searchQuota || 0).toString() 
  });

  if (searchQuota > 0) {
    const user = await kv.hgetall(`user:${username}`);
    if (user && user.status === 'locked') {
      const searchCount = parseInt(user.searchCount) || 0;
      const exportCount = parseInt(user.exportCount) || 0;
      const personalQuota = parseInt(user.personalQuota) || 0;
      // 检查两个配额是否都满足
      const searchOk = searchCount < searchQuota;
      const exportOk = personalQuota === 0 || exportCount < personalQuota;
      if (searchOk && exportOk) {
        await kv.hset(`user:${username}`, { status: 'approved' });
      }
    }
  }

  return res.status(200).json({ ok: true, msg: '搜索配额已更新' });
}

// 重置导出数
async function resetExport(body, res) {
  const { username } = body;

  if (!username) {
    return res.status(400).json({ ok: false, msg: '用户名不能为空' });
  }

  const user = await kv.hgetall(`user:${username}`);
  
  await kv.hset(`user:${username}`, { exportCount: '0' });

  // 检查是否可以解锁
  if (user && user.status === 'locked') {
    const searchQuota = parseInt(user.searchQuota) || 0;
    const searchCount = parseInt(user.searchCount) || 0;
    if (searchQuota === 0 || searchCount < searchQuota) {
      await kv.hset(`user:${username}`, { status: 'approved' });
    }
  }

  return res.status(200).json({ ok: true, msg: '导出数已重置' });
}

// 【新增】重置搜索数
async function resetSearch(body, res) {
  const { username } = body;

  if (!username) {
    return res.status(400).json({ ok: false, msg: '用户名不能为空' });
  }

  const user = await kv.hgetall(`user:${username}`);
  
  await kv.hset(`user:${username}`, { searchCount: '0' });

  // 检查是否可以解锁
  if (user && user.status === 'locked') {
    const personalQuota = parseInt(user.personalQuota) || 0;
    const exportCount = parseInt(user.exportCount) || 0;
    if (personalQuota === 0 || exportCount < personalQuota) {
      await kv.hset(`user:${username}`, { status: 'approved' });
    }
  }

  return res.status(200).json({ ok: true, msg: '搜索数已重置' });
}

// 添加线路
async function addLine(body, res) {
  const { name, quota, quotaMode } = body;

  if (!name) {
    return res.status(400).json({ ok: false, msg: '线路名称不能为空' });
  }

  const exists = await kv.sismember('lines', name);
  if (exists) {
    return res.status(400).json({ ok: false, msg: '线路已存在' });
  }

  await kv.sadd('lines', name);
  await kv.hset(`line:${name}`, {
    name,
    quota: (quota || 0).toString(),
    used: '0',
    quotaMode: quotaMode || 'shared',
    enabled: 'true',
    createdAt: Date.now().toString()
  });

  return res.status(200).json({ ok: true, msg: '线路已添加' });
}

// 设置线路配额
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

  return res.status(200).json({ ok: true, msg: '配额已更新' });
}

// 重置线路用量
async function resetLineUsage(body, res) {
  const { name } = body;

  if (!name) {
    return res.status(400).json({ ok: false, msg: '线路名称不能为空' });
  }

  await kv.hset(`line:${name}`, { used: '0' });

  const users = await kv.smembers('users');
  for (const username of users) {
    const user = await kv.hgetall(`user:${username}`);
    if (user && user.line === name && user.status === 'locked') {
      await kv.hset(`user:${username}`, { status: 'approved' });
    }
  }

  return res.status(200).json({ ok: true, msg: '用量已重置' });
}

// 删除线路
async function removeLine(body, res) {
  const { name } = body;

  if (!name) {
    return res.status(400).json({ ok: false, msg: '线路名称不能为空' });
  }

  await kv.srem('lines', name);
  await kv.del(`line:${name}`);

  const users = await kv.smembers('users');
  for (const username of users) {
    const user = await kv.hgetall(`user:${username}`);
    if (user && user.line === name) {
      await kv.hset(`user:${username}`, { line: '' });
    }
  }

  return res.status(200).json({ ok: true, msg: '线路已删除' });
}

// 批量设置线路
async function batchSetLine(body, res) {
  const { usernames, line } = body;

  if (!usernames || !Array.isArray(usernames) || usernames.length === 0) {
    return res.status(400).json({ ok: false, msg: '请选择用户' });
  }

  for (const username of usernames) {
    await kv.hset(`user:${username}`, { line: line || '' });
  }

  return res.status(200).json({ ok: true, msg: `已为 ${usernames.length} 个用户设置线路` });
}

// 批量设置有效期
async function batchSetExpire(body, res) {
  const { usernames, line, expireDays } = body;

  let targetUsers = usernames;

  if (line && (!usernames || usernames.length === 0)) {
    targetUsers = [];
    const allUsers = await kv.smembers('users');
    for (const username of allUsers) {
      const user = await kv.hgetall(`user:${username}`);
      if (user && user.line === line) {
        targetUsers.push(username);
      }
    }
  }

  if (!targetUsers || targetUsers.length === 0) {
    return res.status(400).json({ ok: false, msg: '没有找到目标用户' });
  }

  let expireAt = 0;
  if (expireDays && expireDays > 0) {
    expireAt = Date.now() + expireDays * 24 * 60 * 60 * 1000;
  }

  for (const username of targetUsers) {
    await kv.hset(`user:${username}`, { expireAt: expireAt.toString() });
  }

  return res.status(200).json({ ok: true, msg: `已为 ${targetUsers.length} 个用户设置有效期` });
}

// 批量设置导出配额
async function batchSetQuota(body, res) {
  const { usernames, line, totalQuota, personalQuota, mode } = body;

  if (line && totalQuota && mode === 'split') {
    const lineUsers = [];
    const allUsers = await kv.smembers('users');
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
      await kv.hset(`user:${username}`, { personalQuota: perUserQuota.toString() });
    }

    await kv.hset(`line:${line}`, { quotaMode: 'split', quota: totalQuota.toString() });

    return res.status(200).json({ 
      ok: true, 
      msg: `已将 ${totalQuota} 配额平摊给 ${lineUsers.length} 个用户，每人 ${perUserQuota}` 
    });
  }

  if (line && totalQuota && mode === 'shared') {
    await kv.hset(`line:${line}`, { quotaMode: 'shared', quota: totalQuota.toString() });

    const allUsers = await kv.smembers('users');
    for (const username of allUsers) {
      const user = await kv.hgetall(`user:${username}`);
      if (user && user.line === line) {
        await kv.hset(`user:${username}`, { personalQuota: '0' });
      }
    }

    return res.status(200).json({ ok: true, msg: `已设置线路 ${line} 共享配额为 ${totalQuota}` });
  }

  if (usernames && usernames.length > 0 && personalQuota !== undefined) {
    for (const username of usernames) {
      await kv.hset(`user:${username}`, { personalQuota: personalQuota.toString() });
      
      const user = await kv.hgetall(`user:${username}`);
      if (user && user.status === 'locked' && personalQuota > 0) {
        const exportCount = parseInt(user.exportCount) || 0;
        if (exportCount < personalQuota) {
          await kv.hset(`user:${username}`, { status: 'approved' });
        }
      }
    }

    return res.status(200).json({ ok: true, msg: `已为 ${usernames.length} 个用户设置导出配额` });
  }

  return res.status(400).json({ ok: false, msg: '参数不完整' });
}

// 【新增】批量设置搜索配额
async function batchSetSearchQuota(body, res) {
  const { usernames, line, searchQuota } = body;

  let targetUsers = usernames;

  if (line && (!usernames || usernames.length === 0)) {
    targetUsers = [];
    const allUsers = await kv.smembers('users');
    for (const username of allUsers) {
      const user = await kv.hgetall(`user:${username}`);
      if (user && user.line === line) {
        targetUsers.push(username);
      }
    }
  }

  if (!targetUsers || targetUsers.length === 0) {
    return res.status(400).json({ ok: false, msg: '没有找到目标用户' });
  }

  for (const username of targetUsers) {
    await kv.hset(`user:${username}`, { searchQuota: (searchQuota || 0).toString() });
    
    const user = await kv.hgetall(`user:${username}`);
    if (user && user.status === 'locked' && searchQuota > 0) {
      const searchCount = parseInt(user.searchCount) || 0;
      if (searchCount < searchQuota) {
        await kv.hset(`user:${username}`, { status: 'approved' });
      }
    }
  }

  return res.status(200).json({ ok: true, msg: `已为 ${targetUsers.length} 个用户设置搜索配额` });
}

// 批量重置导出数
async function batchResetExport(body, res) {
  const { usernames, line } = body;

  let targetUsers = usernames;

  if (line && (!usernames || usernames.length === 0)) {
    targetUsers = [];
    const allUsers = await kv.smembers('users');
    for (const username of allUsers) {
      const user = await kv.hgetall(`user:${username}`);
      if (user && user.line === line) {
        targetUsers.push(username);
      }
    }
  }

  if (!targetUsers || targetUsers.length === 0) {
    return res.status(400).json({ ok: false, msg: '没有找到目标用户' });
  }

  for (const username of targetUsers) {
    const user = await kv.hgetall(`user:${username}`);
    await kv.hset(`user:${username}`, { exportCount: '0' });
    
    if (user && user.status === 'locked') {
      await kv.hset(`user:${username}`, { status: 'approved' });
    }
  }

  return res.status(200).json({ ok: true, msg: `已重置 ${targetUsers.length} 个用户的导出数` });
}

// 【新增】批量重置搜索数
async function batchResetSearch(body, res) {
  const { usernames, line } = body;

  let targetUsers = usernames;

  if (line && (!usernames || usernames.length === 0)) {
    targetUsers = [];
    const allUsers = await kv.smembers('users');
    for (const username of allUsers) {
      const user = await kv.hgetall(`user:${username}`);
      if (user && user.line === line) {
        targetUsers.push(username);
      }
    }
  }

  if (!targetUsers || targetUsers.length === 0) {
    return res.status(400).json({ ok: false, msg: '没有找到目标用户' });
  }

  for (const username of targetUsers) {
    const user = await kv.hgetall(`user:${username}`);
    await kv.hset(`user:${username}`, { searchCount: '0' });
    
    if (user && user.status === 'locked') {
      await kv.hset(`user:${username}`, { status: 'approved' });
    }
  }

  return res.status(200).json({ ok: true, msg: `已重置 ${targetUsers.length} 个用户的搜索数` });
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

  const expireText = expireDays > 0 ? `${expireDays}天` : '永久';
  return res.status(200).json({ 
    ok: true, 
    msg: `已为 ${lineName} 线路的 ${lineUsers.length} 个用户设置有效期为 ${expireText}` 
  });
}
