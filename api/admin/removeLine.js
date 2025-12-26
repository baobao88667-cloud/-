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
    const { name } = req.body;
    
    if (!name) {
      return res.json({ ok: false, msg: '线路名称不能为空' });
    }
    
    // 检查是否有用户在使用该线路
    const allUsers = await kv.smembers('users') || [];
    for (const username of allUsers) {
      const userData = await kv.hgetall(`user:${username}`);
      if (userData && userData.line === name) {
        return res.json({ ok: false, msg: '该线路下还有用户，无法删除' });
      }
    }
    
    // 删除线路
    await kv.del(`line:${name}`);
    await kv.srem('lines', name);
    
    return res.json({ ok: true, msg: '线路已删除' });
    
  } catch (error) {
    console.error('Remove line error:', error);
    return res.status(500).json({ ok: false, msg: '服务器错误' });
  }
}
