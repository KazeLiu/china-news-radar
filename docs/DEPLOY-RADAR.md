# Ubuntu ARM64 部署与个人使用

项目基于 [zenitlab/ai-hot-radar](https://github.com/zenitlab/ai-hot-radar) 改造，保留上游源码。默认运行独立涉华新闻模块，旧 AI 行业采集、日报、邮件任务不会启动。

## 第一版能力

- 无 AI 密钥即可读取免费 RSS，全天每 2–3 分钟检查，页面每 20 秒刷新首屏。展开加载更多后保留当前阅读位置，可手动检查更新。
- 彭博、CNBC、卫报、BBC 通过媒体公开 RSS；路透、美联、日经亚洲默认使用 Google News RSS 索引。后台可为每个来源配置多条 RSS 地址，RSSHub 也通过完整地址添加；所有当前可请求地址并行采集，全局 RSS 并发上限为 4，汇总后按文章 URL 去重。法新社仍待接入。详见 [RSSHub 实测与配置](RSSHUB.md)。
- 管理员统一 AI 判定涉华关系、主题、类型与必要翻译；无密钥、失败、超额或不确定时采用中英文关键词与栏目规则。规则和 AI 均可能误筛，保留原文与判断依据。
- URL 去重、相同规范化标题折叠、主题/来源/搜索过滤、服务器收藏、来源开关与失败状态。来源不明的 Telegram 消息默认只在线索模式显示。
- 显示发布、首次发现、更新时间；初次导入一批报道时，发现时间相同则按发布时间排列。内容修改保留收藏和首次发现时间。
- 原始媒体标签说明发布者域名或可识别链接，不代表系统证明报道为独家或事实已确认。Google 索引无法可靠解析原文地址时保留跳转链接；不会绕过付费墙或补造链接。
- 原文先入库，AI 在后台分析 RSS 与启用的 Telegram 新闻，非简体中文翻译标题及摘要；成功结果共享缓存，阅读不调用模型。无密钥也能运行。

暂未实现多用户注册、捐赠、X 接口和付费电讯。私人入口先用 HTTPS + Basic Auth，收藏属于本站管理员；开放多人使用前需要单独实现用户系统。

## 在日本服务器启动

适用于 Ubuntu ARM64，已装 Docker Engine 和 Docker Compose v2。检查 `uname -m` 应为 `aarch64`，`docker compose version` 应可用。基础镜像支持 ARM64，服务器原生从源码构建，不固定为 amd64。本机未运行 ARM64 容器，首次部署需要完成下面的现场检查。

1. 将项目源码上传到服务器，例如 `/opt/china-news-radar`。不要上传本机 `node_modules`、`.next`、`.env`、数据库或 Telegram session。
2. 预定域名为 `china-news.951211.xyz`。将它的 A 记录指向日本服务器；如果配置 AAAA，确保 IPv6 也能访问。服务器和云防火墙放行 TCP 80/443，UDP 443 可选。已有站点占用这两个端口时，把本项目接入现有反向代理，不直接启动第二个占用端口的 Caddy。
3. 在项目根复制配置，限制读取权限：

```bash
cp .env.radar.example .env
chmod 600 .env
docker run -it --rm caddy:2.10.2-alpine caddy hash-password
```

在交互终端输入私人阅读密码，将输出 bcrypt hash 填入 `.env` 的 `RADAR_PASSWORD_HASH`。使用**单引号**包住 hash，以保留 `$`。填写 `RADAR_DOMAIN` 与 `RADAR_USER`，其余可保持默认。密码、hash、API key 和 token 都只在自己的终端/服务器配置，不需要发到聊天。

需要使用管理后台时，在自己的终端用 `openssl rand -hex 32` 生成管理员令牌，填入 `.env` 的 `ADMIN_TOKEN`。登录私人阅读入口后，打开 `/admin` 并输入该令牌。未设置令牌时，后台接口只允许本机访问。来源、排除规则和 AI 参数保存到数据库，保存后的值优先于环境变量默认值；详见 [后台使用说明](ADMIN.md)。

4. 构建和启动：

```bash
docker compose -f compose.arm64.yml config --quiet
docker compose -f compose.arm64.yml up -d --build
docker compose -f compose.arm64.yml ps
docker compose -f compose.arm64.yml logs --tail=80 server client caddy
```

Caddy 自动申请域名证书。打开 `https://你的域名`，使用私人阅读账号登录。后端和前端均没有发布宿主端口，Telegram 入库接口在公网入口返回 404。首次扫描一般需要数秒至一分钟，连接失败会展示状态并退避 5 分钟；HTTP 429 尊重 Retry-After，手动扫描不绕过失败退避。

5. 现场检查：

```bash
docker compose -f compose.arm64.yml exec server node -p process.arch
docker compose -f compose.arm64.yml exec server node -e "fetch('http://127.0.0.1:3001/api/news/status').then(r=>r.json()).then(console.log)"
```

应显示 `arm64`，并能看到采集总数。用未登录浏览器访问应要求认证；登录后检查来源状态、搜索、收藏和手机页面。拒绝外站 Origin 的写请求。确认容器重启后收藏仍在，再作为常驻站点使用。

## 数据与备份

SQLite 放在 `radar_data` 卷中；证书在 `caddy_data`，Telegram session 和重试队列在 `telegram_data`。单采集实例即可，不要同时横向启动多个后端写同一个 SQLite 文件。

数据库初始化使用非破坏性 `prisma db push --skip-generate`，没有 `--accept-data-loss`。升级可能要求 schema 迁移时应先备份和审核；不要添加自动接受丢失数据的参数。新闻目前不自动删除，后续可以按实际规模增加保留期限；初筛为最近 7 天，已经入库的新闻保留供回查。

安全的单文件备份（短暂停止后端和 worker）：

```bash
mkdir -p backups
chmod 700 backups
docker compose -f compose.arm64.yml stop server
docker compose -f compose.arm64.yml --profile telegram stop telegram
cid=$(docker compose -f compose.arm64.yml ps -aq server)
docker cp "$cid:/data/radar.db" "backups/radar-$(date +%Y%m%d-%H%M%S).db"
docker compose -f compose.arm64.yml start server
```

如果已启用 worker，再执行 `docker compose -f compose.arm64.yml --profile telegram start telegram`。备份文件有个人收藏，应限制读取；恢复前先停止写入进程并保存当前数据库。不要执行 `docker compose down -v`，它会删除持久卷。

## 管理员统一 AI 分析与翻译

默认无需预算或密钥。后续可以在 `/admin` 的“AI 配置”填写并保存模型参数，再用下方测试入口检查连接、分类和翻译。每次测试计入每日额度，不保存为新闻。根 `.env` 可设置尚未保存后台配置时的默认值：

```dotenv
AI_ANALYSIS_ENABLED=true
OPENAI_API_KEY=
OPENAI_BASE_URL=
OPENAI_MODEL=gpt-4o-mini
AI_DAILY_LIMIT=100
```

`OPENAI_BASE_URL` 为空时使用 OpenAI API，可填可信的 OpenAI-compatible endpoint；模型名需与服务匹配。RSS 与启用的 Telegram 新闻仅发送标题与有限摘要，不发送账号凭据、session 或私聊。每日调用次数按 UTC 存入 SQLite，包含失败尝试，重启不会重置；这是次数限制，不是金额上限。没有密钥时采用规则展示原文。

重新创建服务：`docker compose -f compose.arm64.yml up -d server`。启用后处理新内容和近 7 天候选；已完成缓存不会因模型切换或刷新重做。慢队列超过 15 秒时先按规则暂显，后续以 AI 结果更新。JSON 契约、有限重试和费用控制见 [AI 处理说明](AI-ANALYSIS.md)。

## 可选 Telegram 个人账号

Telegram Bot 无法自行订阅任意频道。这里使用普通账号的 Telethon 客户端，仅监听后台启用且账号已订阅的公开频道。程序不会自动加入频道、读取私聊、发送消息或批量抓取成员。

先阅读 [API 条款](https://core.telegram.org/api/terms) 和 [内容许可条款](https://telegram.org/tos/content-licensing)，确认个人读取及所选模型处理的使用范围。频道信息不是天然的一手信源：识别海外媒体/机构原始链接；仅有国内链接的消息过滤，出处不明保留为待确认线索。管理员启用统一 AI 时，频道新闻也会分析和按需翻译。

在 [my.telegram.org](https://my.telegram.org) 为自己的账号取得 `api_id`/`api_hash`，在后台“Telegram 账号”保存，两项均不可读回；也可继续使用服务器 `.env`，数据库保存的新值优先。配置强随机 `COLLECTOR_TOKEN`（至少 32 字符，可用 `openssl rand -hex 32` 在本机生成），后端与采集器必须相同：

```dotenv
TELEGRAM_ENABLED=true
TG_USE_CONFIRMED=true
TG_API_ID=
TG_API_HASH=
COLLECTOR_TOKEN=
```

先构建 worker，并在你的交互终端登录：

```bash
docker compose -f compose.arm64.yml up -d server
docker compose -f compose.arm64.yml --profile telegram build telegram
docker compose -f compose.arm64.yml --profile telegram run --rm --no-deps telegram python login.py
```

手机号、验证码与两步验证密码直接输入终端，不经过网页。登录脚本通过认证、禁止缓存的后端专用接口读取 API 凭据，环境变量可作为兼容入口；不自动订阅。请在官方客户端订阅目标公开频道，再在后台填写来源名称与公开用户名、启用来源。一个来源对应一个频道，名称仅用于展示。session 文件具有登录权限，不要提交、公开或发送给别人。

重新创建后端，在网页“来源管理”启用想监听的频道，然后启动 worker：

```bash
docker compose -f compose.arm64.yml up -d server
docker compose -f compose.arm64.yml --profile telegram up -d telegram
docker compose -f compose.arm64.yml logs --tail=40 telegram
```

worker 仅使用已授权 session，不会后台索要验证码；缺配置就退出。启动时每频道最多补最近一天的 25 条消息，之后接收新消息和编辑事件。FloodWait 会等待，入库失败存入本地队列并指数退避。每 60 秒刷新来源、订阅匹配与 API 凭据，凭据变化仅重连采集器；新增来源不要求重启项目。后台“Telegram 账号”显示独立的 session、心跳和频道匹配状态；来源的成功时间仍指收到并入库消息。未订阅或用户名不匹配时显示明确状态。真实账号收取、断线和 FloodWait 尚需现场验证。

## 本地开发与验证

需要 Node 22、pnpm 9.12.1；可选 worker 使用 Python 3.12。根目录安装依赖，再复制 server 配置：

```bash
pnpm install --frozen-lockfile
cp server/.env.radar.example server/.env
pnpm --filter ai-hot-radar-server exec prisma generate
node scripts/init-db.cjs
pnpm --filter ai-hot-radar-server dev
```

另开终端 `pnpm --filter client-next dev`，打开 `http://localhost:3000`。本地后端默认仅监听 127.0.0.1。如果端口另有用途，修改后端 PORT/CLIENT_URL，并用 `INTERNAL_API_URL` 配置前端代理地址；不要按端口杀死别的项目。

Windows 使用 `pnpm.cmd`。需要代理时设置 `RSS_PROXY_URL`，支持 HTTP/HTTPS 代理的 HTTPS CONNECT；不关闭 TLS 验证。RSSHub 另按 [配置说明](RSSHUB.md) 启动，默认端口 3412。本机当前开发预览使用前端 3410、后端 3411。

```bash
pnpm --filter ai-hot-radar-server test
pnpm --filter ai-hot-radar-server build
pnpm --filter client-next exec eslint components/news/NewsReader.tsx app/page.tsx app/layout.tsx next.config.ts
pnpm --filter client-next build
node scripts/check-rss.cjs
node scripts/check-api.cjs
cd telegram-collector
python -m unittest test_common.py
python -m py_compile main.py login.py common.py
```

`check-rss.cjs` 需要先构建后端，现场读取公共 RSS，只输出来源、状态与保留数量，不输出请求对象或凭据。它不会写数据库。`check-api.cjs` 仅对 localhost 测试默认 RSS 模式，需要后端启动并已有报道；默认端口 3411，可设置 `RADAR_TEST_URL`。测试会临时切换一条收藏并恢复原状态。
