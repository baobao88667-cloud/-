/**
 * 积分扣除 API
 * POST /api/export?action=report|deduct
 * 
 * report: 导出 CSV 时扣除积分（每个号码扣1积分）
 * deduct: 提取新标签时扣除积分（每个标签扣1积分）
 * 
 * 两者共用同一个积分池（exportCount / personalQuota 或 line.used / line.quota）
 */

import { kv } from './_db.js';

// 辅助函数：检查 enabled 字段是否为真
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

  try {
    switch (action) {
      case 'report':
        // 导出 CSV 时扣除积分
        return await handleDeductCredits(req.body || {}, res, 'export');
      case 'deduct':
        // 提取新标签时扣除积分
        return await handleDeductCredits(req.body || {}, res, 'extract');
      default:
        return res.status(400).json({ ok: false, msg: '未知操作' });
    }
  } catch (error) {
    console.error('Export API error:', error);
    return res.status(500).json({ ok: false, msg: '服务器错误' });
  }
}

/**
 * 统一的积分扣除处理函数
 * @param {Object} body - 请求体
 * @param {Object} res - 响应对象
 * @param {string} source - 来源：'export' 导出CSV, 'extract' 提取标签
 */
async function handleDeductCredits(body, res, source) {
  const { username, token, count } = body;

  if (!username || !token) {
    return res.status(400).json({ ok: false, msg: '参数不完整' });
  }

  if (!count || count <= 0) {
    return res.status(400).json({ ok: false, msg: '扣除数量无效' });
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
  if (!isEnabled(user.enabled)) {
    return res.status(403).json({ ok: false, msg: '账号已禁用', code: 'DISABLED' });
  }

  if (user.status === 'locked') {
    return res.status(403).json({ ok: false, msg: '账号已锁定（积分用完）', code: 'LOCKED' });
  }

  // 检查有效期
  const expireAt = parseInt(user.expireAt) || 0;
  if (expireAt > 0 && Date.now() > expireAt) {
    return res.status(403).json({ ok: false, msg: '账号已过期', code: 'EXPIRED' });
  }

  const personalQuota = parseInt(user.personalQuota) || 0;
  const currentExportCount = parseInt(user.exportCount) || 0;
  const newExportCount = currentExportCount + count;

  // 检查个人积分
  if (personalQuota > 0) {
    if (newExportCount > personalQuota) {
      // 锁定用户
      await kv.hset(`user:${username}`, { status: 'locked' });
      
      return res.status(403).json({
        ok: false,
        msg: `积分已用完（${personalQuota.toLocaleString()}），如需继续使用请联系管理员`,
        code: 'CREDITS_EXCEEDED',
        creditsInfo: {
          type: 'personal',
          credits: personalQuota,
          used: newExportCount
        }
      });
    }
  } else if (user.line) {
    // 检查团队积分
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
            msg: `团队积分已用完（${lineQuota.toLocaleString()}），如需继续使用请联系管理员`,
            code: 'CREDITS_EXCEEDED',
            creditsInfo: {
              type: 'line',
              lineName: user.line,
              credits: lineQuota,
              used: newLineUsed
            }
          });
        }

        // 更新团队用量
        await kv.hincrby(`line:${user.line}`, 'used', count);
      }
    }
  }

  // 更新用户使用数
  await kv.hincrby(`user:${username}`, 'exportCount', count);

  // 记录历史（区分来源）
  const historyEntry = JSON.stringify({
    count,
    source, // 'export' 或 'extract'
    timestamp: Date.now()
  });
  await kv.lpush(`export_history:${username}`, historyEntry);

  // 构建响应
  const response = {
    ok: true,
    msg: source === 'export' ? '导出记录已上报' : '积分已扣除',
    userUsedCount: newExportCount,
    deductedCount: count,
    source
  };

  // 添加积分信息
  if (personalQuota > 0) {
    response.personalCredits = personalQuota;
    response.remaining = personalQuota - newExportCount;
    const remaining = personalQuota - newExportCount;
    if (remaining < personalQuota * 0.2) {
      response.warning = `个人积分剩余 ${remaining.toLocaleString()}`;
    }
  } else if (user.line) {
    const lineData = await kv.hgetall(`line:${user.line}`);
    if (lineData) {
      const lineQuota = parseInt(lineData.quota) || 0;
      const lineUsed = parseInt(lineData.used) || 0;
      response.lineInfo = {
        name: user.line,
        credits: lineQuota,
        used: lineUsed
      };
      response.remaining = lineQuota > 0 ? lineQuota - lineUsed : -1; // -1 表示无限制
    }
  }

  return res.status(200).json(response);
}
