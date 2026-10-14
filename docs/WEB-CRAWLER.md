# 浏览器网页采集

网页来源使用独立 Camoufox（Firefox 内核），通过官方 Node/TypeScript SDK 与 Playwright 控制，不连接现有 Chrome，不加载个人浏览器资料。默认并发一、页面三十秒、五十条、三页；来源高级配置可调整上限。

## 先设置连接，再检查列表结构

进入 `/admin` → 来源配置 → **采集网络**，选择直连或 HTTP(S) 代理。服务器能够直连时选择直连并保存，无需安装 Clash。本机需要 Clash 时，填写后端电脑上的代理地址，例如 `http://127.0.0.1:7897`；容器中的回环地址不代表宿主电脑。

这项设置用于 RSS、网页和通用 API，不改变 AI 接口或 Telegram 接收。代理地址在登录后的输入框中明文显示，自动回填已保存的地址，保存后不清空。地址读取接口要求管理员登录并禁止缓存，公共来源响应不包含该地址。首次保存前创建 SQLite 一致性备份，不修改原新闻和译文。

尚未保存此设置的旧安装，继续读取 `SOURCE_PROXY_URL`、`RSS_PROXY_URL`、`HTTPS_PROXY` 或 `https_proxy`；保存后的数据库设置优先，明确选择直连也会覆盖环境变量代理。全新安装未配置代理时默认直连。

本机系统 DNS 返回错误地址时，可以开启“通过代理使用安全 DNS”。该选项经同一代理访问 Cloudflare DoH，连接到校验后的公开 IP，同时保留原站点 Host 和 TLS 域名；默认关闭，查询失败直接报告，不退回另一条 DNS 路径。接口格式见 [Cloudflare 官方说明](https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/make-api-requests/dns-json/)。

在来源选择“网页爬虫”，填公开目标 URL。文章页优先使用 JSON-LD 或 Open Graph 文章元数据；列表页填写条目、标题、链接及可选字段的 CSS 选择器。CSS 列表会在单页超时内等待异步填入的标题和链接。选择器只用于提取数据，不能执行脚本。每次检查字段匹配数量，后台显示最近规则与检查结果。

来源测试不入库或调用 AI。点击“AI 辅助生成候选”才提交持久任务：浏览器先读取公开页面，裁剪到十二千字符，再用保存的配置请求一次模型。页面的脚本、样式、表单和 URL 参数不发送。生成候选先预览，再明确应用；来源已经修改时拒绝应用旧候选。保存修改后的规则同样先检查提取，只有成功后替换并保存上一份经过检查的规则。

访问限制、验证码、登录、付费内容、加载超时和结构失效分别报告，显示安全错误及可用的 HTTP 状态，不每天自动调用模型修复。通用框架不能保证特定站点可抓取。

## 网页测试直接返回结果

填写来源后点击“测试当前表单”。后端使用独立 Camoufox 加载、解析页面，直接返回连接状态、解析结构和新闻样例，不打开人工操作窗口，不入库、不通知、不调用 AI。

遇到设备验证、验证码、登录、付费限制或访问拒绝时，只显示错误原因和可用的 HTTP 状态，留待后续处理。远程人工操作的组件与服务代码保留，页面入口不接入，相关 HTTP 接口暂不注册。

请求目标、重定向、页面子请求均检查公开地址；连接到校验后的 DNS 地址，防止重新解析指向内网。浏览器阻止 Service Worker、WebSocket、WebRTC 和弹出新窗口。网页采集只允许 GET、HEAD、OPTIONS。内部 RSSHub 仅由明确配置的 RSS 通道直连访问。浏览器子进程不继承后台密钥。

## 安装与部署

依赖固定为 `camoufox@0.5.8`、`playwright-core@1.62.0`，浏览器固定为 `156.0.1-beta.36`。官方 SDK 要求 Node.js ≥ 22.15、Playwright < 1.63，不能单独升级 Playwright。配对版本见 [官方 TypeScript 接口](https://github.com/daijro/camoufox/tree/main/typescript)及安装包内的 `browser-pin.json`。

在项目根目录安装依赖后，安装独立浏览器：

```powershell
node scripts/install-camoufox.cjs
```

安装脚本按当前平台下载固定的官方预编译 ZIP，通过官方 SDK 解压到用户缓存目录；不在服务器编译 Firefox，不在采集时临时下载。浏览器包约 1.3 GB，需要能访问 GitHub Releases。需要代理下载时，仅对安装命令设置 `HTTPS_PROXY`，例如 Clash 的 `http://127.0.0.1:7897`；不改变已保存的采集网络设置。

| 运行平台 | 固定版本的官方包 | 本项目运行条件 |
| --- | --- | --- |
| Windows x64 | `win.x86_64.zip` | Node.js ≥ 22.15；按上述命令安装，不使用个人 Chrome |
| Linux x86_64 | `lin.x86_64.zip` | glibc 系统、Firefox 共享库与字体；使用无头模式 |
| Ubuntu ARM64 | `lin.arm64.zip` | 官方 ARM64 预编译包，无需现场编译；Docker 镜像按 ARM64 构建 |

这些包已核对 [官方固定版本资产](https://github.com/daijro/camoufox/releases/tag/v156.0.1-beta.36)。本机 Windows x64 已通过 Clash 完成固定包下载、官方 SDK 安装及可执行文件定位。按项目约定，本轮没有启动采集浏览器、真实网站测试或 Docker 构建；Windows 无头启动、Linux x86_64 与 Ubuntu ARM64 的容器运行仍需在目标环境验收，不能把预编译包存在视为已稳定部署。

部署继续使用 `server/Dockerfile.radar` 与 `compose.arm64.yml`。镜像在构建时安装 GTK、DBus、ALSA、X11、NSS、GBM/OpenGL、中文字体及固定 Camoufox 包，以非 root 用户运行。Debian Bookworm 使用 `libasound2`；原生 Ubuntu 24.04 安装依赖时对应包为 `libasound2t64`，其他依赖按发行版确认。Compose 保留共享内存和允许用户命名空间的 `browser-seccomp.json`，不设置禁用沙箱的参数；宿主必须允许非特权用户命名空间。配置来源为 [Playwright 官方 Docker 说明](https://playwright.dev/docs/docker)及 [v1.64.0 通用 seccomp 配置](https://github.com/microsoft/playwright/blob/v1.64.0/utils/docker/seccomp_profile.json)，保留其上游许可。

自动采集、来源预览、URL 提取、解析辅助及保留的浏览器服务均经过同一个启动入口；保留服务的截图已改用跨浏览器接口，但人工操作 HTTP 入口仍不注册。启动时只替换浏览器内核，不启用指纹模型、GeoIP、扩展下载或身份伪装。页面请求仍由原有公开地址校验、DNS 固定和代理通道发送；浏览器自身使用不可用的回环代理以阻断绕过该通道的后台请求。每次使用独立临时上下文，子进程不继承密钥。`CAMOUFOX_EXECUTABLE_PATH` 仅供指定已安装的同版本可执行文件，不连接已有浏览器；没有安装或启动失败会明确报错，不回退 Chromium。
