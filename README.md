# China Radar · 海外涉华快讯

聚合海外媒体涉华报道，提供中文分类、翻译、精选、热点、日报与关键词关注。由蓝芷怡维护。

简体中文 · [English](README.en.md)

## 主要功能

- **精选阅读**：首页进入精选，可按来源、主题、时间和关键词筛选，切换原文。通过内容与展示规则筛选的报道均可展示，质量评分只用于排序，未评分内容不会因此被排除。
- **来源管理**：管理 RSS、网页与 Telegram 来源，配置排除规则。RSS 支持多个备用地址，按顺序尝试；RSSHub 作为完整 RSS 地址填写。
- **统一 AI 分析**：新增内容进入持久队列，按周期合批完成分类、翻译与评分。分析结果持久缓存，阅读、筛选和查看统计不调用模型。
- **手动新闻与人工隐藏**：在 `/admin?tab=news` 粘贴内容或提取 URL，保存草稿、主动分析、编辑展示文案，再明确发布。文章和图片可分别隐藏与恢复，保留原始数据。
- **操作日志**：在 `/admin?tab=logs` 查看采集和 AI 请求统计，区分正式采集、来源预览、实际请求、重试与处理文章。日期按北京时间，额度按 UTC；日志保留 30 天。
- **热点、日报、关注与 Agent/RSS**：公共内容范围统一，草稿和人工隐藏的文章不会进入公共查询。接口与订阅用法见站内「Agent 接入」页。

## 本地准备

- Node.js 22、pnpm 9.12.1。
- 后端：NestJS 11、Prisma、SQLite；前端：Next.js 16、React 19。
- AI 分析使用兼容 OpenAI 协议的模型，由管理员统一配置；准备依赖与空数据库不需要模型密钥。
- 网页采集和 URL 提取需要独立 Chromium；粘贴录入不依赖它，RSSHub 也是可选服务。

```powershell
git clone https://github.com/KazeLiu/china-news-radar.git
cd china-news-radar
npx --yes pnpm@9.12.1 --filter ai-hot-radar-server --filter client-next install --frozen-lockfile
```

没有 `server/.env` 时，从 `server/.env.radar.example` 复制并编辑，不覆盖已有配置。首次准备保持 `COLLECTOR_ENABLED=false`、`AI_ANALYSIS_ENABLED=false`。数据库可使用新空库，也可安全迁入旧库；结构升级、账号初始化、端口配置与验收步骤见 [目标电脑接续与验收说明](docs/CONTINUE-ON-ANOTHER-PC.md)。不要将数据库、密码、模型密钥或 Telegram session 提交到 Git。

管理入口为 `/admin`，账号通过本地交互命令初始化，没有默认账号。详见 [管理员登录](docs/ADMIN-ACCESS.md)。

## 部署

部署目标为 **Ubuntu ARM64 + Docker**，预定域名为 `china-news.951211.xyz`。使用仓库中的 `compose.arm64.yml` 和 `Dockerfile.radar`，按 [部署与使用说明](docs/DEPLOY-RADAR.md)配置持久卷、访问保护与反向代理。

网页能力的 Chromium 安装与容器配置见 [网页采集说明](docs/WEB-CRAWLER.md)，不连接个人 Chrome 或加载个人登录资料。

## 文档导航

- [开发计划与当前进度](docs/DEVELOPMENT-PLAN.md)
- [目标电脑接续与验收说明](docs/CONTINUE-ON-ANOTHER-PC.md)
- [部署与使用说明](docs/DEPLOY-RADAR.md)
- [管理员登录与账号初始化](docs/ADMIN-ACCESS.md)
- [网页采集与独立 Chromium](docs/WEB-CRAWLER.md)
- [RSSHub 接入与实测记录](docs/RSSHUB.md)

## 当前开发状态

手动新闻、人工隐藏、日志统计和前台整合已完成本地功能检查，独立 Chromium 已安装。回归使用隔离 SQLite、模拟 SDK 或本地模型，不调用付费服务。真实媒体来源、平台账号与 Ubuntu ARM64/TLS 部署仍需在实际环境验收，结果与剩余事项见 [开发计划第 17 节](docs/DEVELOPMENT-PLAN.md#17-接续代码审查与本地验收2026-10-13)。

## 项目结构

```text
china-news-radar/
├── client-next/         # Next.js 前端
├── server/              # NestJS 后端与 Prisma 数据结构
├── scripts/             # 数据库升级、账号初始化等工具
├── skills/hot-monitor/  # Agent Skill
├── docs/                # 开发、部署与接续文档
└── compose.arm64.yml    # Ubuntu ARM64 部署配置
```

## 作者与致谢

- 作者：[蓝芷怡 / KazeLiu](https://github.com/KazeLiu)
- 仓库：[KazeLiu/china-news-radar](https://github.com/KazeLiu/china-news-radar)
- 邮箱：kaze.liu@qq.com

本项目基于 [zenitlab/ai-hot-radar](https://github.com/zenitlab/ai-hot-radar) 开发，感谢上游作者提供的基础实现。

## 许可

MIT（沿用上游 README 的许可声明）。
