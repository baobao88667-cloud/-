/**
 * 版本检查 API
 * GET /api/version-check?v=6.4.3
 * 
 * 此端点为公开端点，无需认证
 * 插件在启动时调用此端点检查版本是否被锁定
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
 * @returns {number} - 负数表示v1<v2, 0表示相等, 正数表示v1>v2
 */
function compareVersions(v1, v2) {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  
  for (let i = 0; i < 3; i++) {
    const num1 = parts1[i] || 0;
    const num2 = parts2[i] || 0;
    if (num1 !== num2) {
      return num1 - num2;
    }
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
    // 获取插件版本号
    const pluginVersion = req.query.v;
    
    if (!pluginVersion) {
      return res.status(400).json({ 
        ok: false, 
        locked: false,
        msg: '缺少版本号参数' 
      });
    }

    // 验证版本号格式
    const versionRegex = /^\d+\.\d+\.\d+$/;
    if (!versionRegex.test(pluginVersion)) {
      return res.status(400).json({ 
        ok: false, 
        locked: false,
        msg: '版本号格式无效' 
      });
    }

    // 获取版本控制设置
    const versionControl = await kv.hgetall('tps:version_control');
    
    // 如果没有设置版本控制，或者未启用，返回未锁定
    if (!versionControl || versionControl.enabled !== 'true') {
      return res.status(200).json({
        ok: true,
        locked: false,
        minVersion: '0.0.0',
        message: ''
      });
    }

    const minVersion = versionControl.minVersion || '0.0.0';
    const lockMessage = versionControl.lockMessage || '已更新请找管理员拿最新版本';

    // 比较版本号
    const comparison = compareVersions(pluginVersion, minVersion);
    
    if (comparison < 0) {
      // 插件版本低于最低要求，锁定
      return res.status(200).json({
        ok: true,
        locked: true,
        minVersion: minVersion,
        currentVersion: pluginVersion,
        message: lockMessage
      });
    }

    // 版本符合要求，未锁定
    return res.status(200).json({
      ok: true,
      locked: false,
      minVersion: minVersion,
      currentVersion: pluginVersion,
      message: ''
    });

  } catch (error) {
    console.error('Version check error:', error);
    return res.status(500).json({ 
      ok: false, 
      locked: false,
      msg: '服务器错误: ' + error.message 
    });
  }
}
