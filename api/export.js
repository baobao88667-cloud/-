/**
 * 导出上报 API
 * POST /api/export?action=report
 * v4.0.2 - 修复 enabled 字段兼容性
 */

import { kv } from './_db.js';

// 【修复】辅助函数：检查 enabled 字段是否为真（兼容多种格式）
function isEnabled(value) {
  return value === 'true' || value === true || value === '1' || value === 1;
}

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

  if (action !== 'report') {
    return res.status(400).json({ ok: false, msg: '未知操作' });
  }

  try {
    return await handleReport(req.body || {}, res);
  } catch (error) {
    console.error('Export API error:', error);
    return res.status(500).json({ ok: false, msg: '服务器错误' });
  }
}

async function handleReport(body, res) {
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

  // 【修复】检查用户状态 - 使用 isEnabled 兼容多种格式
  if (!isEnabled(user.enabled)) {
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
        msg: `已达到 ${personalQuota.toLocaleString()} 数量待机中，如需继续使用请联系管理员`,
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
      response.warning = `个人配额剩余 ${remaining.toLocaleString()}`;
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
