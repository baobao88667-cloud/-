/**
 * 导出/搜索配额 API
 * POST /api/export?action=report|search
 * v2.0.0 - 双重配额版本
 * 
 * action=report: 导出配额扣减（每个号码 -1）
 * action=search: 搜索配额扣减（每个标签页 -1）
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

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, msg: '方法不允许' });
  }

  const action = req.query.action;

  try {
    switch (action) {
      case 'report':
        return await handleExportReport(req.body || {}, res);
      case 'search':
        return await handleSearchDeduct(req.body || {}, res);
      default:
        return res.status(400).json({ ok: false, msg: '未知操作' });
    }
  } catch (error) {
    console.error('Export API error:', error);
    return res.status(500).json({ ok: false, msg: '服务器错误' });
  }
}

// 【新增】搜索配额扣减
async function handleSearchDeduct(body, res) {
  const { username, token, count } = body;

  if (!username || !token) {
    return res.status(400).json({ ok: false, msg: '参数不完整' });
  }

  const deductCount = parseInt(count) || 1;
  if (deductCount <= 0) {
    return res.status(400).json({ ok: false, msg: '扣减数量无效' });
  }

  // 验证用户和 Token
  const user = await kv.hgetall(`user:${username}`);
  if (!user) {
    return res.status(401).json({ ok: false, msg: '用户不存在', code: 'INVALID_TOKEN' });
  }

  if (user.currentToken !== token) {
    return res.status(401).json({ ok: false, msg: '登录已失效', code: 'KICKED' });
  }

  // 检查用户状态
  if (user.enabled !== 'true' && user.enabled !== true) {
    return res.status(403).json({ ok: false, msg: '账号已禁用', code: 'DISABLED' });
  }

  if (user.status === 'locked') {
    return res.status(403).json({ ok: false, msg: '账号已锁定', code: 'LOCKED' });
  }

  // 检查有效期
  const expireAt = parseInt(user.expireAt) || 0;
  if (expireAt > 0 && Date.now() > expireAt) {
    return res.status(403).json({ ok: false, msg: '账号已过期', code: 'EXPIRED' });
  }

  const searchQuota = parseInt(user.searchQuota) || 0;
  const currentSearchCount = parseInt(user.searchCount) || 0;
  const newSearchCount = currentSearchCount + deductCount;

  // 检查搜索配额（0 表示无限制）
  if (searchQuota > 0) {
    if (newSearchCount > searchQuota) {
      // 锁定用户
      await kv.hset(`user:${username}`, { status: 'locked' });
      
      return res.status(403).json({
        ok: false,
        msg: `搜索配额已用完（${searchQuota.toLocaleString()}次），如需继续使用请联系管理员`,
        code: 'SEARCH_QUOTA_EXCEEDED',
        searchQuotaInfo: {
          quota: searchQuota,
          used: newSearchCount
        }
      });
    }
  }

  // 更新搜索次数
  await kv.hincrby(`user:${username}`, 'searchCount', deductCount);

  // 构建响应
  const response = {
    ok: true,
    msg: '搜索配额已扣减',
    searchCount: newSearchCount,
    searchQuota: searchQuota
  };

  // 添加配额警告
  if (searchQuota > 0) {
    const remaining = searchQuota - newSearchCount;
    response.remaining = remaining;
    if (remaining < searchQuota * 0.2) {
      response.warning = `搜索配额剩余 ${remaining.toLocaleString()} 次`;
    }
  }

  return res.status(200).json(response);
}

// 导出配额扣减（原有功能）
async function handleExportReport(body, res) {
  const { username, token, count } = body;

  if (!username || !token) {
    return res.status(400).json({ ok: false, msg: '参数不完整' });
  }

  if (!count || count <= 0) {
    return res.status(400).json({ ok: false, msg: '导出数量无效' });
  }

  // 验证用户和 Token
  const user = await kv.hgetall(`user:${username}`);
  if (!user) {
    return res.status(401).json({ ok: false, msg: '用户不存在', code: 'INVALID_TOKEN' });
  }

  if (user.currentToken !== token) {
    return res.status(401).json({ ok: false, msg: '登录已失效', code: 'KICKED' });
  }

  // 检查用户状态
  if (user.enabled !== 'true' && user.enabled !== true) {
    return res.status(403).json({ ok: false, msg: '账号已禁用', code: 'DISABLED' });
  }

  if (user.status === 'locked') {
    return res.status(403).json({ ok: false, msg: '账号已锁定', code: 'LOCKED' });
  }

  // 检查有效期
  const expireAt = parseInt(user.expireAt) || 0;
  if (expireAt > 0 && Date.now() > expireAt) {
    return res.status(403).json({ ok: false, msg: '账号已过期', code: 'EXPIRED' });
  }

  const personalQuota = parseInt(user.personalQuota) || 0;
  const currentExportCount = parseInt(user.exportCount) || 0;
  const newExportCount = currentExportCount + count;

  // 检查个人配额
  if (personalQuota > 0) {
    if (newExportCount > personalQuota) {
      // 锁定用户
      await kv.hset(`user:${username}`, { status: 'locked' });
      
      return res.status(403).json({
        ok: false,
        msg: `导出配额已用完（${personalQuota.toLocaleString()}个），如需继续使用请联系管理员`,
        code: 'QUOTA_EXCEEDED',
        quotaInfo: {
          type: 'personal',
          quota: personalQuota,
          used: newExportCount
        }
      });
    }
  } else if (user.line) {
    // 检查线路配额
    const lineData = await kv.hgetall(`line:${user.line}`);
    if (lineData) {
      const lineQuota = parseInt(lineData.quota) || 0;
      const lineUsed = parseInt(lineData.used) || 0;
      const quotaMode = lineData.quotaMode || 'shared';

      if (quotaMode === 'shared' && lineQuota > 0) {
        const newLineUsed = lineUsed + count;
        if (newLineUsed > lineQuota) {
          // 锁定用户
          await kv.hset(`user:${username}`, { status: 'locked' });
          
          return res.status(403).json({
            ok: false,
            msg: `团队配额已用完（${lineQuota.toLocaleString()}），如需继续使用请联系管理员`,
            code: 'QUOTA_EXCEEDED',
            quotaInfo: {
              type: 'line',
              lineName: user.line,
              quota: lineQuota,
              used: newLineUsed
            }
          });
        }

        // 更新线路用量
        await kv.hincrby(`line:${user.line}`, 'used', count);
      }
    }
  }

  // 更新用户导出数
  await kv.hincrby(`user:${username}`, 'exportCount', count);

  // 记录导出历史
  const historyEntry = JSON.stringify({
    count,
    timestamp: Date.now()
  });
  await kv.lpush(`export_history:${username}`, historyEntry);

  // 构建响应
  const response = {
    ok: true,
    msg: '导出记录已上报',
    userExportCount: newExportCount
  };

  // 添加配额信息
  if (personalQuota > 0) {
    response.personalQuota = personalQuota;
    const remaining = personalQuota - newExportCount;
    if (remaining < personalQuota * 0.2) {
      response.warning = `导出配额剩余 ${remaining.toLocaleString()}`;
    }
  } else if (user.line) {
    const lineData = await kv.hgetall(`line:${user.line}`);
    if (lineData) {
      response.lineInfo = {
        name: user.line,
        quota: parseInt(lineData.quota) || 0,
        used: parseInt(lineData.used) || 0
      };
    }
  }

  return res.status(200).json(response);
}
