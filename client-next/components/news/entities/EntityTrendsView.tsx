'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, LocateFixed } from 'lucide-react';
import { ProgressLink } from '@/components/layout/ProgressLink';
import { cn } from '@/lib/utils';
import type { EntityExcerpt, EntitySample, EntityTrends } from '@/types/entity-trends';
import { EntityTrendGraph, type TrendSelection } from './EntityTrendGraph';

const fields = { title: '原标题', summary: '原摘要', body: '原正文' };
const dateFormat = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', timeZone: 'Asia/Shanghai' });
const control = 'min-w-0 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline-2 focus-visible:outline-[var(--accent-blue)]';
const active = 'bg-[var(--bg-elevated)] font-semibold text-[var(--accent-blue)]';

function Excerpt({ evidence, label }: { evidence: EntityExcerpt; label?: string }) {
  return <div className="min-w-0 border-l-2 border-[var(--border-subtle)] pl-3">
    <p className="text-xs text-[var(--text-secondary)]">{label && `${label} · `}{fields[evidence.field]}</p>
    <blockquote dir="auto" className="mt-1 break-words text-sm leading-relaxed">{evidence.excerpt}</blockquote>
  </div>;
}

function EvidenceReport({ sample, names, current, edge }: { sample: EntitySample; names: ReadonlyMap<string, string>; current: boolean; edge: boolean }) {
  const { report, statements, excerpts } = sample;
  return <li className="py-3.5">
    <p className="mb-1 flex flex-wrap gap-x-2 text-xs text-[var(--text-secondary)]">
      <span className="font-medium">{report.publisher}</span><time dateTime={report.date}>{dateFormat.format(new Date(report.date))}</time>
      {edge && <span>{statements?.length ? '有明确陈述' : '共同提及'}</span>}
      {current && <span className="text-[var(--accent-blue)]">当前报道</span>}
      {report.originalUrl && <a href={report.originalUrl} target="_blank" rel="noopener noreferrer" className="text-[var(--accent-blue)] hover:underline">媒体原文<ArrowUpRight className="ml-0.5 inline size-3" aria-hidden="true" /></a>}
    </p>
    <ProgressLink href={`/articles/${encodeURIComponent(report.id)}`} prefetch={false} className="break-words text-sm font-medium hover:text-[var(--accent-blue)] hover:underline">
      {report.title}
    </ProgressLink>
    <div className="mt-2 space-y-2">
      {statements?.length ? statements.map((statement, index) => <Excerpt key={index} evidence={statement}
        label={`${names.get(statement.from)} → ${names.get(statement.to)}：${statement.label}`} />)
        : excerpts.map(item => <Excerpt key={`${item.field}:${item.excerpt}`} evidence={item} />)}
    </div>
  </li>;
}

export function EntityTrendsView({ trends }: { trends: EntityTrends }) {
  const { nodes, edges, china, article, articleRequested } = trends;
  const linkedIds = new Set(article?.mentions.map(mention => mention.id));
  const first = article ? nodes.find(node => linkedIds.has(node.id)) : nodes[0];
  const defaultSelection = first && { type: 'node' as const, id: first.id };
  const [chinaFocused, setChinaFocused] = useState(false);
  const focus = chinaFocused ? china : null;
  const chinaNodes = useMemo(() => {
    if (!china) return [];
    const neighbors = new Set(china.edges.map(edge => edge.from === china.node.id ? edge.to : edge.from));
    return [china.node, ...nodes.filter(node => neighbors.has(node.id))];
  }, [china, nodes]);
  const graphNodes = focus ? chinaNodes : nodes;
  const graphEdges = focus ? focus.edges : edges;
  const names = new Map(graphNodes.map(node => [node.id, node.name]));
  const rankedIds = new Set(nodes.map(node => node.id));
  const articleMentionsChina = !!china && linkedIds.has(china.node.id);
  const [selection, setSelection] = useState<TrendSelection | undefined>(defaultSelection);
  const evidencePanel = useRef<HTMLElement>(null);
  const selectFromGraph = useCallback((next: TrendSelection) => {
    setSelection(next);
    if (window.matchMedia('(width < 80rem)').matches) evidencePanel.current?.scrollIntoView({ block: 'start' });
  }, []);
  function selectEntity(id: string) {
    setChinaFocused(china?.node.id === id);
    selectFromGraph({ type: 'node', id });
  }
  const node = selection?.type === 'node' ? graphNodes.find(item => item.id === selection.id) : undefined;
  const edge = selection?.type === 'edge' ? graphEdges.find(item => item.id === selection.id) : undefined;
  const selected = node ?? edge;
  const connections = node ? graphEdges.filter(item => item.from === node.id || item.to === node.id) : [];
  const edgeTitle = (edge: typeof edges[number]) => `${names.get(edge.from)} / ${names.get(edge.to)}`;

  return <>
    {article && <section aria-label="当前报道" className="mb-5 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] px-4 py-3.5">
      <div className="flex items-start gap-2.5 text-sm"><LocateFixed className="mt-0.5 size-4 shrink-0 text-[var(--accent-blue)]" aria-hidden="true" />
        <ProgressLink href={`/articles/${encodeURIComponent(article.id)}`} prefetch={false} className="min-w-0 break-words font-semibold hover:text-[var(--accent-blue)] hover:underline">{article.title}</ProgressLink>
      </div>
      {article.mentions.length > 0 ? <details className="ml-6 mt-2 text-sm" open={first ? undefined : true}>
        <summary className="cursor-pointer py-1 text-[var(--accent-blue)]">查看这篇报道提到的 {article.mentions.length} 个实体{!first && !articleMentionsChina && '（均未进入本期前 10）'}</summary>
        <ul className="mt-2 space-y-2.5">{article.mentions.map(mention => <li key={mention.id}>
          {rankedIds.has(mention.id) || china?.node.id === mention.id ? <button type="button" aria-controls="trend-evidence" className="mb-1 font-medium text-[var(--accent-blue)] hover:underline" onClick={() => selectEntity(mention.id)}>{mention.name}</button>
            : <p className="mb-1 font-medium">{mention.name}</p>}
          <Excerpt evidence={mention} />
        </li>)}</ul>
      </details> : <p className="ml-6 mt-2 text-sm text-[var(--text-secondary)]">{article.analyzed ? '原始材料中没有可核对的具名实体。' : '这篇报道暂无实体证据，仍可浏览同一时段的榜单。'}</p>}
    </section>}
    {articleRequested && !article && <p className="mb-4 text-sm text-[var(--text-secondary)]">这篇报道已不可查看，下面显示当前时段的榜单。</p>}

    {nodes.length || china ? <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <section id="trend-association" aria-label="实体关联图与榜单" className="min-w-0 self-start rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)]">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-3">
          <h2 className="text-base font-semibold">{focus ? '中国关联图' : '实体关联图'}</h2>
          {china && <button type="button" aria-controls="trend-association trend-evidence"
            onClick={() => {
              setChinaFocused(!focus);
              setSelection(focus ? defaultSelection : { type: 'node', id: china.node.id });
            }} className={cn(control, 'min-h-11 shrink-0 whitespace-nowrap border border-[var(--input-border)] tabular-nums', !!focus && active)}>
            {focus ? '返回概览' : `中国 · ${china.node.count} 篇`}
          </button>}
          <div className="ml-auto flex gap-3 whitespace-nowrap text-xs text-[var(--text-secondary)]">
            <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-[var(--text-muted)]" />共同提及</span>
            <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-[var(--accent-blue)]" />有明确陈述</span>
          </div>
        </div>
        {graphNodes.length ? <EntityTrendGraph nodes={graphNodes} edges={graphEdges} centerId={focus?.node.id} articleMentions={article?.mentions} onSelect={selectFromGraph} />
          : <p className="px-4 py-8 text-sm text-[var(--text-secondary)]">本期暂无其他上榜实体。</p>}
        {focus && !graphEdges.length && <p className="px-4 pb-4 text-sm text-[var(--text-secondary)]">本期榜单中没有与中国共同提及的实体。</p>}
        {nodes.length > 0 && <ol aria-label="高频实体排名" className="grid grid-cols-2 gap-1 border-t border-[var(--border-subtle)] p-2">
          {nodes.map((item, index) => <li key={item.id} className="min-w-0">
            <button type="button" aria-controls="trend-evidence" aria-pressed={node?.id === item.id} onClick={() => selectEntity(item.id)} className={cn(control, 'flex w-full items-center gap-2', node?.id === item.id && active)}>
              <span className="w-5 shrink-0 text-right tabular-nums text-[var(--text-secondary)]">{index + 1}</span>
              <span className="min-w-0 flex-1 truncate" title={item.name}>{item.name}</span>
              {linkedIds.has(item.id) && <LocateFixed size={13} className="shrink-0 text-[var(--accent-blue)]" aria-label="当前报道提及" />}
              <span className="shrink-0 text-xs tabular-nums text-[var(--text-secondary)]">{item.count} 篇</span>
            </button>
          </li>)}
        </ol>}
      </section>

      <section id="trend-evidence" ref={evidencePanel} aria-label="原文依据" className="min-w-0 scroll-mt-4 self-start rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] px-4 py-4 sm:px-5">
        <div aria-live="polite">
          <h2 className="break-words font-semibold">{node?.name ?? (edge ? edgeTitle(edge) : '原文依据')}</h2>
          {selected && <p className="mt-1 text-xs text-[var(--text-secondary)]">{edge ? `${edge.count} 篇共同提及 · ${edge.explicitCount} 篇有明确陈述` : `${selected.count} 篇报道提及`}{selected.samples.length < selected.count && ` · 展示 ${selected.samples.length} 篇`}</p>}
        </div>
        {!!connections.length && <div aria-label="相关实体" className="mt-2 flex flex-wrap gap-1.5">
          {connections.map(item => <button key={item.id} type="button" onClick={() => setSelection({ type: 'edge', id: item.id })}
            className="rounded-md border border-[var(--input-border)] px-2 py-1.5 text-xs hover:bg-[var(--bg-hover)]">
            {names.get(item.from === node?.id ? item.to : item.from)} · {item.count} 篇
          </button>)}
        </div>}
        {edge && <div className="mt-2 flex flex-wrap gap-1.5">{[edge.from, edge.to].map(id => <button key={id} type="button" onClick={() => setSelection({ type: 'node', id })}
          className="rounded-md border border-[var(--input-border)] px-2 py-1.5 text-xs hover:bg-[var(--bg-hover)]">{names.get(id)}</button>)}</div>}
        {selected ? <ul className="mt-3 divide-y divide-[var(--border-subtle)] border-t border-[var(--border-subtle)]">
          {selected.samples.map(sample => <EvidenceReport key={sample.report.id} sample={sample} names={names} current={article?.id === sample.report.id} edge={!!edge} />)}
        </ul> : <p className="mt-2 text-sm text-[var(--text-secondary)]">选择榜单实体或图中的连线，查看报道摘录。</p>}
      </section>
    </div> : <p className="border-y border-[var(--border-subtle)] py-8 text-sm text-[var(--text-secondary)]">
      {trends.coverage.total === 0 ? '这段时间没有公开报道。' : '这段时间还没有可上榜的实体。旧分析不会自动补提取，榜单会随新的后台分析更新。'}
    </p>}
  </>;
}
