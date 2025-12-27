/**
 * 积分扣除 API
 * POST /api/export?action=report|deduct
 * v6.3.0 - 时间和积分完全独立
 * 
 * report: 导出 CSV 时扣除积分（每个号码扣1积分）
 * deduct: 提取新标签时扣除积分（每个标签扣1积分）
 * 
 * 【核心逻辑】时间和积分完全独立：
 * 1. 有有效时间（未到期）→ 正常用户，不消耗积分
 * 2. 时间到期或未设置时间 → 检查积分：
 *    - 积分 ≥ 100 → 正常用户，消耗积分
 *    - 积分 < 100 → 访客模式
 */

import { kv } from './_db.js';

// 积分下限配置
const CREDITS_MIN_THRESHOLD = 100;

// 辅助函数：检查 enabled 字段是否为真
function isEnabled(value) {
  return value === 'true' || value === true || value === '1' || value === 1;
}

/**
 * 计算用户的实际模式状态
 * v6.3.0 - 时间和积分完全独立
 * 
 * @param {Object} user - 用户数据
 * @param {Object} lineData - 团队数据（可选）
 * @returns {Object} - { mode, reason, useCredits, hasValidTime, remainingCredits }
 */
function calculateUserMode(user, lineData = null) {
  const userMode = user.userMode || 'guest';
  
  // 如果管理员设置为访客，直接返回访客
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
      // 积分 < 100，变为访客
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
  
  // 没有有效时间，也没有积分设置
  return { mode: 'guest', reason: 'no_time_no_credits', useCredits: false, hasValidTime: false, remainingCredits: 0 };
}

/**
 * 获取访客原因的中文描述
 */
function getGuestReasonMessage(reason) {
  const messages = {
    'admin_set': '您当前为访客模式，请联系管理员升级',
    'credits_below_threshold': `您的积分低于 ${CREDITS_MIN_THRESHOLD}，请联系管理员充值`,
    'line_credits_below_threshold': `您的团队积分低于 ${CREDITS_MIN_THRESHOLD}，请联系管理员`,
    'credits_exhausted': '您的积分已用完，请联系管理员充值',
    'no_time_no_credits': '您没有有效时间和积分，请联系管理员设置'
  };
  return messages[reason] || '您当前为访客模式';
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

  // 获取团队数据
  let lineData = null;
  if (user.line) {
    lineData = await kv.hgetall(`line:${user.line}`);
  }

  // 检查用户模式
  const modeResult = calculateUserMode(user, lineData);
  
  // 访客不能执行操作
  if (modeResult.mode === 'guest') {
    return res.status(403).json({
      ok: false,
      msg: getGuestReasonMessage(modeResult.reason),
      code: 'GUEST_MODE',
      modeInfo: {
        mode: 'guest',
        reason: modeResult.reason
      }
    });
  }

  // 【时间模式】有有效时间，不扣除积分，直接返回成功
  if (modeResult.hasValidTime) {
    return res.status(200).json({
      ok: true,
      msg: '操作成功（时间模式，不消耗积分）',
      userUsedCount: parseInt(user.exportCount) || 0,
      deductedCount: 0,
      source,
      timeMode: true,
      modeInfo: {
        mode: 'normal',
        reason: null,
        hasValidTime: true
      }
    });
  }

  // 【积分模式】需要扣除积分
  const personalQuota = parseInt(user.personalQuota) || 0;
  const currentExportCount = parseInt(user.exportCount) || 0;
  const newExportCount = currentExportCount + count;
  const newRemaining = personalQuota - newExportCount;

  // 检查扣除后积分是否会低于阈值
  if (personalQuota > 0) {
    if (newRemaining < 0) {
      // 积分不足以扣除
      return res.status(403).json({
        ok: false,
        msg: `积分不足，需要 ${count} 积分，剩余 ${personalQuota - currentExportCount} 积分`,
        code: 'CREDITS_EXCEEDED',
        modeInfo: {
          mode: 'guest',
          reason: 'credits_exhausted'
        },
        creditsInfo: {
          type: 'personal',
          credits: personalQuota,
          used: currentExportCount,
          remaining: personalQuota - currentExportCount
        }
      });
    }
  } else if (user.line && lineData) {
    // 检查团队积分
    const lineQuota = parseInt(lineData.quota) || 0;
    const lineUsed = parseInt(lineData.used) || 0;
    const quotaMode = lineData.quotaMode || 'shared';

    if (quotaMode === 'shared' && lineQuota > 0) {
      const newLineUsed = lineUsed + count;
      const newLineRemaining = lineQuota - newLineUsed;
      
      if (newLineRemaining < 0) {
        return res.status(403).json({
          ok: false,
          msg: `团队积分不足，需要 ${count} 积分，剩余 ${lineQuota - lineUsed} 积分`,
          code: 'CREDITS_EXCEEDED',
          modeInfo: {
            mode: 'guest',
            reason: 'line_credits_exhausted'
          },
          creditsInfo: {
            type: 'line',
            lineName: user.line,
            credits: lineQuota,
            used: lineUsed,
            remaining: lineQuota - lineUsed
          }
        });
      }

      // 更新团队用量
      await kv.hincrby(`line:${user.line}`, 'used', count);
    }
  }

  // 更新用户使用数
  await kv.hincrby(`user:${username}`, 'exportCount', count);

  // 记录历史
  const historyEntry = JSON.stringify({
    count,
    source,
    timestamp: Date.now()
  });
  await kv.lpush(`export_history:${username}`, historyEntry);

  // 构建响应
  const response = {
    ok: true,
    msg: source === 'export' ? '导出成功，已扣除积分' : '提取成功，已扣除积分',
    userUsedCount: newExportCount,
    deductedCount: count,
    source,
    timeMode: false,
    modeInfo: {
      mode: 'normal',
      reason: null,
      hasValidTime: false
    }
  };

  // 添加积分信息
  if (personalQuota > 0) {
    response.personalCredits = personalQuota;
    response.remaining = newRemaining;
    
    // 检查扣除后是否低于阈值
    if (newRemaining < CREDITS_MIN_THRESHOLD) {
      response.warning = `积分剩余 ${newRemaining}，低于 ${CREDITS_MIN_THRESHOLD} 将变为访客模式`;
      response.becameGuest = true;
      response.guestReason = 'credits_below_threshold';
      response.modeInfo = {
        mode: 'guest',
        reason: 'credits_below_threshold'
      };
    }
  } else if (user.line) {
    const updatedLineData = await kv.hgetall(`line:${user.line}`);
    if (updatedLineData) {
      const lineQuota = parseInt(updatedLineData.quota) || 0;
      const lineUsed = parseInt(updatedLineData.used) || 0;
      const lineRemaining = lineQuota - lineUsed;
      
      response.lineInfo = {
        name: user.line,
        credits: lineQuota,
        used: lineUsed
      };
      response.remaining = lineQuota > 0 ? lineRemaining : -1;
      
      // 检查扣除后是否低于阈值
      if (lineQuota > 0 && lineRemaining < CREDITS_MIN_THRESHOLD) {
        response.warning = `团队积分剩余 ${lineRemaining}，低于 ${CREDITS_MIN_THRESHOLD} 将变为访客模式`;
        response.becameGuest = true;
        response.guestReason = 'line_credits_below_threshold';
        response.modeInfo = {
          mode: 'guest',
          reason: 'line_credits_below_threshold'
        };
      }
    }
  }

  return res.status(200).json(response);
}
