# 统一 AI 分析与简体中文翻译

管理员统一提供模型服务，无个人翻译 API 配置。启用的 RSS 与 Telegram 新闻先保存原文，再由后台模型一次返回涉华关系、多个主题、文章类型、原文语言、理由及必要的简体中文译文。未完成分析的候选暂不进入主列表；排队超过 15 秒时规则暂显，分析完成后更新，避免慢模型阻塞快讯。AI 关闭、缺密钥、额度耗尽或失败时使用原有规则。来源身份、日期、空内容与国内来源排除仍先校验，不由模型改写。原始出处未知的频道消息仍只在线索模式显示。

## 开启

打开 `/admin` 的“AI 配置”，填写接口地址、模型和密钥并保存，勾选“启用 AI”开启后台分析。保存后以数据库配置为准，重启保留。下方“测试 AI 调用”可以用自定义标题、摘要检查连接和项目要求的返回结果；每次测试计入每日额度，不保存为新闻或写入分析缓存。

首次未保存后台配置时，也可以在自己的 `server/.env`（本地）或根 `.env`（Docker）设置默认值：

```dotenv
AI_ANALYSIS_ENABLED=true
OPENAI_API_KEY=
OPENAI_BASE_URL=
OPENAI_MODEL=gpt-4o-mini
AI_DAILY_LIMIT=100
```

密钥只在自己的机器填写，不发送到聊天或提交到 Git。`OPENAI_BASE_URL` 可填写兼容 Chat Completions 与 JSON object 输出的可信服务。未指定新开关时兼容旧 `AI_TRANSLATION_ENABLED`，行为为统一分析。模型需要支持 system prompt 和 `response_format: json_object`；不支持或返回无效结构时会回退规则。环境变量默认值在重启后端后生效，已保存的后台配置优先。

## JSON 契约

```json
{
  "version": 1,
  "relation": "related",
  "topics": ["policy", "technology"],
  "type": "report",
  "language": "en",
  "reason": "涉及对中国的芯片出口限制",
  "translation": {
    "title": "简体中文标题",
    "summary": "所提供摘要的简体中文译文"
  }
}
```

- `relation`：`related` / `unrelated` / `uncertain`，不表示新闻真实性。
- `topics`：1–6 个不重复主题，首项为主主题；`policy` / `economy` / `diplomacy` / `technology` / `security` / `society`。筛选支持匹配任何一个主题。
- `type`：`breaking` / `report` / `analysis` / `opinion` / `feature` / `sports` / `entertainment` / `other`。主快讯流保留涉华的 breaking/report，其余隐藏但不删除；收藏记录仍可回查。
- `language`：`zh-Hans` / `zh-Hant` / `en` / `other` / `mixed`。简体中文要求 `translation=null`；其他语言要求同一次响应提供标题与摘要的简体中文译文。
- `reason`：不超过 400 字符；字段与枚举严格校验，不接受部分译文、额外字段或 markdown 包裹。

原文最多提供 600 字符标题和 1600 字符摘要，长内容明确标为截取摘要，不假装读过全文。原文和译文在阅读页可展开对照；模型判断与翻译不会覆盖原始出处、发布时间、首次发现时间或内容更新时间。

## 缓存、队列与成本

按完整规范化标题、摘要、目标语言与协议版本计算缓存键；完全相同文本跨来源共用。URL、发布时间或模型选择变化不自动重做已完成结果；原文内容变化才创建新任务。结果、队列、次数及尝试状态存在 SQLite，重启后继续；读取列表、搜索、收藏和刷新都不会调用模型。

单实例串行处理，独立于 RSS 检查，正常情况下分析与翻译共用一次请求。每日 UTC 调用次数在发送请求前以事务预留，失败尝试也计入；达到上限当日使用规则，次日恢复。每次请求有 20 秒超时、有限输入和最多 3000 输出 token。单内容最多尝试 3 次，失败后按 30/60 秒退避，429 尊重 Retry-After，最终保持规则兜底。当前次数上限不是金额上限，也不是每日 token 总量上限。

处理中任务有 90 秒租约，异常退出后可恢复。远端已收费但进程在结果入库前退出的情况可能需要重试，不能承诺外部 API 严格只收费一次。已成功入库的结果不会因重启重做。新闻编辑后旧任务只更新仍关联旧内容键的条目，避免旧译文覆盖新版。

用户本轮明确将 Telegram 新闻纳入统一 AI，替代此前排除方案。程序仅处理启用目标频道的新闻，不发送登录信息或私聊。Telegram API 与内容许可对 AI 使用存在限制；本地接口和模拟测试不代表平台许可，真实账号接入前须核对 [API 条款](https://core.telegram.org/api/terms) 与 [内容许可](https://telegram.org/tos/content-licensing)。尚未进行真实账号或真实付费模型验证。

## 本地验证

```powershell
pnpm.cmd --filter ai-hot-radar-server test
pnpm.cmd --filter ai-hot-radar-server build
node scripts/check-ai.cjs
```

`check-ai.cjs` 创建临时隔离 SQLite，使用进程内模拟模型验证真实存取、缓存、TG、中文不重翻与持久额度，不调用任何外部 API，也不修改阅读用数据库。
