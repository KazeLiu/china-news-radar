# 浏览器网页采集

网页来源使用独立 Playwright Chromium，不连接现有 Chrome，不加载个人浏览器资料。默认并发一、页面三十秒、五十条、三页；来源高级配置可调整上限。

## 先设置连接，再检查列表结构

进入 `/admin` → 来源配置 → **采集网络**，选择直连或 HTTP(S) 代理。服务器能够直连时选择直连并保存，无需安装 Clash。本机需要 Clash 时，填写后端电脑上的代理地址，例如 `http://127.0.0.1:7897`；容器中的回环地址不代表宿主电脑。

这项设置用于 RSS、网页和通用 API，不改变 AI 接口或 Telegram 接收。普通配置响应不返回代理地址；输入框留空保留已保存地址。首次保存前创建 SQLite 一致性备份，不修改原新闻和译文。

尚未保存此设置的旧安装，继续读取 `SOURCE_PROXY_URL`、`RSS_PROXY_URL`、`HTTPS_PROXY` 或 `https_proxy`；保存后的数据库设置优先，明确选择直连也会覆盖环境变量代理。全新安装未配置代理时默认直连。

本机系统 DNS 返回错误地址时，可以开启“通过代理使用安全 DNS”。该选项经同一代理访问 Cloudflare DoH，连接到校验后的公开 IP，同时保留原站点 Host 和 TLS 域名；默认关闭，查询失败直接报告，不退回另一条 DNS 路径。接口格式见 [Cloudflare 官方说明](https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/make-api-requests/dns-json/)。

在来源选择“网页爬虫”，填公开目标 URL。文章页优先使用 JSON-LD 或 Open Graph 文章元数据；列表页填写条目、标题、链接及可选字段的 CSS 选择器。CSS 列表会在单页超时内等待异步填入的标题和链接。选择器只用于提取数据，不能执行脚本。每次检查字段匹配数量，后台显示最近规则与检查结果。

来源测试不入库或调用 AI。点击“AI 辅助生成候选”才提交持久任务：浏览器先读取公开页面，裁剪到十二千字符，再用保存的配置请求一次模型。页面的脚本、样式、表单和 URL 参数不发送。生成候选先预览，再明确应用；来源已经修改时拒绝应用旧候选。保存修改后的规则同样先检查提取，只有成功后替换并保存上一份经过检查的规则。

访问限制、验证码、登录、付费内容、加载超时和结构失效分别报告，显示安全错误及可用的 HTTP 状态，不每天自动调用模型修复。通用框架不能保证特定站点可抓取。

## 在后台操作服务器上的浏览器

来源测试遇到设备验证或访问拒绝时，会弹出人工操作提示。点击“打开远程浏览器”，即可在后台查看并点击后端 Chromium 的实时画面；也可以随时使用来源预览区的“打开远程采集浏览器”。服务器不需要桌面、VNC 或对外开放调试端口。

支持点击、拖动、上下滚动、常用按键和向当前焦点输入文字。完成网站允许的人工验证后，点击“完成验证并预览”，由当前页面按表单规则提取样例，不入库、不通知、不调用 AI。没有可操作验证、需要账号或付费时，保留错误提示，不自动处理。

每次只允许一个人工窗口，绑定当前管理员登录会话；画面和输入接口都校验登录状态与写请求来源。窗口十分钟后自动关闭，刷新或离开页面时尝试释放。验证后的 Cookie 和本地存储只在后端内存中为同一来源、同一目标保留三十分钟，供后续临时上下文使用；到期、重启或保存网络设置后清除，不写入 SQLite、日志或浏览器前端存储。请勿在此窗口登录私人账号或付款。

路透 `https://www.reuters.com/world/china/` 在本机代理下返回 DataDome 设备验证；远程画面还出现过“Access is temporarily restricted”，没有可点击的验证按钮。增加超时不能解除这类限制。可访问的公开新闻列表已取得十条样例，但路透列表本身尚未取得新闻样例，不能据此预填有效解析规则。

请求目标、重定向、页面子请求均检查公开地址；连接到校验后的 DNS 地址，防止重新解析指向内网。浏览器阻止 Service Worker、WebSocket、WebRTC 和弹出新窗口。普通采集只允许 GET、HEAD、OPTIONS；人工操作额外允许网站自身的 POST（最多 64 KiB），用于验证交互，不开放任意方法或脚本执行接口。内部 RSSHub 仅由明确配置的 RSS 通道直连访问。浏览器子进程不继承后台密钥。

## 安装与部署

Windows 本地安装独立浏览器：

```powershell
pnpm --filter ai-hot-radar-server exec playwright-core install chromium
```

部署继续使用 `server/Dockerfile.radar` 与 `compose.arm64.yml`。运行镜像安装 Debian Chromium、sandbox 与中文字体，以非 root 用户运行；Compose 加入共享内存和固定版本 seccomp 配置。`CHROMIUM_EXECUTABLE_PATH` 可指定独立浏览器可执行文件，不用于连接已有浏览器。

沙箱部署参照 [Playwright 官方 Docker 说明](https://playwright.dev/docs/docker)。`chromium-seccomp.json` 来源于 [Playwright v1.64.0 官方配置](https://github.com/microsoft/playwright/blob/v1.64.0/utils/docker/seccomp_profile.json)，遵循其上游许可。ARM64 构建与服务器现场验证尚未执行，部署时需要核对宿主的用户命名空间支持。
