/**
 * 系统状态 API
 * GET /api/status
 */

import { kv } from './_db.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req, res) {
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
    const config = await kv.hgetall('system:config') || {};

    return res.status(200).json({
      ok: true,
      status: 'online',
      maintenance: config.maintenance === 'true',
      maintenanceMessage: config.maintenanceMessage || '',
      announcement: config.announcementEnabled === 'true' ? (config.announcement || '') : '',
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Status API error:', error);
    return res.status(500).json({ ok: false, msg: '服务器错误' });
  }
}
