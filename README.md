# China Radar · 海外涉华快讯

聚合海外媒体涉华报道，提供中文分类、翻译、精选、热点、日报与关键词关注。由蓝芷怡维护。

简体中文 · [English](README.en.md)

## 主要功能

- **精选阅读**：首页进入精选，可按来源、主题、时间和关键词筛选，切换原文。精选和热点雷达的列表可选择「填满 / 默认 / 窄」，点击标题左侧配图可浏览大图。质量评分只用于排序，未评分内容仍可展示。
- **新闻关联**：在 `/admin?tab=news` 勾选同一事件的 2–6 份公开材料，点击「加入对照」，打开「查看材料」，填写事件名称并生成。前台「内容 → 新闻关联」或新闻卡片中的「查看关联」可打开关系图、原文摘录和措辞差异。对照标明已识别的引用、转载和素材缺口；后台「管理对照」可撤下结果，不影响原报道。
- **涉华评价**：精选和热点雷达的摘要下方最多展示一条有原文依据的评价，区分报道表述和引述观点。点「查看依据」在卡片内核对原文和归因；旧缓存没有评价时不显示，也不会因此重新分析。
- **来源管理**：管理 RSS、网页与 Telegram 来源，配置排除规则。同一来源的多个 RSS 地址并行采集，合并去重后处理，全局最多 4 个 RSS 请求并发；RSSHub 作为完整 RSS 地址填写。
- **统一 AI 分析**：使用 Responses API，后台可刷新模型列表。新增内容进入持久队列，合批完成分类、翻译与评分；未完成新闻可在管理列表单篇分析，重试耗尽后不自动重新入队。结果持久缓存，阅读、筛选和统计不调用模型。
- **手动新闻与人工隐藏**：在 `/admin?tab=news` 粘贴内容或提取 URL，保存草稿、主动分析、编辑展示文案，再明确发布。文章和图片可分别隐藏与恢复，保留原始数据。
- **操作日志**：在 `/admin?tab=logs` 查看采集和 AI 请求统计，区分正式采集、来源预览、实际请求、重试与处理文章。日期按北京时间，额度按 UTC；日志保留 7 天。
- **热点、日报、关注与 Agent/RSS**：公共内容范围统一，草稿和人工隐藏的文章不会进入公共查询。接口与订阅用法见站内「Agent 接入」页。

## 本地准备

- Node.js 22、pnpm 9.12.1。
- 后端：NestJS 11、Prisma、SQLite；前端：Next.js 16、React 19。
- AI 分析使用支持 OpenAI Responses API 与 JSON 输出的模型，由管理员统一配置；准备依赖与空数据库不需要模型密钥。
- 网页采集和 URL 提取需要独立 Camoufox；粘贴录入不依赖它，RSSHub 也是可选服务。

```powershell
git clone https://github.com/KazeLiu/china-news-radar.git
cd china-news-radar
npx --yes pnpm@9.12.1 --filter ai-hot-radar-server --filter client-next install --frozen-lockfile
```

没有 `server/.env` 时，从 `server/.env.radar.example` 复制并编辑，不覆盖已有配置。首次准备保持 `COLLECTOR_ENABLED=false`、`AI_ANALYSIS_ENABLED=false`。数据库可使用新空库，也可安全迁入旧库；结构升级、账号初始化、端口配置与验收步骤见 [目标电脑接续与验收说明](docs/CONTINUE-ON-ANOTHER-PC.md)。不要将数据库、密码、模型密钥或 Telegram session 提交到 Git。

管理入口为 `/admin`，账号通过本地交互命令初始化，没有默认账号。详见 [管理员登录](docs/ADMIN-ACCESS.md)。

## 部署

支持 **Ubuntu x86_64 / ARM64 + Docker**。使用仓库中的 `compose.arm64.yml` 和 `*.radar` Dockerfile；文件名保留 ARM64，但没有锁定架构。x86_64 机器构建或加载 `linux/amd64` 镜像。按 [部署与使用说明](docs/DEPLOY-RADAR.md)配置持久卷、访问保护与反向代理，不使用旧上游 `docker-compose.yml`。

网页能力的 Camoufox 安装与容器配置见 [网页采集说明](docs/WEB-CRAWLER.md)，不连接个人 Chrome 或加载个人登录资料。

共享主机优先拉取 [GitHub Actions 发布的双架构镜像](https://github.com/KazeLiu/china-news-radar/actions/workflows/publish-docker.yml)，避免在服务器编译。离线打包、资源覆盖配置和内存约束见 [部署与资源说明](docs/LOW-MEMORY-DEPLOY.md)。是否适合约 4 GB 的机器，须结合真实采集峰值与其他程序占用确认。

## 文档导航

- [开发计划与当前进度](docs/DEVELOPMENT-PLAN.md)
- [目标电脑接续与验收说明](docs/CONTINUE-ON-ANOTHER-PC.md)
- [部署与使用说明](docs/DEPLOY-RADAR.md)
- [管理员登录与账号初始化](docs/ADMIN-ACCESS.md)
- [网页采集与独立 Camoufox](docs/WEB-CRAWLER.md)
- [RSSHub 接入与实测记录](docs/RSSHUB.md)

## 当前开发状态

手动新闻、人工隐藏、日志统计和前台整合的既有检查记录见 [开发计划第 17 节](docs/DEVELOPMENT-PLAN.md#17-接续代码审查与本地验收2026-10-13)。当前新增密钥只写配置、无标题新闻的 AI 标题及 Camoufox 接入；按本轮约定仅做代码与调用关系自查，没有运行测试或付费模型。浏览器各平台的安装条件和实际验证范围见 [网页采集说明](docs/WEB-CRAWLER.md)。真实平台与 Ubuntu ARM64/TLS 部署仍需在实际环境验收。

## 项目结构

```text
china-news-radar/
├── client-next/         # Next.js 前端
├── server/              # NestJS 后端与 Prisma 数据结构
├── scripts/             # 数据库升级、账号初始化等工具
├── skills/hot-monitor/  # Agent Skill
├── docs/                # 开发、部署与接续文档
└── compose.arm64.yml    # Ubuntu x86_64 / ARM64 部署配置
```

## 作者与致谢

- 作者：[蓝芷怡 / KazeLiu](https://github.com/KazeLiu)
- 仓库：[KazeLiu/china-news-radar](https://github.com/KazeLiu/china-news-radar)
- 邮箱：kaze.liu@qq.com

本项目基于 [zenitlab/ai-hot-radar](https://github.com/zenitlab/ai-hot-radar) 开发，感谢上游作者提供的基础实现。

## 许可

MIT（沿用上游 README 的许可声明）。
