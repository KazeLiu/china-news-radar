'use client';

import { useState } from 'react';
import { ExternalLink, Network } from 'lucide-react';
import type { Comparison, ComparisonArticle, ComparisonClaim, EvidenceField } from '@/types/news-comparison';
import { cn } from '@/lib/utils';
import { ComparisonGraph, citationLabels } from './ComparisonGraph';

const fields: Record<EvidenceField, string> = { title: '原标题', summary: '采集摘要', body: '正文摘录' };
const stances = { states: '直接陈述', attributes: '引述说法', qualifies: '补充条件', denies: '否认' };
const differences = { scope: '范围', wording: '措辞', attribution: '归因', timing: '时间', numbers: '数字或口径', emphasis: '报道重点' };
const date = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short' });
const control = 'inline-flex min-h-11 items-center gap-1.5 rounded-md border border-[var(--input-border)] px-2.5 text-left text-sm hover:bg-[var(--bg-hover)] aria-pressed:border-[var(--accent-blue)] aria-pressed:text-[var(--accent-blue)]';

function Excerpt({ article, evidence, phrase }: {
  article: ComparisonArticle;
  evidence?: Pick<ComparisonClaim['evidence'][number], 'quote' | 'field' | 'speaker' | 'stance'>;
  phrase?: string;
}) {
  const quote = evidence?.quote ?? '';
  const offset = phrase ? quote.indexOf(phrase) : -1;

  return <article className="min-w-0 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3">
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="text-sm font-semibold">{article.publisher}</span>
      {article.publishedAt ? <time dateTime={article.publishedAt} className="text-xs text-[var(--text-secondary)]">{date.format(new Date(article.publishedAt))}（北京时间）</time>
        : <span className="text-xs text-[var(--text-secondary)]">发布时间未取得</span>}
    </div>
    <p className="mt-2 break-words text-sm font-medium leading-relaxed">{article.title || '来源未提供原标题'}</p>
    {evidence && <div className="mt-3">
      <div className="text-xs text-[var(--text-secondary)]">{fields[evidence.field]} · {stances[evidence.stance]}{evidence.speaker && `：${evidence.speaker}`}</div>
      <blockquote className="mt-1.5 break-words border-s-2 border-[var(--accent-blue)]/40 ps-3 text-sm leading-relaxed" dir="auto">
        {phrase && offset >= 0 ? <>{quote.slice(0, offset)}<mark className="rounded-sm bg-[var(--accent-blue)]/20 text-[var(--text-primary)]">{phrase}</mark>{quote.slice(offset + phrase.length)}</> : quote}
      </blockquote>
    </div>}
    <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 text-xs text-[var(--text-secondary)]">
      <span>{article.hasBody ? article.bodyTruncated ? '仅比对正文片段' : '含采集正文' : article.hasSummary ? '未取得正文 · 仅比对现有标题或摘要' : '仅有原标题'}</span>
      {article.url && <a className="inline-flex min-h-11 items-center gap-1 whitespace-nowrap text-[var(--accent-blue)] hover:underline" href={article.url} target="_blank" rel="noopener noreferrer">查看原文 <ExternalLink size={13} /></a>}
    </div>
    {!!article.sourceLinks.length && <details className="mt-1 text-xs text-[var(--text-secondary)]"><summary className="cursor-pointer py-2">采集记录中的外链</summary>
      <ul>{article.sourceLinks.map(url => <li key={url}><a className="inline-flex min-h-11 items-center break-all text-[var(--accent-blue)] hover:underline" href={url} target="_blank" rel="noopener noreferrer">{url}</a></li>)}</ul>
    </details>}
  </article>;
}

export function NewsComparisonView({ comparison, initialArticle }: { comparison: Comparison; initialArticle?: string }) {
  const initialClaim = comparison.claims.findIndex(claim => claim.evidence.some(quote => quote.articleId === initialArticle));
  const [claimIndex, setClaimIndex] = useState(Math.max(0, initialClaim));
  const [expanded, setExpanded] = useState(false);
  const [selection, setSelection] = useState(initialArticle && comparison.articles.some(item => item.id === initialArticle)
    ? `source:${initialArticle}` : comparison.claims[0]?.differences.length ? 'diff:0' : '');
  const claim = comparison.claims[claimIndex];
  const articles = new Map(comparison.articles.map(article => [article.id, article]));
  const sourceNumbers = new Map(comparison.articles.map((article, index) => [article.id, index + 1]));
  const label = (id: string) => `${sourceNumbers.get(id)} ${articles.get(id)?.publisher}`;
  const [kind, value] = selection.split(':');
  const index = Number(value);
  const diff = kind === 'diff' ? claim?.differences[index] : undefined;
  const citation = kind === 'citation' ? comparison.citations[index] : undefined;
  const link = kind === 'link' ? comparison.recordedLinks[index] : undefined;
  const selectedEntity = kind === 'entity' ? claim?.entities[index] : undefined;
  const focusedEvidence = selectedEntity ? claim?.evidence[selectedEntity.evidence] : undefined;
  const evidence: { articleId: string; excerpt?: ComparisonClaim['evidence'][number]; phrase?: string }[] = [];
  if (diff && claim) {
    evidence.push({ articleId: claim.evidence[diff.left].articleId, excerpt: claim.evidence[diff.left], phrase: diff.leftPhrase },
      { articleId: claim.evidence[diff.right].articleId, excerpt: claim.evidence[diff.right], phrase: diff.rightPhrase });
  } else if (citation) {
    evidence.push({ articleId: citation.from, excerpt: { ...citation, articleId: citation.from, speaker: null, stance: 'attributes' } }, { articleId: citation.to });
  } else if (link) {
    evidence.push({ articleId: link.from }, { articleId: link.to });
  } else if (focusedEvidence) {
    evidence.push({ articleId: focusedEvidence.articleId, excerpt: focusedEvidence });
  } else {
    for (const excerpt of claim?.evidence ?? []) {
      if (kind !== 'source' || excerpt.articleId === value) evidence.push({ articleId: excerpt.articleId, excerpt });
    }
    if (!evidence.length) for (const article of comparison.articles) {
      if (kind !== 'source' || article.id === value) evidence.push({ articleId: article.id });
    }
  }
  const selectable = new Set(claim?.evidence.map(item => item.articleId));
  const canExpand = !!claim && comparison.articles.some(article => !selectable.has(article.id));

  return <>
    <h2 className="break-words border-b border-[var(--border-subtle)] pb-4 text-xl font-semibold">{comparison.title}</h2>
    <div className="grid gap-6 pt-5 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
      <section aria-label="关系图和来源" className="min-w-0">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-base font-semibold"><Network size={17} className="text-[var(--accent-blue)]" /> 关系图</h3>
          {canExpand && <button type="button" aria-pressed={expanded} className={`${control} hidden sm:inline-flex`} onClick={() => setExpanded(!expanded)}>{expanded ? '收起其他材料' : '展开其他材料'}</button>}
        </div>
        {comparison.claims.length ? <div className="mt-2 grid gap-1" aria-label="可核对说法">
          {comparison.claims.map((item, i) => <button type="button" className={control} key={i} aria-pressed={claimIndex === i}
            onClick={() => { setClaimIndex(i); setSelection(item.differences.length ? 'diff:0' : ''); }}>{item.text}</button>)}
        </div> : <p className="mt-2 text-sm text-[var(--text-secondary)]">现有材料未提取出可核对的具体说法，可直接查看各份原文。</p>}
        <div className="my-3 hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] sm:block">
          <ComparisonGraph comparison={comparison} claim={claim} expanded={expanded} onSelect={setSelection} />
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5" aria-label="材料和实体">
          <button type="button" aria-pressed={!selection} className={control} onClick={() => setSelection('')}>全部摘录</button>
          {comparison.articles.map(article => <button type="button" aria-pressed={selection === `source:${article.id}`} className={control} key={article.id}
            onClick={() => setSelection(`source:${article.id}`)}>{label(article.id)}</button>)}
          {claim?.entities.map((entity, i) => <button type="button" aria-pressed={selection === `entity:${i}`} className={control} key={i}
            onClick={() => setSelection(`entity:${i}`)}>{entity.name}</button>)}
        </div>
        <ul className="mt-3 space-y-1.5">
          {comparison.citations.map((edge, i) => <li key={i}><button type="button" className={control} aria-pressed={selection === `citation:${i}`}
            onClick={() => setSelection(`citation:${i}`)}>{label(edge.from)} {citationLabels[edge.kind]} {label(edge.to)}</button></li>)}
          {comparison.recordedLinks.map((edge, i) => <li key={i}><button type="button" className={control} aria-pressed={selection === `link:${i}`}
            onClick={() => setSelection(`link:${i}`)}>{label(edge.from)} {edge.shared ? '与' : '附链至'} {label(edge.to)}{edge.shared && ' 指向同一原文'}</button></li>)}
        </ul>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">{comparison.citations.length ? '转载不提供独立佐证；看摘录核对引用指向。' : '现有摘录未确认引用或转载关系。'}</p>
        <a href="#comparison-excerpts" className="inline-flex min-h-11 items-center text-sm text-[var(--accent-blue)] hover:underline xl:hidden">查看选中的原文</a>
      </section>
      <section id="comparison-excerpts" aria-label="原文对照" className="min-w-0">
        <h3 className="text-base font-semibold">原文对照</h3>
        {!!claim?.differences.length && <div className="my-2 flex flex-wrap gap-1.5" aria-label="AI 提取的差异">
          {claim.differences.map((item, i) => <button key={i} type="button" className={control} aria-pressed={selection === `diff:${i}`} onClick={() => setSelection(`diff:${i}`)}>
            {differences[item.kind]}{claim.differences.filter(other => other.kind === item.kind).length > 1 ? ` ${i + 1}` : ''}
          </button>)}
        </div>}
        <div aria-live="polite" className="mt-2">
          {diff && <p className="mb-3 rounded-lg border-s-2 border-[var(--accent-blue)] bg-[var(--accent-blue)]/8 p-3 text-sm leading-relaxed"><span className="font-medium">AI 对照：</span>{diff.text}</p>}
          {citation && <p className="mb-3 text-sm text-[var(--text-secondary)]">{label(citation.from)} {citationLabels[citation.kind]} {label(citation.to)} · AI 从摘录提取</p>}
          {link && <p className="mb-3 text-sm text-[var(--text-secondary)]">{link.shared ? '两份材料指向同一个原文地址。' : '采集记录含此外链，引用关系未确认。'}</p>}
          {kind === 'source' && !evidence.some(item => item.excerpt) && <p className="mb-3 text-sm text-[var(--text-secondary)]">此材料没有当前说法的可核对摘录。</p>}
          {claim && !claim.differences.length && <p className="mb-3 text-sm text-[var(--text-secondary)]">现有素材未提取出可核对的差异。</p>}
        </div>
        <div className={cn('grid gap-3', evidence.length > 1 && 'md:grid-cols-2')}>
          {evidence.map((item, i) => {
            const article = articles.get(item.articleId);
            return article && <Excerpt key={`${selection}:${i}`} article={article} evidence={item.excerpt} phrase={item.phrase} />;
          })}
        </div>
      </section>
    </div>
  </>;
}
