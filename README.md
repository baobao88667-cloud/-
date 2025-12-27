# TPS Helper 后端服务 v6.4.3

## 版本更新说明

### v6.4.3 新增功能：远程版本控制

本版本新增了远程版本控制功能，允许管理员从后端远程禁用特定插件版本，强制用户升级到新版本。

#### 功能特点

1. **版本锁定**：管理员可以设置最低允许版本号，低于该版本的插件将被锁定
2. **自定义提示**：管理员可以自定义锁定提示消息
3. **即时生效**：版本控制设置即时生效，无需重启服务
4. **容错处理**：网络错误时默认不锁定，确保用户体验

#### 使用方法

1. 登录管理后台 (`/admin`)
2. 进入「系统控制」标签页
3. 找到「版本控制」部分
4. 启用版本控制开关
5. 输入最低允许版本号（如 `6.4.3`）
6. 输入锁定提示语（如 `已更新请找管理员拿最新版本`）
7. 点击「保存版本控制设置」

#### API 端点

- `GET /api/version-check?v=6.4.3` - 检查版本是否被锁定（公开端点，无需认证）
- `GET /api/admin?action=versionControl` - 获取版本控制设置（管理员）
- `POST /api/admin?action=setVersionControl` - 设置版本控制（管理员）

#### Redis 数据结构

```
tps:version_control (Hash)
  - enabled: "true" | "false"
  - minVersion: "6.4.3"
  - lockMessage: "已更新请找管理员拿最新版本"
```

## 部署说明

1. 将本目录内容上传到 GitHub 仓库
2. 在 Vercel 中导入该仓库
3. 配置环境变量：
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
4. 部署完成

## 文件结构

```
backend_v6.4.3/
├── api/
│   ├── _db.js          # Redis 数据库连接
│   ├── admin.js        # 管理员 API（含版本控制）
│   ├── auth.js         # 用户认证 API
│   ├── export.js       # 导出/积分 API
│   ├── status.js       # 状态检查 API
│   └── version-check.js # 版本检查 API（新增）
├── admin.html          # 管理后台页面
├── package.json        # 项目配置
├── vercel.json         # Vercel 配置
└── README.md           # 本文档
```

## 注意事项

- 版本号格式必须为 `x.y.z`（如 `6.4.3`）
- 启用版本控制后，低于最低版本的插件将无法登录
- 被锁定的用户需要安装新版本插件才能恢复使用
- 建议在发布新版本后再启用版本控制
