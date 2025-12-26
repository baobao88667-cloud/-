# TPS Helper 认证服务器 V2

基于 Vercel Serverless Functions + Redis 的认证服务器，支持用户注册审核、团队配额管理、时间限制等功能。

## 功能特性

### 用户管理
- ✅ 用户自助注册（用户名只能字母+数字）
- ✅ 需管理员审核
- ✅ 密码登录（明文存储便于管理员查看）
- ✅ 单设备限制（新登录踢出旧设备）
- ✅ Token 验证
- ✅ 用户启用/禁用
- ✅ 账号有效期设置（永久/指定天数）
- ✅ 管理员可查看用户密码

### 团队管理（新增）
- ✅ 创建团队/线路
- ✅ 两种配额模式：
  - **共享模式**：团队所有成员共用总配额
  - **平摊模式**：总配额平均分配给每个成员作为个人配额
- ✅ 批量设置团队归属
- ✅ 批量设置有效期
- ✅ 批量设置个人配额
- ✅ 批量重置导出数量

### 配额管理
- ✅ 团队总配额设置
- ✅ 个人配额设置（优先于团队配额）
- ✅ 配额用完自动锁定
- ✅ 重置配额后自动解锁

### 导出统计
- ✅ 记录每次导出数量
- ✅ 导出历史记录
- ✅ 用户导出数统计
- ✅ 线路用量统计

### 系统控制
- ✅ 维护模式（阻止所有登录）
- ✅ 系统公告
- ✅ 一键踢出所有用户

## 配额模式说明

### 共享模式 (shared)
- 团队设置总配额，如 10000
- 团队内所有成员共用这 10000 配额
- 任何成员导出都会扣减团队配额
- 团队配额用完，所有成员被锁定

### 平摊模式 (split)
- 团队设置总配额，如 10000
- 假设团队有 5 个成员
- 每个成员自动获得 2000 的个人配额
- 各用各的，互不影响
- 个人配额用完只锁定该用户

### 自定义个人配额
- 可以给单个用户设置独立的个人配额
- 个人配额优先于团队配额
- 设为 0 表示跟随团队配额

## 部署说明

### 1. 环境变量

在 Vercel 项目设置中添加以下环境变量：

```
REDIS_URL=redis://username:password@host:port
```

推荐使用 [Upstash](https://upstash.com/) 免费 Redis。

### 2. 部署到 Vercel

```bash
# 安装 Vercel CLI
npm i -g vercel

# 登录
vercel login

# 部署
cd authserver_v2
vercel

# 设置环境变量
vercel env add REDIS_URL
# 粘贴 Redis URL

# 生产部署
vercel --prod
```

### 3. 访问管理后台

部署完成后访问 `https://your-domain.vercel.app/admin`

## API 文档

### 公开接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/status` | GET | 系统状态 |
| `/api/auth/register` | POST | 用户注册 |
| `/api/auth/login` | POST | 用户登录 |
| `/api/auth/verify` | POST | Token验证 |
| `/api/auth/check` | POST | 状态检查 |
| `/api/export/report` | POST | 上报导出数量 |

### 管理接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/admin/users` | GET | 用户列表（含密码） |
| `/api/admin/pending` | GET | 待审核列表 |
| `/api/admin/approve` | POST | 审核通过 |
| `/api/admin/reject` | POST | 拒绝注册 |
| `/api/admin/toggleUser` | POST | 启用/禁用 |
| `/api/admin/kickUser` | POST | 踢出用户 |
| `/api/admin/removeUser` | POST | 删除用户 |
| `/api/admin/setLine` | POST | 设置团队 |
| `/api/admin/setExpire` | POST | 设置有效期 |
| `/api/admin/resetExport` | POST | 重置导出数 |
| `/api/admin/exportHistory` | GET | 导出历史 |

### 批量操作接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/admin/batchSetLine` | POST | 批量设置团队 |
| `/api/admin/batchSetExpire` | POST | 批量设置有效期 |
| `/api/admin/batchSetQuota` | POST | 批量设置配额 |
| `/api/admin/batchResetExport` | POST | 批量重置导出数 |

### 团队/线路接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/admin/lines` | GET | 团队列表 |
| `/api/admin/addLine` | POST | 创建团队 |
| `/api/admin/setLineQuota` | POST | 设置团队配额 |
| `/api/admin/resetLineUsage` | POST | 重置团队用量 |
| `/api/admin/removeLine` | POST | 删除团队 |

### 系统接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/system/config` | GET/POST | 系统配置 |
| `/api/system/stats` | GET | 统计数据 |
| `/api/system/kickAll` | POST | 一键踢出 |

## 接口详情

### POST /api/auth/register
用户注册

**请求：**
```json
{
  "username": "testuser123",
  "password": "abc123456"
}
```

**限制：**
- 用户名：3-20位，只能字母和数字
- 密码：6-30位，只能字母和数字

**响应：**
```json
{
  "ok": true,
  "msg": "注册成功，请等待管理员审核"
}
```

### POST /api/admin/batchSetQuota
批量设置配额

**模式1 - 平摊配额（针对整条线路）:**
```json
{
  "line": "A团队",
  "totalQuota": 10000,
  "mode": "split"
}
```

**模式2 - 共享配额（针对整条线路）:**
```json
{
  "line": "A团队",
  "totalQuota": 10000,
  "mode": "shared"
}
```

**模式3 - 自定义个人配额:**
```json
{
  "usernames": ["user1", "user2"],
  "personalQuota": 5000
}
```

### POST /api/export/report
上报导出数量

**请求：**
```json
{
  "username": "testuser",
  "token": "abc123...",
  "count": 50
}
```

**配额检查逻辑：**
1. 如果用户有个人配额(personalQuota > 0)，检查个人配额
2. 否则如果用户有线路，检查线路配额（共享模式）
3. 如果都没有，不限制

**响应（正常）：**
```json
{
  "ok": true,
  "msg": "导出记录已上报",
  "userExportCount": 150,
  "personalQuota": 5000,
  "lineInfo": {
    "name": "A团队",
    "quota": 100000,
    "used": 5050
  },
  "warning": "个人配额剩余 500"
}
```

**响应（配额超限）：**
```json
{
  "ok": false,
  "msg": "已达到 5,000 数量待机中，如需继续使用请联系管理员",
  "code": "QUOTA_EXCEEDED",
  "quotaInfo": {
    "type": "personal",
    "quota": 5000,
    "used": 5050
  }
}
```

## 数据结构

### Redis Keys

```
users                    (Set)   - 所有正式用户名
pending_users            (Set)   - 待审核用户名
lines                    (Set)   - 所有线路名

user:{username}          (Hash)  - 用户数据
  - password             密码（明文）
  - status               状态: pending/approved/disabled/locked
  - enabled              是否启用
  - line                 所属线路/团队
  - expireAt             有效期时间戳，0=永不过期
  - exportCount          个人导出数量
  - personalQuota        个人配额，0=跟随团队
  - maxDevices           最大设备数
  - currentToken         当前 Token
  - tokenCreatedAt       Token 创建时间
  - createdAt            创建时间

line:{lineName}          (Hash)  - 线路/团队数据
  - name                 名称
  - quota                总配额，0=无限制
  - used                 已用量
  - quotaMode            配额模式: shared/split
  - enabled              是否启用
  - createdAt            创建时间

export_history:{username} (List) - 导出历史
  - {count, timestamp}

system:config            (Hash)  - 系统配置
  - maintenance          维护模式
  - maintenanceMessage   维护提示
  - announcement         公告内容
  - announcementEnabled  公告开关
  - lastGlobalKick       最后全局踢出时间
```

## 错误码

| Code | 说明 |
|------|------|
| INVALID_TOKEN | Token 无效 |
| DISABLED | 账号已禁用 |
| LOCKED | 账号已锁定（配额用完） |
| EXPIRED | 账号已过期 |
| QUOTA_EXCEEDED | 配额已用完 |
| MAINTENANCE | 系统维护中 |
| PENDING | 账号待审核 |
| KICKED | 被踢出登录 |

## 插件集成

Chrome 插件需要调用以下接口：

1. **启动时**：调用 `/api/status` 检查系统状态
2. **登录**：调用 `/api/auth/login` 获取 Token
3. **操作前**：调用 `/api/auth/verify` 验证 Token 和配额
4. **导出后**：调用 `/api/export/report` 上报导出数量

### 导出数量确认机制

为确保只有真正保存到本地的数据才计入配额：
1. 用户点击"导出CSV"
2. 插件生成 CSV 文件并触发下载
3. 监听下载完成事件
4. 下载成功后，调用 `/api/export/report` 上报数量

## 注意事项

1. **密码明文存储**：为方便管理员查看，密码以明文存储，请确保服务器安全
2. **单设备限制**：新登录会踢出旧设备，确保同一账号只能在一个设备使用
3. **配额检查**：导出前会检查配额，超限自动锁定
4. **Token有效期**：Token 无过期时间，但可通过踢出功能使其失效

## 版本历史

- **v2.1.0** - 团队管理、批量操作、配额模式、密码查看
- **v2.0.0** - 密码登录、线路配额、时间限制
- **v1.0.0** - TOTP 认证（已废弃）
