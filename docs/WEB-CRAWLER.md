# 浏览器网页采集

网页来源使用独立 Playwright Chromium，不连接现有 Chrome，不加载个人浏览器资料。每次采集使用新的临时上下文，浏览器可复用。默认并发一、页面三十秒、五十条、三页；来源高级配置可调整上限。

在来源选择“网页爬虫”，填公开目标 URL。文章页优先使用 JSON-LD 或 Open Graph 文章元数据；列表页填写条目、标题、链接及可选字段的 CSS 选择器。选择器只用于提取数据，不能执行脚本。每次检查字段匹配数量，后台显示最近规则与检查结果。

来源测试不入库或调用 AI。点击“AI 辅助生成候选”才提交持久任务：浏览器先读取公开页面，裁剪到十二千字符，再用保存的配置请求一次模型。页面的脚本、样式、表单和 URL 参数不发送。生成候选先预览，再明确应用；来源已经修改时拒绝应用旧候选。保存修改后的规则同样先检查提取，只有成功后替换并保存上一份经过检查的规则。

访问限制、验证码、登录、付费内容、加载超时和结构失效分别报告，不绕过限制，不每天自动调用模型修复。通用框架不能保证特定站点可抓取，路透等准确 URL 与样例由用户配置确认。

请求目标、重定向、页面子请求均检查公开地址；连接到校验后的 DNS 地址，防止重新解析指向内网。浏览器阻止 Service Worker、WebSocket、WebRTC 与未经配置的写请求。内部 RSSHub 仅由 RSS 通道访问。浏览器子进程不继承后台密钥。

Windows 本地安装独立浏览器：

```powershell
pnpm --filter ai-hot-radar-server exec playwright-core install chromium
```

部署继续使用 `server/Dockerfile.radar` 与 `compose.arm64.yml`。运行镜像安装 Debian Chromium、sandbox 与中文字体，以非 root 用户运行；Compose 加入共享内存和固定版本 seccomp 配置。`CHROMIUM_EXECUTABLE_PATH` 可指定独立浏览器可执行文件，不用于连接已有浏览器。

沙箱部署参照 [Playwright 官方 Docker 说明](https://playwright.dev/docs/docker)。`chromium-seccomp.json` 来源于 [Playwright v1.64.0 官方配置](https://github.com/microsoft/playwright/blob/v1.64.0/utils/docker/seccomp_profile.json)，遵循其上游许可。ARM64 构建和真实站点访问本轮未执行，部署时需要核对宿主的用户命名空间支持。
