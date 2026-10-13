# 管理员登录

升级数据库后，在项目根目录的交互终端执行：

```powershell
pnpm --filter ai-hot-radar-server admin:init
```

命令提示输入账号及两次密码。密码至少十二个字符，不回显；同一命令可重置账号密码，所有旧会话随即失效。命令读取 `server/.env`，可用 `DATABASE_URL` 指定部署数据库或预览副本，不能把密码放在参数或环境变量中。

当前本地预览副本的初始化方式：

```powershell
$env:DATABASE_URL = 'file:C:/Users/蓝芷怡/AppData/Local/Temp/china-radar-preview-JrmDh9/radar.db'
pnpm --filter ai-hot-radar-server admin:init
Remove-Item Env:DATABASE_URL
```

然后打开 `http://localhost:3420/admin`。预览账号不会修改原数据库中的账号。部署时在后端容器中交互运行 `node scripts/admin-account.cjs`。

后台只认管理员 Cookie 会话，原 `ADMIN_TOKEN` 不再用于网站管理。Telegram 的采集令牌和 Caddy 的全站认证继续生效。会话固定八小时，退出会删除服务端记录；HTTPS 配置使用 Secure Cookie。访问地址必须与 `CLIENT_URL` 或 `PUBLIC_SITE_URL` 完全一致，包括协议和端口。

401 表示未登录、会话失效或账号密码错误；403 的 `origin_rejected` 表示修改请求来源不匹配；429 表示登录失败限制。当前历史 401/403 没有留存请求细节，无法确认用户当时命中的具体分支；旧逻辑会分别因为管理员令牌、本机代理头或站点来源拒绝请求。新接口提供明确的安全原因，便于用户反馈。
