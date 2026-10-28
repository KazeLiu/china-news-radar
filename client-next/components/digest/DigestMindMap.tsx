'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { init, use } from 'echarts/core';
import { TreeChart, type TreeSeriesOption } from 'echarts/charts';
import { TooltipComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import { cn } from '../../lib/utils';
import type { DigestData } from '../../types';

use([TreeChart, TooltipComponent, SVGRenderer]);

interface MapItem {
  title: string;
  titleGenerated?: boolean;
  url?: string;
}

interface MapGroup {
  key: string;
  title: string;
  items: MapItem[];
}

type MapNode = NonNullable<TreeSeriesOption['data']>[number] & {
  groupKey?: string;
  url?: string;
};

export function DigestMindMap({ date, data }: { date: string; data: DigestData }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartId = useId();
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const groups = useMemo<MapGroup[]>(() => [
    { key: 'highlights', title: '本期重点', items: data.highlights ?? [] },
    ...(data.sections ?? []).map(section => ({ ...section, key: `topic:${section.key}` })),
    { key: 'domestic', title: '国内动态', items: data.domestic ?? [] },
    { key: 'international', title: '国外动态', items: data.international ?? [] },
    { key: 'modelIntel', title: '模型情报', items: (data.modelIntel ?? []).map(item => ({ title: `${item.model} · ${item.change}` })) },
    { key: 'products', title: 'AI 产品动态', items: data.products ?? [] },
    { key: 'community', title: '社区热议', items: data.community ?? [] },
    { key: 'papers', title: '论文 & 技术趋势', items: data.papers ?? [] },
  ].filter(group => group.items.length > 0), [data]);
  const expanded = groups.find(group => group.key === expandedGroup);
  const height = Math.max(340, (groups.length + (expanded?.items.length ?? 1) - 1) * 36 + 64);

  useEffect(() => {
    if (!containerRef.current || groups.length === 0) return;
    const container = containerRef.current;
    const chart = init(container, undefined, { renderer: 'svg' });
    const render = () => {
      const styles = getComputedStyle(container);
      const color = (name: string) => styles.getPropertyValue(name).trim();
      const accent = color('--accent-blue');
      const text = color('--text-primary');
      const series: TreeSeriesOption = {
        type: 'tree',
        orient: 'LR',
        top: 32,
        bottom: 32,
        left: 112,
        right: 240,
        roam: 'move',
        expandAndCollapse: false,
        initialTreeDepth: -1,
        symbolSize: 12,
        itemStyle: { color: color('--card-bg'), borderColor: accent, borderWidth: 2 },
        lineStyle: { color: color('--card-border-hover'), width: 1.5, curveness: 0.5 },
        label: { position: 'right', align: 'left', fontSize: 13, color: text, width: 220, overflow: 'truncate' },
        emphasis: { focus: 'ancestor' },
        data: [{
          id: 'digest-root',
          name: `${date}\n涉华日报`,
          symbolSize: 20,
          itemStyle: { color: accent },
          label: { position: 'left', align: 'right', width: 96, fontWeight: 'bold', lineHeight: 22 },
          children: groups.map(group => ({
            name: `${group.title} · ${group.items.length}`,
            groupKey: group.key,
            collapsed: group.key !== expandedGroup,
            label: { position: group.key === expandedGroup ? 'left' : 'right', align: group.key === expandedGroup ? 'right' : 'left', width: 130, fontWeight: 'bold' },
            children: group.items.map(item => ({
              name: `${item.title}${item.titleGenerated ? '（AI生成）' : ''}`,
              url: item.url,
              symbolSize: 8,
              itemStyle: { color: accent, borderWidth: 0 },
            })),
          })),
        }],
      };
      chart.setOption({
        animation: false,
        tooltip: {
          trigger: 'item',
          renderMode: 'richText',
          confine: true,
          backgroundColor: color('--card-bg'),
          borderColor: color('--card-border'),
          textStyle: { color: text, width: 260, overflow: 'break' },
          formatter: (params: unknown) => ((params as { data: MapNode }).data.name ?? ''),
        },
        series: [series],
      }, true);
    };
    render();
    chart.on('click', params => {
      const node = params.data as MapNode;
      const groupKey = node.groupKey;
      if (groupKey) setExpandedGroup(current => current === groupKey ? null : groupKey);
      else if (node.url) window.open(node.url, '_blank', 'noopener,noreferrer');
      else if (node.id === 'digest-root') setExpandedGroup(null);
    });
    const resizeObserver = new ResizeObserver(() => chart.resize());
    resizeObserver.observe(container);
    const themeObserver = new MutationObserver(render);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      resizeObserver.disconnect();
      themeObserver.disconnect();
      chart.dispose();
    };
  }, [date, groups, expandedGroup, height]);

  if (groups.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)]">
      <div className="flex flex-wrap gap-2 border-b border-[var(--card-border)] p-3" role="group" aria-label="展开思维导图主题">
        <button type="button" aria-controls={chartId} aria-pressed={!expandedGroup} onClick={() => setExpandedGroup(null)}
          className={cn('min-h-11 rounded-xl px-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-[var(--accent-blue)]', !expandedGroup ? 'bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]')}>
          总览
        </button>
        {groups.map(group => (
          <button key={group.key} type="button" aria-controls={chartId} aria-expanded={expandedGroup === group.key}
            onClick={() => setExpandedGroup(current => current === group.key ? null : group.key)}
            className={cn('min-h-11 rounded-xl px-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-[var(--accent-blue)]', expandedGroup === group.key ? 'bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]')}>
            {group.title}<span className="ml-1.5 text-xs">{group.items.length}</span>
          </button>
        ))}
      </div>
      <div id={chartId} className="max-h-[560px] overflow-auto" tabIndex={0} role="region" aria-label="日报思维导图，可横向滚动；完整报道见下文">
        <div ref={containerRef} className="w-full min-w-[680px]" style={{ height }} aria-hidden="true" />
      </div>
      <p className="border-t border-[var(--card-border)] px-4 py-3 text-xs leading-relaxed text-[var(--text-secondary)]">
        选择主题展开报道，点击报道标题打开原文。完整摘要见下文。
      </p>
    </div>
  );
}
