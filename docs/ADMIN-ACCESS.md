# 管理员登录

测试环境也需要设置管理员，但每个数据库只需设置一次。这一步只是创建后台登录账号，不会开启采集或调用 AI。

`DATABASE_URL` 用来选择存放账号和新闻的数据库。当前预览使用独立副本，因此初始化时必须指定这个副本，而不是默认数据库。

## 当前本地预览

在 PowerShell 中复制执行以下命令，再按提示输入自己的账号和两次密码。密码至少十二个字符，输入时不显示字符，这是正常现象。

```powershell
Set-Location D:/code/china-news-radar
$env:DATABASE_URL = 'file:C:/Users/蓝芷怡/AppData/Local/Temp/china-radar-preview-JrmDh9/radar.db'
pnpm --filter ai-hot-radar-server admin:init
Remove-Item Env:DATABASE_URL
```

然后刷新 `http://localhost:3420/admin`，输入刚设置的账号和密码。无需重启项目；以后正常启动同一个数据库时，不需要再次初始化。预览账号不会修改原数据库中的账号。

## 默认数据库与部署

使用默认数据库时，在运行后端的电脑上打开项目根目录的交互终端，执行：

```powershell
pnpm --filter ai-hot-radar-server admin:init
```

命令读取 `server/.env`，也可以用 `DATABASE_URL` 指定另一个数据库。部署时在后端容器中交互运行 `node scripts/admin-account.cjs`。同一命令可重置账号密码，所有旧会话随即失效；不能把密码放在参数或环境变量中。

## 登录保护与错误提示

后台只认管理员 Cookie 会话，原 `ADMIN_TOKEN` 不再用于网站管理。Telegram 的采集令牌和 Caddy 的全站认证继续生效。会话固定八小时，退出会删除服务端记录；HTTPS 配置使用 Secure Cookie。访问地址必须与 `CLIENT_URL` 或 `PUBLIC_SITE_URL` 完全一致，包括协议和端口。

401 表示未登录、会话失效或账号密码错误；403 的 `origin_rejected` 表示修改请求来源不匹配；429 表示登录失败限制。当前历史 401/403 没有留存请求细节，无法确认用户当时命中的具体分支；旧逻辑会分别因为管理员令牌、本机代理头或站点来源拒绝请求。新接口提供明确的安全原因，便于用户反馈。
