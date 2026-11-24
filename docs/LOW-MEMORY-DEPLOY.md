# 共享主机的资源优化与部署约束

适用目标：3 核 x86_64、约 3.85 GB 内存，且已有其他程序常驻。优先使用生产镜像和单后端实例，不在这台机器上运行 `next dev`、`ts-node` 或并行构建镜像。

浏览器版本、指纹和页面加载策略保持不变。自动采集省略不使用的截图与结构样本，浏览器到达寿命阈值后等当前会话完成再回收。资源覆盖配置只收紧前端及辅助服务。基础配置的后端上限为 4 GiB，超过这台主机的总内存；部署前须确认实际采集峰值能与其他程序共存。

## x86_64 可以用，镜像要选 linux/amd64

Xeon E5-2683 v4 使用 `linux/amd64` 镜像。仓库的 `compose.arm64.yml` 没有固定架构；四个服务的 Dockerfile 均从构建目标平台安装依赖，浏览器安装脚本也支持 Linux x64。ARM64 单架构镜像不能直接原生运行在这台机器上，不建议在小内存主机上用模拟运行。[Docker 多平台镜像说明](https://docs.docker.com/build/building/multi-platform/)

**推荐在另一台内存充足的机器构建，再将镜像送到服务器运行。** 也可以从 GitHub 拉源码在服务器构建，但依赖安装、TypeScript 和 Next.js 编译的内存峰值不受运行时 `mem_limit` 控制。仓库当前没有发布 Docker 镜像的 GitHub Actions 工作流，拉源码不等于能直接 `docker pull` 成品镜像。

以下命令在 Linux shell 的项目根目录执行，需要 Git、Docker 及相应目录权限；没有 Docker 权限时使用 `sudo docker`。构建机使用 Docker Desktop 时需选择 Linux 容器。

### 推荐：构建机打包，服务器只运行

构建机取得包含所需修复的代码版本，依次构建，避免并行抢内存。此处镜像名与 Compose 自动生成的名称一致，构建不需要生产密钥：

```bash
git clone https://github.com/KazeLiu/china-news-radar.git
cd china-news-radar
docker build --platform linux/amd64 -f server/Dockerfile.radar -t china-news-radar-server:latest .
docker build --platform linux/amd64 -f client-next/Dockerfile.radar -t china-news-radar-client:latest .
docker save -o china-news-radar-amd64.tar china-news-radar-server:latest china-news-radar-client:latest
```

需要 RSSHub 或 Telegram 时，导出前分别用 `rsshub-service/Dockerfile.radar` 和 `telegram-collector/Dockerfile` 构建 `china-news-radar-rsshub:latest`、`china-news-radar-telegram:latest`，同样指定 `--platform linux/amd64`，并将使用的镜像名加入 `docker save`。不启用这些服务则无需构建。

服务器准备同一代码版本的部署文件（可放在 `/opt/china-news-radar`），将镜像包上传后导入：

```bash
docker load -i china-news-radar-amd64.tar
```

然后按下一节使用 `--no-build` 启动。Caddy 使用现成官方镜像，由 Docker 拉取目标架构版本。更新现有服务前保留上一版镜像与数据库备份，不覆盖现有 `.env`、运行时 Compose 或数据挂载。

### 可选：服务器从 GitHub 拉源码构建

新部署先执行上述 `git clone`；已有干净源码目录使用 `git pull --ff-only`。先按 [部署说明](DEPLOY-RADAR.md) 配置域名与访问保护，并确认构建时有足够可用内存，再执行：

```bash
docker compose --parallel 1 -f compose.arm64.yml -f compose.low-memory.yml build server client
docker compose -f compose.arm64.yml -f compose.low-memory.yml up -d --no-build
```

在 x86_64 Linux 服务器原生构建默认得到 amd64 镜像，无需另写 x86 Dockerfile。需要 RSSHub/Telegram 时，构建和启动均加入对应 `--profile`，构建列表也加入相应服务。这里必须显式指定 `-f compose.arm64.yml`；不要使用根目录保留的旧上游 `docker-compose.yml`，它的构建上下文、端口和数据库路径不适用于当前涉华部署。

只有已推送到 GitHub 的修改才能被服务器拉取；本地未提交、未推送的修复需先发布，或直接从包含修复的本地目录构建镜像。

## 使用资源覆盖配置

确认目标机有足够的实际资源，并准备好部署配置和镜像后，启动命令使用两个文件：

```bash
docker compose -f compose.arm64.yml -f compose.low-memory.yml up -d --no-build
```

前提是镜像已经构建或装入目标机。首次使用后台时，在后端容器中交互初始化管理员账号：`docker compose -f compose.arm64.yml -f compose.low-memory.yml exec server node scripts/admin-account.cjs`，然后进入 `/admin` 登录。普通更新不需重新初始化，否则会重置账号并使旧会话失效。账号保存在数据库，不依赖旧 `ADMIN_TOKEN`。

资源配置如下；它们是容器硬限制，不是实测占用：

| 服务 | 内存限制 | CPU 限制 | 默认启动 |
| --- | --- | --- | --- |
| 后端与网页浏览器 | 沿用基础配置：4 GiB | 不新增限制 | 是 |
| Next.js 生产前端 | 384 MiB | 0.5 核 | 是 |
| Caddy | 128 MiB | 0.25 核 | 是 |
| RSSHub | 512 MiB | 0.5 核 | 需显式启用 |
| Telegram | 256 MiB | 0.25 核 | 需显式启用 |

前端与 Caddy 的限制合计为 512 MiB；再启用 RSSHub 和 Telegram 后，非后端服务的限制合计为 1280 MiB。后端与浏览器另计，操作系统、Docker 和其他程序也需要内存。这些限额不是预留量或实测占用；硬限制超限仍可能导致容器内进程被终止。[Docker 资源限制说明](https://docs.docker.com/engine/containers/resource_constraints/)

如果来源使用 `http://rsshub:3412/...`，必须加 `--profile rsshub`；启用 Telegram 同理：

```bash
docker compose -f compose.arm64.yml -f compose.low-memory.yml --profile rsshub --profile telegram up -d --no-build
```

不要在已启用 RSSHub 来源时省略该服务。覆盖文件只改变启动与资源设置，不删除来源或新闻。已有部署切换到此配置时，先盘点当前服务；已有的 RSSHub 容器不会因为新增 profile 自动变成不占资源。

若宿主已有反向代理占用 80/443，应沿用原部署的代理接入方案，不直接再启动一个占用这些端口的 Caddy。资源覆盖配置不会改变端口、密钥或挂载卷。

## 网页采集的边界

- 浏览器按需启动，实例运行 60 分钟或使用 80 次后，在自动采集与人工窗口均结束时关闭。旧实例关闭完成前不启动新实例；关闭失败时重启后端恢复采集。
- 保留原有来源并发规则、人工窗口流程、请求与 TLS 代理逻辑。代理启动过程中若任务已取消，立即关闭新建监听器，不继续创建页面。
- 自动“加载更多”采集仍执行相同的跳转、稳定等待和 HTML 校验，但不再生成无人使用的 JPEG/Base64 截图；管理员加载预览和人工窗口截图保持原样。
- 普通采集不再重复解析整页以生成无人使用的 AI 结构样本；管理员明确触发解析辅助时，仍从原快照生成样本。“加载更多”与普通采集共用本站公开浏览状态；浏览器重建后，旧会话不能重新写回状态缓存。
- 站点状态最多缓存 30 分钟、最多保存 20 份。实例回收、浏览器断开、修改网络或关闭服务时一并清理。
- 后端保存的页面 HTML 快照在原有 30 分钟有效期结束时主动从内存删除，不提前失效，也不关闭浏览器。
- 覆盖文件不设置后端的 `NODE_OPTIONS`、CPU 或内存限制，均沿用基础部署配置。不要为了达到某个内存数字而盲目压低浏览器所在容器的上限。
- 若保持现有采集行为后的实际峰值无法与其他程序共存，需要调整部署资源；本轮不以牺牲网页采集成功率换取更低占用。

空闲回收限制了浏览器实例的常驻时间。若单个采集会话仍触发容器 OOM，用实际峰值判断应降低并发还是为浏览器单独分配内存预算。

## 本次数据路径调整

- AI 任务与新闻关联在同一事务中入队；队列准备不重入，历史、规则兜底和禁用 AI 的待处理条目按 100 条分页。
- 失败任务统一由运行器收尾，保留实际错误与通知；历史准备遇到配置变更立即停止继续修改条目，避免在关闭 AI 后将新闻重新标成待分析。
- 常规启动只修复缺失热点关联。过滤规则未变化时不重筛整库，保存 AI 配置不重建所有热点。关键词变化只重算对应关键词的匹配。
- 热点重要度按数据库分组分页；没有互动数据时热度直接按原来的时间顺序分页。有互动数据时仍需扫描排序字段，但每批 256 条，只保留到目标页为止的候选，不读取全库正文。
- 热点每页最多 100 条、偏移最多 100000 条；列表不加载原文正文，文章详情保持原样。日志合并与分页在 SQLite 中执行，只读取当前页详情。
- 热点同步、通知、关键词详情和日报素材不再读取未使用的原文正文；一篇新闻的关键词关联批量写入。Docker 构建排除本地预览缓存、持久媒体与迁移包，避免把运行数据装进镜像。
- 新增热点分组、排序、待分析队列等查询索引。数据库初始化沿用原有一致性备份与非破坏性升级；schema 未变时不再启动 Prisma CLI 重复同步。

## 部署时的验收与恢复

本轮仅做代码、调用关系和差异自查，未运行测试、构建、Docker 或真实浏览器。现有 AI 测试夹具已按用户补充授权同步到 Responses API 与当前浏览器初始化接口，没有新增用例或执行测试。

在目标机对照 `Camoufox 已关闭` 日志，观察容器在空闲回收前后的内存、正常采集峰值和网页成功率。使用 cgroup v2 时，检查 `memory.current` 是否在回收后回落、`memory.events` 中的 `oom_kill` 是否继续增长。

首次运行新 schema 会创建升级前数据库备份；保留旧镜像与备份。若升级失败，不加 `--accept-data-loss`，先保留现场并查看错误。恢复旧数据库前必须停止写入并另存当前数据库，避免丢掉升级后的新闻与收藏。不要使用 `docker compose down -v`。
