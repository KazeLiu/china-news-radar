import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { calcHotScore } from '../utils/sortHotspots';

// Importance is an enum stored as text, not in lexical rank order.
export async function importancePage(db: PrismaService, where: Prisma.HotspotWhereInput, skip: number, take: number, order: 'asc' | 'desc') {
  const known = ['urgent', 'high', 'medium', 'low'];
  const groups: Prisma.HotspotWhereInput[] = [...known.map(importance => ({ importance })), { importance: { notIn: known } }];
  if (order === 'asc') groups.reverse();
  const ids: string[] = [];
  for (const group of groups) {
    const scope = { AND: [where, group] };
    if (skip) {
      const count = await db.hotspot.count({ where: scope });
      if (skip >= count) { skip -= count; continue; }
    }
    const rows = await db.hotspot.findMany({ where: scope, orderBy: [{ createdAt: order }, { publishedAt: 'desc' }, { id: 'asc' }], skip, take: take - ids.length, select: { id: true } });
    ids.push(...rows.map(row => row.id));
    skip = 0;
    if (ids.length === take) break;
  }
  return ids;
}

// Keep only the requested prefix, never bodies or all matching records. The heap
// root is the worst retained candidate, so each row costs O(log(page end)).
export async function hotPage(db: PrismaService, where: Prisma.HotspotWhereInput, skip: number, take: number, order: 'asc' | 'desc') {
  const hasMetrics = await db.hotspot.findFirst({ where: { AND: [where, { OR: [{ likeCount: { not: 0 } }, { retweetCount: { not: 0 } }, { viewCount: { gt: 1 } }] }] }, select: { id: true } });
  if (!hasMetrics) return (await db.hotspot.findMany({ where, orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }], skip, take, select: { id: true } })).map(row => row.id);
  type Candidate = { id: string; score: number; publishedAt: number; createdAt: number };
  const compare = (a: Candidate, b: Candidate) => (order === 'desc' ? b.score - a.score : a.score - b.score)
    || b.publishedAt - a.publishedAt || b.createdAt - a.createdAt || a.id.localeCompare(b.id);
  const heap: Candidate[] = [];
  const capacity = skip + take;
  const retain = (item: Candidate) => {
    if (heap.length < capacity) {
      heap.push(item);
      let index = heap.length - 1;
      while (index > 0) {
        const parent = (index - 1) >> 1;
        if (compare(heap[index], heap[parent]) <= 0) break;
        [heap[index], heap[parent]] = [heap[parent], heap[index]]; index = parent;
      }
      return;
    }
    if (compare(item, heap[0]) >= 0) return;
    heap[0] = item;
    let index = 0;
    while (index * 2 + 1 < heap.length) {
      let child = index * 2 + 1;
      if (child + 1 < heap.length && compare(heap[child + 1], heap[child]) > 0) child++;
      if (compare(heap[child], heap[index]) <= 0) break;
      [heap[index], heap[child]] = [heap[child], heap[index]]; index = child;
    }
  };
  let cursor: string | undefined;
  while (true) {
    const rows = await db.hotspot.findMany({ where: { AND: [where, ...(cursor ? [{ id: { gt: cursor } }] : [])] }, orderBy: { id: 'asc' }, take: 256,
      select: { id: true, likeCount: true, retweetCount: true, viewCount: true, importance: true, relevance: true, publishedAt: true, createdAt: true } });
    for (const row of rows) retain({ id: row.id, score: calcHotScore(row), publishedAt: row.publishedAt?.getTime() ?? 0, createdAt: row.createdAt.getTime() });
    if (rows.length < 256) break;
    cursor = rows[rows.length - 1].id;
  }
  return heap.sort(compare).slice(skip, skip + take).map(row => row.id);
}
