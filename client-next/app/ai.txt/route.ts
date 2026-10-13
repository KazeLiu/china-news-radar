import { NextResponse } from 'next/server';

// Describe the deployed content scope and existing Agent interfaces.
export async function GET(request: Request) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;

  const content = `# AI.txt for China Radar
# Version: 2.0

# About
Site-Name: China Radar
Site-URL: ${siteUrl}
Description: 聚合海外涉华报道，提供精选、热点、日报与关注档案。
Language: zh-CN
Purpose: news-aggregation, news-curation
Topics: china, policy, economy, diplomacy, technology, security, society
Upstream-Repository: https://github.com/zenitlab/ai-hot-radar

# Crawling Policy
Allow-AI-Training: no
Allow-AI-Indexing: yes
Preferred-Crawl-Rate: 1 req/sec

# API Access (for AI agents)
API-Endpoint: ${siteUrl}/api/agent
API-Docs: ${siteUrl}/agent
RSS-Feed: ${siteUrl}/api/agent/rss/curated.xml
Skill-Package: ${siteUrl}/aihot-skill

# Data Freshness
Update-Frequency: configured per source; digest daily at 08:05 Beijing

# Citation Preference
Citation-Format: cite the identified publisher and original article URL
Attribution-Required: yes

# Additional Context
Data-Sources: configured overseas RSS, Google News indexes, public web pages, APIs, enabled Telegram channels, and administrator-published reports
AI-Scoring: batched classification, translation and quality scoring; reading uses saved results; scores rank reports without an admission threshold
Deduplication: unique URLs; identical titles are folded for display
Visibility: drafts and hidden reports are excluded; hidden images are not returned
`;

  return new NextResponse(content, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400', // 24h cache
    },
  });
}
