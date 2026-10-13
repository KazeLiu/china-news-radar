# 涉华功能与上游模块的接入

默认应用仍由上游 `AppModule` 组装，`RadarModule` 提供涉华采集、管理后台、AI 配置、数据同步和生成服务。上游热点、精选、日报、关注和 Agent 目录继续承担原有职责。`RADAR_MODE=legacy` 保留原 AI 行业后端；默认新闻模式不注册旧采集调度、旧设置接口或聊天接口。

## 数据与接口

原始新闻、收藏、出处与时间以 `NewsItem` 为准。`NewsBridgeService.sync` 在新闻写入事务中更新关联的 `Hotspot`，上游查询通过 `contentScope` 限定可见且出处已识别的记录。原 `/api/hotspots`、`/api/curated`、`/api/digest`、`/api/keywords`、`/api/entities` 和 `/api/agent` 接口继续使用；现有 `/api/news` 负责快讯和后台。

`NewsKeywordMatch` 支持一条新闻匹配多个关注词。`NewsDigest` 和 `NewsEntityProfile` 保存涉华日报与档案，上游 `DailyDigest`、`EntityCard` 和历史原文继续保留。日报沿用北京时间 08:05 汇总前一日内容的约定；浏览器只读已保存结果。规则生效后，缓存日报的展示也隐藏对应报道。

## AI 与升级

第二版新闻协议在单次分类翻译中加入质量评分。第一版已完成缓存继续复用，缺少评分的记录显示未评分，不因升级、模型切换或时间变化自动重新调用模型。共享调用服务在 SQLite 事务中预留 UTC 每日额度，日报和档案还使用持久租约防止相同任务同时生成。

数据库启动脚本先检查新增字段。需要升级已有数据库时，先使用 SQLite `VACUUM INTO` 创建一致性备份，再添加可空新闻关联、通知状态及唯一索引，最后执行不带数据丢失确认参数的 Prisma 同步。备份与原数据库同目录；升级失败停止启动。

## 验证

运行后端测试和构建、Next.js 构建及所改文件 ESLint。`node scripts/check-radar-integration.cjs` 使用升级前 schema 的临时 SQLite 和本地模型 HTTP 服务，验证原数据保留、模块装载、第一版缓存复用、多关键词、同步幂等、所有核心接口、共享额度及错误隐私。

加 `--serve` 时，检查通过后在 3421 端口保留测试后端；采集关闭且所有来源暂停，不调用外部媒体或付费模型。前端使用 `INTERNAL_API_URL=http://127.0.0.1:3421` 和 3420 端口启动，只通过 Codex 内置浏览器调试。向测试进程标准输入发送 `stop` 可以关闭它。
