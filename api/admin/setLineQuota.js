import { kv } from '../_db.js';

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, msg: 'Method not allowed' });
  }
  
  try {
    const { name, quota } = req.body;
    
    if (!name) {
      return res.json({ ok: false, msg: '线路名称不能为空' });
    }
    
    // 检查线路是否存在
    const lineData = await kv.hgetall(`line:${name}`);
    if (!lineData) {
      return res.json({ ok: false, msg: '线路不存在' });
    }
    
    // 更新配额
    await kv.hset(`line:${name}`, {
      quota: String(quota || 0)
    });
    
    return res.json({ ok: true, msg: '配额更新成功' });
    
  } catch (error) {
    console.error('Set line quota error:', error);
    return res.status(500).json({ ok: false, msg: '服务器错误' });
  }
}
