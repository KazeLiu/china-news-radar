export interface AnalysisItem {
  title: string; titleZh: string | null; summary: string; summaryZh: string | null; topic: string;
  aiStatus: string; decisionBy: string; aiTopics: string; aiRelation: string | null; aiType: string | null;
  aiLanguage: string | null; aiReason: string | null; aiInputTruncated: boolean; analyzedAt: string | null;
}
const dateFormat = new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
export const clock = (value: string | null) => value ? dateFormat.format(new Date(value)) : '尚未更新';
export const isGoogleIndex = (url: string) => url.startsWith('https://news.google.com/');
export function topicsFor(item: AnalysisItem): string[] {
  try {
    const topics: unknown = JSON.parse(item.aiTopics || '[]');
    if (Array.isArray(topics) && topics.length) return topics.filter((topic): topic is string => typeof topic === 'string' && ['policy', 'economy', 'diplomacy', 'technology', 'security', 'society'].includes(topic));
  } catch { /* Older stored records use their primary topic. */ }
  return [item.topic];
}
export function decisionName(item: AnalysisItem) { return item.decisionBy === 'ai' ? 'AI 分析' : item.decisionBy === 'ai-uncertain-rules' ? 'AI 不确定 · 规则兜底' : item.decisionBy === 'rules-waiting' ? '规则暂显 · AI 排队中' : '规则兜底'; }
