/**
 * 版本检查 API
 * GET /api/version-check?v=6.4.3
 * 
 * 公开端点，无需认证
 * 用于插件启动时检查版本是否被锁定
 */

import { kv } from './_db.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/**
 * 比较版本号
 * @param {string} v1 - 版本号1 (如 "6.4.3")
 * @param {string} v2 - 版本号2 (如 "6.5.0")
 * @returns {number} - -1: v1 < v2, 0: v1 == v2, 1: v1 > v2
 */
function compareVersions(v1, v2) {
  const parts1 = (v1 || '0.0.0').split('.').map(Number);
  const parts2 = (v2 || '0.0.0').split('.').map(Number);
  
  for (let i = 0; i < 3; i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 < p2) return -1;
    if (p1 > p2) return 1;
  }
  return 0;
}

export default async function handler(req, res) {
  // 设置 CORS 头
  Object.entries(corsHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, msg: '方法不允许' });
  }

  try {
    const clientVersion = req.query.v || '0.0.0';
    
    // 获取版本控制配置
    const versionControl = await kv.hgetall('system:version_control') || {};
    
    // 修复：同时支持布尔值和字符串
    const enabled = versionControl.enabled === true || versionControl.enabled === 'true';
    const minVersion = versionControl.minVersion || '0.0.0';
    const lockMessage = versionControl.lockMessage || '已更新请找管理员拿最新版本';
    
    // 如果版本控制未启用，直接返回允许
    if (!enabled) {
      return res.status(200).json({
        ok: true,
        locked: false,
        currentVersion: clientVersion,
        minVersion: null,
        message: null
      });
    }
    
    // 比较版本号
    const comparison = compareVersions(clientVersion, minVersion);
    
    if (comparison < 0) {
      // 客户端版本低于最低要求，锁定
      return res.status(200).json({
        ok: true,
        locked: true,
        currentVersion: clientVersion,
        minVersion: minVersion,
        message: lockMessage
      });
    }
    
    // 版本符合要求
    return res.status(200).json({
      ok: true,
      locked: false,
      currentVersion: clientVersion,
      minVersion: minVersion,
      message: null
    });
    
  } catch (error) {
    console.error('Version check error:', error);
    // 出错时默认不锁定，避免影响用户使用
    return res.status(200).json({
      ok: true,
      locked: false,
      error: true,
      message: '版本检查服务暂时不可用'
    });
  }
}
