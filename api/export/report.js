import { kv } from '../_db.js';

/**
 * 上报导出数量
 * POST /api/export/report
 * Body: { username: string, token: string, count: number, details?: any }
 * 
 * 配额检查逻辑：
 * 1. 如果用户有个人配额(personalQuota > 0)，检查个人配额
 * 2. 否则如果用户有线路，检查线路配额（共享模式）
 * 3. 如果都没有，不限制
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, msg: 'Method not allowed' });
  
  try {
    const { username, token, count, details } = req.body;
    
    if (!username || !token) {
      return res.json({ ok: false, msg: '缺少验证信息' });
    }
    
    if (!count || count <= 0) {
      return res.json({ ok: false, msg: '导出数量无效' });
    }
    
    const cleanUsername = username.trim().toLowerCase();
    
    // 验证用户和 Token
    const userData = await kv.hgetall(`user:${cleanUsername}`);
    if (!userData) {
      return res.json({ ok: false, msg: '用户不存在' });
    }
    
    if (userData.currentToken !== token) {
      return res.json({ ok: false, msg: 'Token 无效', code: 'INVALID_TOKEN' });
    }
    
    // 检查用户状态
    if (userData.status === 'disabled' || userData.enabled === 'false') {
      return res.json({ ok: false, msg: '账号已被禁用', code: 'DISABLED' });
    }
    
    if (userData.status === 'locked') {
      return res.json({ ok: false, msg: '账号已被锁定（配额已用完）', code: 'LOCKED' });
    }
    
    if (userData.status !== 'approved') {
      return res.json({ ok: false, msg: '用户状态异常', code: 'INVALID_STATUS' });
    }
    
    // 获取当前导出数和配额信息
    const currentExportCount = parseInt(userData.exportCount) || 0;
    const personalQuota = parseInt(userData.personalQuota) || 0;
    const lineName = userData.line;
    
    let quotaExceeded = false;
    let quotaType = 'none';
    let quotaLimit = 0;
    let quotaUsed = 0;
    
    // 检查配额 - 优先检查个人配额
    if (personalQuota > 0) {
      quotaType = 'personal';
      quotaLimit = personalQuota;
      quotaUsed = currentExportCount + count;
      
      if (quotaUsed > personalQuota) {
        quotaExceeded = true;
      }
    } else if (lineName) {
      // 没有个人配额，检查线路配额（共享模式）
      const lineData = await kv.hgetall(`line:${lineName}`);
      if (lineData) {
        const lineQuota = parseInt(lineData.quota) || 0;
        const lineUsed = parseInt(lineData.used) || 0;
        
        if (lineQuota > 0) {
          quotaType = 'line';
          quotaLimit = lineQuota;
          quotaUsed = lineUsed + count;
          
          if (quotaUsed > lineQuota) {
            quotaExceeded = true;
          }
        }
      }
    }
    
    // 如果配额超限，锁定用户并返回错误
    if (quotaExceeded) {
      await kv.hset(`user:${cleanUsername}`, { status: 'locked' });
      
      return res.json({ 
        ok: false, 
        msg: `已达到 ${quotaLimit.toLocaleString()} 数量待机中，如需继续使用请联系管理员`,
        code: 'QUOTA_EXCEEDED',
        quotaInfo: {
          type: quotaType,
          quota: quotaLimit,
          used: quotaUsed
        }
      });
    }
    
    // 更新用户导出计数
    const newUserCount = await kv.hincrby(`user:${cleanUsername}`, 'exportCount', count);
    
    // 如果有线路，更新线路用量
    let lineInfo = null;
    if (lineName) {
      const lineExists = await kv.exists(`line:${lineName}`);
      if (lineExists) {
        const newLineUsed = await kv.hincrby(`line:${lineName}`, 'used', count);
        const lineData = await kv.hgetall(`line:${lineName}`);
        if (lineData) {
          lineInfo = {
            name: lineName,
            quota: parseInt(lineData.quota) || 0,
            used: newLineUsed
          };
        }
      }
    }
    
    // 记录导出历史
    const historyRecord = JSON.stringify({
      count: count,
      timestamp: new Date().toISOString(),
      details: details || null
    });
    await kv.lpush(`export_history:${cleanUsername}`, historyRecord);
    
    // 检查是否接近配额（用于返回警告）
    let warning = null;
    if (personalQuota > 0) {
      const remaining = personalQuota - newUserCount;
      if (remaining > 0 && remaining <= personalQuota * 0.1) {
        warning = `个人配额剩余 ${remaining.toLocaleString()}`;
      }
    } else if (lineInfo && lineInfo.quota > 0) {
      const remaining = lineInfo.quota - lineInfo.used;
      if (remaining > 0 && remaining <= lineInfo.quota * 0.1) {
        warning = `线路配额剩余 ${remaining.toLocaleString()}`;
      }
    }
    
    // 返回结果
    return res.json({
      ok: true,
      msg: '导出记录已上报',
      userExportCount: newUserCount,
      personalQuota: personalQuota,
      lineInfo: lineInfo,
      warning: warning
    });
    
  } catch (error) {
    console.error('Export report error:', error);
    return res.status(500).json({ ok: false, msg: '服务器错误' });
  }
}
