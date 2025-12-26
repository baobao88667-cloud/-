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
    const { username, password } = req.body;
    
    // 验证输入
    if (!username || !password) {
      return res.json({ ok: false, msg: '用户名和密码不能为空' });
    }
    
    const cleanUsername = username.trim().toLowerCase();
    
    // 用户名格式验证：只能是数字和字母，长度3-20位
    if (!/^[a-zA-Z0-9]{3,20}$/.test(cleanUsername)) {
      return res.json({ 
        ok: false, 
        msg: '用户名只能包含字母和数字，长度3-20位，不能包含汉字、符号或下划线' 
      });
    }
    
    // 密码长度验证
    if (password.length < 6) {
      return res.json({ ok: false, msg: '密码长度至少6位' });
    }
    
    // 密码格式验证：只能是数字和字母
    if (!/^[a-zA-Z0-9]{6,30}$/.test(password)) {
      return res.json({ 
        ok: false, 
        msg: '密码只能包含字母和数字，长度6-30位' 
      });
    }
    
    // 检查用户是否已存在
    const existing = await kv.hgetall(`user:${cleanUsername}`);
    if (existing) {
      return res.json({ ok: false, msg: '用户名已存在' });
    }
    
    // 检查是否在待审核列表中
    const isPending = await kv.sismember('pending_users', cleanUsername);
    if (isPending) {
      return res.json({ ok: false, msg: '该用户名正在等待审核' });
    }
    
    // 创建用户（待审核状态）
    // 注意：为了管理员能查看密码，这里存储原始密码
    // 实际生产环境建议使用可逆加密
    await kv.hset(`user:${cleanUsername}`, {
      password: password,              // 明文存储，方便管理员查看
      status: 'pending',               // pending | approved | disabled | locked
      enabled: 'false',
      line: '',                        // 所属线路，审核时分配
      expireAt: '0',                   // 有效期，0=永不过期
      exportCount: '0',                // 导出数量
      maxDevices: '1',                 // 单设备限制
      devices: '[]',
      currentToken: '',
      tokenCreatedAt: '0',
      createdAt: new Date().toISOString()
    });
    
    // 添加到待审核列表
    await kv.sadd('pending_users', cleanUsername);
    
    return res.json({ 
      ok: true, 
      msg: '注册成功，请等待管理员审核' 
    });
    
  } catch (error) {
    console.error('Register error:', error);
    return res.status(500).json({ ok: false, msg: '服务器错误' });
  }
}
