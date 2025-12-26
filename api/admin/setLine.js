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
    const { name, line } = req.body;
    
    if (!name) {
      return res.json({ ok: false, msg: '用户名不能为空' });
    }
    
    const username = name.trim().toLowerCase();
    
    // 检查用户是否存在
    const userData = await kv.hgetall(`user:${username}`);
    if (!userData) {
      return res.json({ ok: false, msg: '用户不存在' });
    }
    
    // 检查线路是否存在（如果指定了线路）
    if (line) {
      const lineData = await kv.hgetall(`line:${line}`);
      if (!lineData) {
        return res.json({ ok: false, msg: '指定的线路不存在' });
      }
    }
    
    // 更新用户线路
    await kv.hset(`user:${username}`, {
      line: line || ''
    });
    
    return res.json({ ok: true, msg: line ? `已分配到线路 ${line}` : '已移除线路分配' });
    
  } catch (error) {
    console.error('Set line error:', error);
    return res.status(500).json({ ok: false, msg: '服务器错误' });
  }
}
