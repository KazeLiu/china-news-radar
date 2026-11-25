'use client';

import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { init, use, type EChartsType } from 'echarts/core';
import { GraphChart, type GraphSeriesOption } from 'echarts/charts';
import { SVGRenderer } from 'echarts/renderers';
import { useTheme } from '@/providers/ThemeProvider';
import type { Comparison, ComparisonClaim } from '@/types/news-comparison';

use([GraphChart, SVGRenderer]);

export const citationLabels = { cites: '引用', reprints: '转载' };

export function ComparisonGraph({ comparison, claim, expanded, onSelect }: {
  comparison: Comparison;
  claim?: ComparisonClaim;
  expanded: boolean;
  onSelect: Dispatch<SetStateAction<string>>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let chart: EChartsType | undefined;
    function draw(element: HTMLDivElement) {
      if (!element.clientWidth) return;
      if (chart) { chart.resize(); return; }
      const styles = getComputedStyle(document.documentElement);
      const color = (variable: string) => styles.getPropertyValue(variable).trim();
      const ink = color('--text-primary');
      const secondary = color('--text-secondary');
      const blue = color('--accent-blue');
      const surface = color('--bg-surface');
      const articles = comparison.articles;
      const evidenceIds = new Set(claim?.evidence.map(item => item.articleId));
      const nodes: Extract<NonNullable<GraphSeriesOption['data']>[number], { id?: string }>[] = [{ id: '@root', name: claim ? '选中说法' : '同一事件', symbol: 'roundRect',
        symbolSize: [90, 36], itemStyle: { color: surface, borderColor: blue, borderWidth: 2 },
        label: { position: 'inside', color: ink, fontWeight: 'bold' } }];
      const links: (NonNullable<GraphSeriesOption['links']>[number] & { selection: string })[] = [];
      articles.forEach((article, index) => {
        if (claim && !expanded && !evidenceIds.has(article.id)) return;
        const id = `source:${article.id}`;
        nodes.push({ id, name: `${index + 1} ${article.publisher}`, symbol: 'roundRect', symbolSize: [32, 25],
          itemStyle: { color: surface, borderColor: blue, borderWidth: 1.5 } });
        if (!claim || evidenceIds.has(article.id)) links.push({ source: id, target: '@root', selection: id,
          label: { formatter: claim ? '摘录' : '入选材料' } });
        else links.push({ source: '@root', target: id, selection: id, label: { formatter: '入选材料' }, lineStyle: { type: 'dotted', opacity: 0.45 } });
      });
      const names = new Set<string>();
      claim?.entities.forEach((entity, index) => {
        if (names.has(entity.name)) return;
        names.add(entity.name);
        const id = `entity:${index}`;
        nodes.push({ id, name: entity.name, symbolSize: 19, itemStyle: { color: surface, borderColor: secondary, borderWidth: 1.5 } });
        links.push({ source: '@root', target: id, selection: id, label: { formatter: '涉及' } });
      });
      const hasNode = (id: string) => nodes.some(node => node.id === id);
      comparison.citations.forEach((edge, index) => {
        const source = `source:${edge.from}`; const target = `source:${edge.to}`;
        if (hasNode(source) && hasNode(target)) links.push({ source, target, selection: `citation:${index}`, label: { formatter: citationLabels[edge.kind] },
          lineStyle: { curveness: 0.19, color: blue, type: 'dashed' } });
      });
      comparison.recordedLinks.forEach((edge, index) => {
        const source = `source:${edge.from}`; const target = `source:${edge.to}`;
        if (hasNode(source) && hasNode(target)) links.push({ source, target, selection: `link:${index}`, label: { formatter: edge.shared ? '同一原文' : '附链' }, ...(edge.shared ? { symbol: ['none', 'none'] } : {}),
          lineStyle: { curveness: 0.19, type: 'dotted' } });
      });
      chart = init(element, undefined, { renderer: 'svg' });
      const series: GraphSeriesOption = { type: 'graph', layout: 'force', roam: 'move', draggable: true, animation: false,
        force: { repulsion: 230, gravity: 0.13, edgeLength: [72, 115], layoutAnimation: false },
        data: nodes, links, edgeSymbol: ['none', 'arrow'], edgeSymbolSize: [0, 6],
        label: { show: true, position: 'bottom', color: ink, fontSize: 12, width: 102, overflow: 'truncate' },
        edgeLabel: { show: true, color: secondary, fontSize: 11, backgroundColor: surface, padding: [2, 3], borderRadius: 2 },
        lineStyle: { color: secondary, opacity: 0.75, width: 1.2 }, emphasis: { focus: 'adjacency' },
      };
      chart.setOption({ series: [series] });
      chart.on('click', event => {
        if (!event.data || typeof event.data !== 'object') return;
        if (event.dataType === 'node' && 'id' in event.data && typeof event.data.id === 'string') onSelect(event.data.id === '@root' ? '' : event.data.id);
        if (event.dataType === 'edge' && 'selection' in event.data && typeof event.data.selection === 'string') onSelect(event.data.selection);
      });
    }
    const observer = new ResizeObserver(() => draw(element));
    observer.observe(element);
    const frame = requestAnimationFrame(() => draw(element));
    return () => { cancelAnimationFrame(frame); observer.disconnect(); chart?.dispose(); };
  }, [comparison, claim, expanded, theme, onSelect]);

  return <div ref={ref} aria-hidden="true" className="h-[23rem] w-full" />;
}
