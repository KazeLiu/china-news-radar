import styles from './news.module.css';
import { decisionName, type AnalysisItem } from './news-format';
const typeNames: Record<string, string> = { breaking: '突发快讯', report: '新闻报道', analysis: '分析', opinion: '评论', feature: '深度专题', sports: '常规体育', entertainment: '文娱', other: '其他' };
const languageNames: Record<string, string> = { 'zh-Hans': '简体中文', 'zh-Hant': '繁体中文', en: '英文', other: '其他语言', mixed: '混合语言' };
export function NewsAnalysisDetails({ item }: { item: AnalysisItem }) {
  const translated = !!item.titleZh || !!item.summaryZh;
  const fallback = item.aiStatus === 'pending' ? 'AI 仍在排队或处理中，先按关键词和栏目规则展示，完成后更新。' : item.aiStatus === 'limited' ? '今日调用额度用尽，采用关键词和栏目规则。' : item.aiStatus === 'failed' ? 'AI 处理失败，采用关键词和栏目规则。' : 'AI 未启用，采用关键词和栏目规则。';
  return <details className={styles.analysisDetails}>
    <summary>{translated ? '分析结果与原文译文对照' : '查看筛选依据'}</summary>
    <p className={styles.analysisExplanation}><strong>{decisionName(item)}</strong>{item.aiType && <> · {typeNames[item.aiType] || item.aiType}</>}{item.aiLanguage && <> · 原文：{languageNames[item.aiLanguage] || item.aiLanguage}</>}</p>
    <p className={styles.analysisExplanation}>{item.aiReason || fallback}</p>
    {item.aiReason && <p className={styles.analysisHint}>模型判断仅用于筛选与分类，请以报道原文为准。{item.aiLanguage === 'zh-Hans' && '原文已是简体中文，未重复翻译。'}</p>}
    {item.aiInputTruncated && <p className={styles.analysisHint}>原文较长，AI 仅分析标题和前 1600 字符摘要，译文也仅覆盖所提供摘要。</p>}
    {translated && <div className={styles.comparison}>
      <div><h3>原文</h3><p>{item.title}</p>{item.summary && <p>{item.summary}</p>}</div>
      <div><h3>简体中文译文</h3><p>{item.titleZh || item.title}</p>{item.summaryZh && <p>{item.summaryZh}</p>}</div>
    </div>}
  </details>;
}
