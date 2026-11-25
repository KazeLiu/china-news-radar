import { ChevronDown } from 'lucide-react';
import type { ChinaEvaluation } from '@/types';

const polarityLabels = { positive: '偏正面', negative: '偏负面', neutral: '中性' };
const fieldLabels = { title: '原标题', summary: '原始摘要', body: '正文片段' };

export function ChinaEvaluationDetails({ evaluation }: { evaluation: ChinaEvaluation }) {
  const { target, polarity, attribution, field, excerpt } = evaluation;
  const attributionLabel = attribution.kind === 'quoted'
    ? `${attribution.speaker}${polarity === 'neutral' ? '的说法' : '观点'}`
    : polarity === 'neutral' ? '报道陈述' : '报道自身评价';
  const shortAttribution = attribution.kind === 'quoted' && attribution.speaker.length > 5
    ? polarity === 'neutral' ? '引述陈述' : '引述观点'
    : attributionLabel;

  return (
    <details className="group/evaluation mb-3 rounded-lg bg-[var(--bg-elevated)] text-sm text-[var(--text-secondary)]">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-x-2 rounded-lg px-3 py-2 hover:bg-[var(--bg-hover)] focus-visible:outline-2 focus-visible:outline-[var(--accent-blue)] [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-baseline gap-x-1">
          <span className="truncate" title={`对${target}`}>对{target}：</span>
          <strong className="shrink-0 font-medium text-[var(--text-primary)]">{polarityLabels[polarity]}</strong>
          <span className="shrink-0 whitespace-nowrap text-xs" title={attributionLabel}>· {shortAttribution}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-xs text-[var(--accent-blue)]">
          <span className="group-open/evaluation:hidden">查看依据</span>
          <span className="hidden group-open/evaluation:inline">收起依据</span>
          <ChevronDown size={14} className="group-open/evaluation:rotate-180" aria-hidden="true" />
        </span>
      </summary>
      <div className="space-y-1 border-t border-[var(--border-subtle)] px-3 py-2.5">
        <p className="break-words text-xs">对象：{target} · 归因：{attributionLabel} · {fieldLabels[field]}</p>
        <blockquote dir="auto" className="whitespace-pre-wrap break-words border-s-2 border-[var(--border-subtle)] ps-2 leading-relaxed text-[var(--text-primary)]">{excerpt}</blockquote>
      </div>
    </details>
  );
}
