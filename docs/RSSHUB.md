# RSSHub 媒体采集

使用官方 `rsshub` npm 包，固定为 `1.0.0-master.5d857e3`（2026-10-10 发布）。旧文档里的 CommonJS `require()` 示例不适用于这个版本；现在使用 ESM，先 `await init(config)`，再 `await request(route)`。包返回新闻 JSON，本项目将它转换为 RSS，复用原有发布者核验、入库、去重与统一 AI 队列。

RSSHub 在独立的 `rsshub-service` 进程运行，依赖和媒体抓取故障不影响 NestJS。网站仅访问内部的 `/feeds/媒体ID`，没有开放任意路由或任意 URL 抓取接口。服务最多同时运行两条路由，同一路由复用正在执行的请求；12 秒等不到结果就回退，正在抓取的任务仍占用并发名额直到结束。成功输出缓存 120 秒，并提供 ETag。RSSHub 路由自身可能抓全文，本项目仅保存标题与有限摘要，不绕过付费墙。

## 已配置媒体

2026-10-10 在本机通过代理实测；结果只代表这次请求，日本服务器还需复测。

| 媒体 | RSSHub 路由 | 本机结果 | 初始入口 / 备用入口 |
| --- | --- | --- | --- |
| 路透 | `/reuters/world/china` | 上游 API 401/404 | RSSHub 默认关，保留 Google News 索引 |
| 美联社 | `/apnews/topics/china` | 上游 403 | RSSHub 默认关，保留 Google News 索引 |
| 彭博 | `/bloomberg/economics` | RSS 正常，全文处理超过 12 秒 | RSSHub 默认关，媒体公开 Economics RSS |
| CNBC | `/cnbc/rss/100003114` | 路由失败，直接 RSS 成功 | RSSHub 默认关，媒体公开 Top News RSS |
| 日经亚洲 | `/nikkei/asia` | 返回 20 条新闻 | 默认 Google News 索引，可自行添加 RSSHub 完整地址 |
| 卫报 / BBC | 无需 RSSHub | 保留原有直接采集 | 媒体公开 RSS |
| 法新社 | 当前包未找到 AFP 路由 | 未配置稳定免费一手入口 | 待接入，不标为成功 |

源管理的主开关控制是否采集。后台“来源配置”统一维护有序 RSS 地址列表，RSSHub 没有单独的开关或内置路由选择。需要本地日经亚洲适配服务时，填写 `http://127.0.0.1:3412/feeds/nikkei`；Docker 内填写 `http://rsshub:3412/feeds/nikkei`。可以把它放在首选位置，把 Google News 索引放在备用位置，也可以只使用已有 RSS。

配置持久保存在 SQLite，重启保留；请求或解析失败按顺序尝试其他地址，失败地址等待 5 分钟，429 尊重 Retry-After。成功但没有匹配文章时不切换。页面显示最近成功地址，后台测试展示各尝试地址的结果。条件请求的 ETag 不跨地址使用。Google 新闻按实际 URL 标记为索引，不因修改入口变成“媒体直连”。

RSSHub 没有已配置路由的媒体继续使用公开 RSS；不能验证一手入口时保留待接入状态。这里是已选择媒体的目录，并未自动把 RSSHub 全部网站导入来源列表。新增本地适配路由时编辑 `rsshub-service/feeds.json`，核对发布者域名与真实输出，再在后台添加完整 RSS 地址。

## 本地启动

根目录 `pnpm install --frozen-lockfile`。RSSHub 要求 Node `^22.22.2 || ^24.15.0`；本地开发依赖带独立的 Node 22.22.2，`pnpm --filter radar-rsshub start` 使用这个版本，不改变系统 Node。系统版本较低时 pnpm 会报告 engine 警告，可以用 `pnpm --filter radar-rsshub exec node -p process.version` 核验实际运行时。

复制 `rsshub-service/.env.radar.example` 为同目录 `.env`，需要时填写本机代理。后端 `server/.env` 增加：

```dotenv
RSSHUB_BASE_URL=http://127.0.0.1:3412
```

```bash
pnpm --filter radar-rsshub start
```

另一个终端启动后端与前端。服务默认只绑定 127.0.0.1:3412。`RSSHUB_BASE_URL` 允许后台配置这个内部服务的 `/feeds/媒体ID` 地址；它不会自动将地址加入来源。其他公开 RSSHub 服务直接在后台填写完整 RSS 地址即可。

## Docker 与依赖

`compose.arm64.yml` 包含独立 RSSHub 服务，Node 22.22.2 基础镜像支持 ARM64；不发布宿主端口，也不向其传入 AI/TG 密钥。只有在来源地址列表中填写了该服务的完整地址时才会使用。Docker、ARM64 和服务器出口尚未实机验证。

上游 `@jocmp/mercury-parser` 的 `difflib` 依赖默认使用 Git SSH。本项目通过 pnpm override 改为同一公开仓库固定 commit 的 HTTPS tarball，并写入锁文件；无需 GitHub 登录，也没有修改全局 Git 配置。安装时需要能够访问 npm 与 GitHub codeload。

验证：后端测试/构建、`pnpm --filter radar-rsshub test`，以及启动服务后 `node scripts/check-rsshub.cjs`。公开路由的失败会如实打印状态；测试通过不代表所有媒体永久可抓。
