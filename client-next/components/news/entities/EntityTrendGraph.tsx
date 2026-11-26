'use client';

import { useEffect, useRef } from 'react';
import { init, use, type EChartsType } from 'echarts/core';
import { GraphChart, type GraphSeriesOption } from 'echarts/charts';
import { SVGRenderer } from 'echarts/renderers';
import { useTheme } from '@/providers/ThemeProvider';
import type { TrendEdge, TrendNode } from '@/types/entity-trends';

use([GraphChart, SVGRenderer]);

export type TrendSelection = { type: 'node' | 'edge'; id: string };
type GraphLink = NonNullable<GraphSeriesOption['links']>[number] & { selectionId: string };

export function EntityTrendGraph({ nodes, edges, centerId, articleMentions, onSelect }: {
  nodes: TrendNode[];
  edges: TrendEdge[];
  centerId?: string;
  articleMentions?: readonly { id: string }[];
  onSelect: (selection: TrendSelection) => void;
}) {
  const elementRef = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    let chart: EChartsType | undefined;
    function draw(element: HTMLDivElement) {
      if (!element.clientWidth) return;
      if (chart) { chart.resize(); return; }
      const styles = getComputedStyle(element);
      const color = (name: string) => styles.getPropertyValue(name).trim();
      const blue = color('--accent-blue');
      const ink = color('--text-primary');
      const maxCount = Math.max(...nodes.map(node => node.count));
      const linked = new Set(articleMentions?.map(mention => mention.id));
      const links = edges.map((edge): GraphLink => ({
        source: edge.from, target: edge.to, selectionId: edge.id, value: edge.count,
        lineStyle: { type: edge.explicitCount ? 'solid' : 'dashed', color: edge.explicitCount ? blue : color('--text-muted'),
          width: Math.min(1 + Math.log2(edge.count), 4), opacity: edge.explicitCount ? 0.68 : 0.45 },
      }));
      const series: GraphSeriesOption = {
        type: 'graph', animation: false,
        ...(centerId ? { layout: 'none' as const, width: '68%', height: '52%', center: [0, 0], zoom: nodes.length === 2 ? 0.55 : 1 }
          : { layout: 'force' as const, roam: 'move' as const, draggable: true,
            force: { initLayout: 'circular' as const, repulsion: 150, gravity: 0.18, edgeLength: [58, 115], layoutAnimation: false } }),
        data: nodes.map((node, index) => {
          const centered = node.id === centerId;
          const angle = Math.PI / 2 + (index - 1) * 2 * Math.PI / Math.max(1, nodes.length - 1);
          return { id: node.id, name: node.name, value: node.count,
            symbolSize: centered ? 51 : 18 + 22 * Math.sqrt(node.count / maxCount),
            ...(centerId ? { x: centered ? 0 : Math.round(100 * Math.cos(angle)), y: centered ? 0 : Math.round(100 * Math.sin(angle)) } : {}),
            ...(centered ? { itemStyle: { borderWidth: 3 }, label: { position: 'inside' as const, color: ink, fontSize: 13 } }
              : linked.has(node.id) ? { itemStyle: { color: blue } } : {}) };
        }),
        links,
        itemStyle: { color: color('--bg-elevated'), borderColor: blue, borderWidth: 2 },
        label: { show: true, position: 'bottom', color: ink, fontSize: 12, width: 88, overflow: 'truncate' },
        emphasis: { focus: 'adjacency', scale: 1.15 },
      };
      chart = init(element, undefined, { renderer: 'svg' });
      chart.setOption({ series: [series] });
      chart.on('click', event => {
        if (!event.data || typeof event.data !== 'object') return;
        if (event.dataType === 'node' && 'id' in event.data && typeof event.data.id === 'string') onSelect({ type: 'node', id: event.data.id });
        if (event.dataType === 'edge' && 'selectionId' in event.data && typeof event.data.selectionId === 'string') onSelect({ type: 'edge', id: event.data.selectionId });
      });
    }
    const observer = new ResizeObserver(() => draw(element));
    observer.observe(element);
    const frame = requestAnimationFrame(() => draw(element));
    return () => { cancelAnimationFrame(frame); observer.disconnect(); chart?.dispose(); };
  }, [nodes, edges, centerId, articleMentions, onSelect, theme]);

  return <div ref={elementRef} aria-hidden="true" className="h-64 w-full sm:h-[21rem]" />;
}
