# China Radar · Overseas News About China

China Radar aggregates overseas reporting about China, with Chinese classification, translation, curated news, hotspots, daily digests, and keyword subscriptions. Maintained by 蓝芷怡 (KazeLiu).

[简体中文](README.md) · English

## Features

- **Curated reading**: the home page opens curated news, with source, topic, time, and keyword filters. Quality scores affect ordering, not eligibility; unscored articles can still appear.
- **Source management**: RSS, public web pages, Telegram, and exclusion rules. RSS supports ordered fallback URLs; RSSHub feeds use complete URLs.
- **Shared AI analysis**: classification, translation, and scoring run in persistent batch jobs. Results are cached; reading and viewing statistics do not call a model.
- **Manual publishing**: save pasted content or URL extracts as drafts, request analysis, edit display text, then explicitly publish. Articles and images can be hidden and restored separately without deleting the original data.
- **Operation logs**: collection and AI statistics distinguish previews, actual requests, retries, and processed articles. Dates use Beijing time; quotas use UTC. Logs are retained for 30 days.
- **Hotspots, digests, subscriptions, and Agent/RSS**: public queries share the same content rules and exclude drafts and hidden articles. Integration details are available on the in-app Agent page.

## Setup and deployment

Use **Node.js 22 and pnpm 9.12.1**. The backend uses NestJS 11, Prisma, and SQLite; the frontend uses Next.js 16 and React 19.

Clone [KazeLiu/china-news-radar](https://github.com/KazeLiu/china-news-radar), then follow the [main README](README.md#本地准备) and [target-computer setup and acceptance guide](docs/CONTINUE-ON-ANOTHER-PC.md) for dependencies, environment configuration, database upgrades, and account initialization. The detailed guides are in Chinese.

Keep `COLLECTOR_ENABLED=false` and `AI_ANALYSIS_ENABLED=false` during initial preparation. Model credentials are not required to install dependencies or prepare an empty database. Do not commit databases, passwords, API keys, or Telegram sessions.

Administration is available at `/admin`; accounts are initialized through an interactive local command, with no default account. See [administrator access](docs/ADMIN-ACCESS.md).

The deployment target is **Ubuntu ARM64 with Docker**, using `compose.arm64.yml` and `Dockerfile.radar`. The planned domain is `china-news.951211.xyz`. See the [deployment guide](docs/DEPLOY-RADAR.md) for persistent storage and access protection.

Web collection and URL extraction require a separate Chromium installation, not a personal Chrome profile. Pasted content does not require Chromium, and RSSHub is optional.

## Documentation

- [Development plan and progress](docs/DEVELOPMENT-PLAN.md)
- [Target-computer setup and acceptance](docs/CONTINUE-ON-ANOTHER-PC.md)
- [Deployment](docs/DEPLOY-RADAR.md)
- [Administrator access](docs/ADMIN-ACCESS.md)
- [Web collection and Chromium](docs/WEB-CRAWLER.md)
- [RSSHub integration](docs/RSSHUB.md)

## Current status

Manual publishing, content hiding, operation logs, and frontend integration have passed local functional checks. Standalone Chromium is installed. Regression checks use isolated SQLite databases, a mocked SDK, or a local model server, without paid services. Real media sources, platform accounts, and Ubuntu ARM64/TLS deployment still need acceptance in their actual environments. See [the development record](docs/DEVELOPMENT-PLAN.md#17-接续代码审查与本地验收2026-10-13) for results and remaining steps.

## Author and credits

- Author: [蓝芷怡 / KazeLiu](https://github.com/KazeLiu)
- Repository: [KazeLiu/china-news-radar](https://github.com/KazeLiu/china-news-radar)
- Email: kaze.liu@qq.com

Built on [zenitlab/ai-hot-radar](https://github.com/zenitlab/ai-hot-radar). Thanks to the upstream author for the foundation.

## License

MIT, retaining the license declaration from the upstream README.
