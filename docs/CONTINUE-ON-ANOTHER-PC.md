# 在另一台电脑接续与验收

按本文在新的电脑准备依赖、数据库和账号。手动新闻、人工隐藏、日志统计及前台整合的基础检查记录见 [开发计划第 17 节](DEVELOPMENT-PLAN.md#17-接续代码审查与本地验收2026-10-13)。当前新增功能与验证范围见开发计划开头及 `WEB-CRAWLER.md`。换电脑仍需各自准备持久数据和独立 Camoufox。

## 先准备依赖与数据库

在项目根目录执行下列命令。使用 Node 22.15 或更新的兼容版本和 `pnpm@9.12.1`，按锁文件安装前后端依赖；RSSHub 是独立可选服务，不是手动录入和日志页面的前置依赖。

```powershell
npx --yes pnpm@9.12.1 --filter ai-hot-radar-server --filter client-next install --frozen-lockfile
```

没有 `server/.env` 时，从 `server/.env.radar.example` 复制后自行编辑；不要覆盖已有配置。首次准备保持 `COLLECTOR_ENABLED=false`、`AI_ANALYSIS_ENABLED=false`，不要填入付费模型或平台凭据。前端与后端端口使用 3420/3421 时，同时设置后端 `PORT=3421`、`CLIENT_URL=http://localhost:3420`，以及前端 `INTERNAL_API_URL=http://127.0.0.1:3421`。

本机新空库在 `server/prisma/radar.db`，没有旧新闻、译文、配置或后台账号。目标电脑选择空库或安全转移的旧库后，让 `DATABASE_URL` 指向该文件，再生成 Client 和升级结构：

```powershell
npx --yes pnpm@9.12.1 --filter ai-hot-radar-server exec prisma generate
node scripts/init-db.cjs
```

升级脚本在结构或配置版本变化时创建 SQLite 一致性备份，不接受数据丢失。已有运行中的数据库先停止本项目服务，或取得一致性副本再升级；不要直接复制仍在写入的 `.db` 文件。新闻、译文、缓存、收藏和后台配置应随原库保留，上传目录和 Telegram session 需另行安全转移，不提交 Git。

后台账号通过交互命令初始化或重置，见 [管理员登录](ADMIN-ACCESS.md)。不要在命令参数中放密码。本轮没有为新空库创建默认账号。

## 网页能力需要独立 Camoufox

```powershell
node scripts/install-camoufox.cjs
```

Camoufox 按电脑安装，不随 Git 同步。粘贴录入不依赖它；网页来源预览、URL 提取、解析规则辅助依赖它。安装与 ARM64 部署说明见 [WEB-CRAWLER.md](WEB-CRAWLER.md)，不连接个人 Chrome 或加载个人登录资料。

## 验收当前业务流程

目标电脑启动前先核对端口，不终止其他任务的进程。账号、数据和服务准备好后，重点确认：

- `/admin` 的登录、退出、过期和统一权限；未登录不能读取草稿、私有来源、密钥或操作日志。
- `/admin?tab=news`：粘贴保存只生成草稿；主动分析复用缓存或进入持久队列；预览、展示文案和发布不额外调用模型；素材变更回到草稿。
- 手动新闻只在明确发布后进入公共查询。没有媒体原文的记录标注管理员录入并使用 `/articles/:id`，同 URL 返回原记录。
- 隐藏文章影响精选、热点、关注、Agent/RSS、站内文章、已有日报及通知；依赖被隐藏条目的日报概述不展示。隐藏图片保留文字与原图数据，恢复不重放通知或启动分析。
- `/admin?tab=logs`：日期按北京时间，额度按 UTC；实际请求、重试、处理文章分别计数；来源预览与正式采集分开；清理只影响过期日志和请求明细。
- 首页和 `/news` 进入精选，`/saved` 进入我的关注；通过筛选但未评分的旧记录能展示；来源、主题、时间、搜索、加载更多、原文切换、配图及出处时间可用。相同筛选条件下 `/api/curated` 与 `/api/agent/curated` 应一致。
- 关于、页面元数据和站点描述使用 China Radar、蓝芷怡及已提供的联系信息，保留上游致谢。部署保护仍保留，是否公开访问另行决定。

相关回归用例和集成脚本已经适配会话与持久队列。后续仍按用户明确要求运行相应检查，不自动调用付费模型或登录真实平台。真实 Telegram 接入与 ARM64/TLS 部署分别验收，不用它们代替本地模拟检查。
