import {
  Mail,
  Github,
  Sparkles,
  Radio,
  Bookmark,
  Plug,
  ExternalLink,
} from "lucide-react";
import Link from "next/link";
import { BackToTop } from "../common/BackToTop";
import { ProjectSchema, WebSiteSchema } from "../seo/StructuredData";

/**
 * 关于页 — 项目介绍 + 核心能力 + 数据源 + 联系方式。
 */

const FEATURES = [
  {
    icon: Radio,
    title: "热点雷达",
    desc: "聚合海外涉华报道，保留媒体出处、原始内容与时间；同标题折叠，按关键词追踪动态。",
    accent:
      "text-[var(--accent-blue)] bg-[var(--accent-blue)]/10 dark:text-blue-400 dark:bg-blue-500/10",
  },
  {
    icon: Sparkles,
    title: "精选 + AI 日报",
    desc: "精选展示全部通过筛选的报道，质量评分只用于排序；日报按政策、经济、外交、科技、安全与社会组织内容。",
    accent: "text-amber-600 bg-amber-500/10 dark:text-amber-400",
  },
  {
    icon: Bookmark,
    title: "我的关注",
    desc: "关注人物、国家、机构或事件，查看相关报道与保存的关注档案，接收新报道提醒。",
    accent: "text-emerald-600 bg-emerald-500/10 dark:text-emerald-400",
  },
  {
    icon: Plug,
    title: "Agent 接入",
    desc: "Skill / RSS / REST API 三种方式，让 Claude Code、Cursor、Feedly、企业 IM 都能消费。",
    accent: "text-purple-600 bg-purple-500/10 dark:text-purple-400",
  },
];

const SOURCES = [
  { group: "RSS", items: ["媒体公开 RSS", "Google News 索引", "配置的 RSSHub 地址"] },
  { group: "网页与 API", items: ["独立浏览器网页解析", "API 字段映射", "X 与搜索适配器"] },
  { group: "录入与接收", items: ["已启用的公开 Telegram 频道", "管理员手动发布"] },
];

export function AboutView() {
  return (
    <div className="px-4 py-6 max-w-3xl mx-auto">
      {/* ── Hero ────────────────────────────────────────────── */}
      <header className="mb-10">
        <h1 className="text-3xl font-bold text-[var(--text-primary)] tracking-tight mb-3">
          关于 China Radar
        </h1>
        <p className="text-[15px] text-[var(--text-secondary)] leading-[1.8]">
          China Radar 由蓝芷怡维护，追踪海外报道中的中国相关动态。
          精选资讯、热点雷达、日报和我的关注读取同一套公开新闻，保留原文链接、媒体出处、发布时间和首次发现时间。
        </p>
        <p className="text-[15px] text-[var(--text-secondary)] leading-[1.8] mt-3">
          管理员统一设置来源、排除规则与 AI。分类、必要的中文翻译和质量评分在同一请求内完成，已有结果全站复用，阅读页面不产生模型调用。
        </p>
      </header>

      {/* ── Features ────────────────────────────────────────── */}
      <section className="mb-10">
        <h2 className="text-lg font-bold text-[var(--text-primary)] tracking-tight mb-4">
          核心能力
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {FEATURES.map((f) => {
            const Icon = f.icon;
            return (
              <div
                key={f.title}
                className="p-4 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)]"
              >
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className={`flex items-center justify-center w-8 h-8 rounded-lg ${f.accent}`}
                  >
                    <Icon className="w-4 h-4" />
                  </span>
                  <h3 className="font-semibold text-[var(--text-primary)]">
                    {f.title}
                  </h3>
                </div>
                <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">
                  {f.desc}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Sources ─────────────────────────────────────────── */}
      <section className="mb-10">
        <h2 className="text-lg font-bold text-[var(--text-primary)] tracking-tight mb-4">
          数据来源
        </h2>
        <div className="space-y-3 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5">
          {SOURCES.map((g) => (
            <div
              key={g.group}
              className="flex flex-col sm:flex-row sm:items-baseline gap-1.5 sm:gap-4"
            >
              <div className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider sm:w-24 shrink-0">
                {g.group}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {g.items.map((s) => (
                  <span
                    key={s}
                    className="text-[12px] px-2 py-0.5 rounded-md bg-[var(--bg-elevated)] text-[var(--text-secondary)]"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-[var(--text-muted)] mt-3">
          来源由管理员配置。网页采集需安装独立 Chromium，国内平台本轮不默认启用。
          API 与 RSS 使用方式见
          <Link
            href="/agent"
            className="text-[var(--accent-blue)] dark:text-blue-400 hover:underline mx-1"
          >
            Agent 接入
          </Link>
          页面。
        </p>
      </section>

      {/* ── Stack ───────────────────────────────────────────── */}
      <section className="mb-10">
        <h2 className="text-lg font-bold text-[var(--text-primary)] tracking-tight mb-4">
          技术栈
        </h2>
        <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5 grid grid-cols-1 sm:grid-cols-2 gap-4 text-[13px]">
          <div>
            <div className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
              前端
            </div>
            <div className="text-[var(--text-secondary)]">
              Next.js 16 (App Router) · React 19 · TailwindCSS · lucide-react
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
              后端
            </div>
            <div className="text-[var(--text-secondary)]">
              NestJS 11 · Prisma · SQLite · Socket.io
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
              AI 模型
            </div>
            <div className="text-[var(--text-secondary)]">
              兼容 OpenAI 协议（百炼 / 硅基流动 / DeepSeek / OpenAI）
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
              数据采集
            </div>
            <div className="text-[var(--text-secondary)]">
              RSS · Chromium 网页解析 · API · Telegram · 手动录入
            </div>
          </div>
        </div>
      </section>

      {/* ── Contact ─────────────────────────────────────────── */}
      <section className="mb-10">
        <h2 className="text-lg font-bold text-[var(--text-primary)] tracking-tight mb-4">
          联系蓝芷怡
        </h2>
        <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row gap-6 items-center sm:items-start">
            {/* Text contact */}
            <div className="flex-1 space-y-3 text-center sm:text-left">
              <div>
                <div className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1">
                  邮箱
                </div>
                <a
                  href="mailto:kaze.liu@qq.com"
                  className="inline-flex items-center gap-1.5 text-[15px] text-[var(--text-primary)] hover:text-[var(--accent-blue)] dark:hover:text-blue-400 transition-colors"
                >
                  <Mail className="w-4 h-4" />
                  kaze.liu@qq.com
                </a>
              </div>
              <div>
                <div className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1">
                  代码仓库
                </div>
                <a
                  href="https://github.com/KazeLiu/china-news-radar"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-[15px] text-[var(--text-primary)] hover:text-[var(--accent-blue)] dark:hover:text-blue-400 transition-colors"
                >
                  <Github className="w-4 h-4" />
                  github.com/KazeLiu/china-news-radar
                  <ExternalLink className="w-3 h-3 opacity-60" />
                </a>
              </div>
              <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed pt-1">
                GitHub：<a href="https://github.com/KazeLiu" target="_blank" rel="noopener noreferrer" className="text-[var(--accent-blue)] hover:underline">KazeLiu</a>。问题或建议可通过邮件及项目 Issues 联系。
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────── */}
      <section className="py-6 border-t border-[var(--card-border)] text-sm text-[var(--text-secondary)] leading-relaxed"><h2 className="text-lg font-semibold mb-3">上游致谢与许可</h2><p>本项目基于 <a href="https://github.com/zenitlab/ai-hot-radar" target="_blank" rel="noopener noreferrer" className="text-[var(--accent-blue)] hover:underline">zenitlab/ai-hot-radar</a>，保留其主要模块和界面结构。感谢上游作者的工作。上游 README 声明 MIT 许可，原始内容及依赖保留各自的权利与许可说明。</p></section>

      <BackToTop />
      <ProjectSchema />
      <WebSiteSchema />
    </div>
  );
}
