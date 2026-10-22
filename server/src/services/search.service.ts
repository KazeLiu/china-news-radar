import { Injectable } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';
import type { SearchResult } from '../types';
import { findOldestDateInText, parseLooseDate, extractDateFromUrl } from '../utils/date-parser';
import { withRetry } from '../utils/retry';
import { requestPublic, SourceFetchError } from '../news/public-network';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
];

class RateLimiter {
  private lastRequestTime = 0;
  constructor(private minInterval: number = 5000) {}

  async wait(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestTime;
    if (elapsed < this.minInterval) {
      await new Promise(resolve => setTimeout(resolve, this.minInterval - elapsed));
    }
    this.lastRequestTime = Date.now();
  }
}

@Injectable()
export class SearchService {
  private readonly bingLimiter = new RateLimiter(5000);
  private readonly hackernewsLimiter = new RateLimiter(1000);

  private getRandomUserAgent(): string {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  }

  async searchBing(query: string, strict = false, network?: { useProxy?: boolean }): Promise<SearchResult[]> {
    await this.bingLimiter.wait();

    try {
      const response = await withRetry(
        () => network ? this.sourceRequest(`https://www.bing.com/search?${new URLSearchParams({ q: query, count: '20' })}`, network, false) : axios.get('https://www.bing.com/search', {
          params: { q: query, count: 20 },
          headers: {
            'User-Agent': this.getRandomUserAgent(),
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br',
          },
          timeout: 15000,
        }),
        { retries: 2, delayMs: 800, label: `Bing "${query}"`, isRetryable: network ? error => error instanceof SourceFetchError && (!error.status || error.status >= 500 || error.status === 429) : undefined },
      );

      const $ = cheerio.load(response.data);
      const results: SearchResult[] = [];

      $('li.b_algo').each((_, element) => {
        const titleElement = $(element).find('h2 a');
        const title = titleElement.text().trim();
        const url = titleElement.attr('href');
        const snippet = $(element).find('.b_caption p').text().trim();

        if (title && url && url.startsWith('http')) {
          // Bing puts dates in several places — try them in order:
          //   1. .news_dt cell (news vertical results)
          //   2. ANY date pattern in the full snippet (returns oldest if multiple)
          //      — handles "2025.07.05 20:06 · 来自北京 · 39.8万阅读" mid-snippet patterns
          //   3. Date-like path segment in the URL (/2026/04/15/)
          const newsDate = $(element).find('.news_dt').text().trim();
          const publishedAt =
            parseLooseDate(newsDate) ||
            findOldestDateInText(snippet) ||
            extractDateFromUrl(url);

          results.push({ title, content: snippet, url, source: 'bing', publishedAt });
        }
      });

      console.log(`Bing search for "${query}": found ${results.length} results`);
      return results;
    } catch (error) {
      if (strict) throw error instanceof SourceFetchError ? error : new Error('Bing 来源连接或解析失败');
      console.error('Bing search error:', error);
      return [];
    }
  }

  async searchHackerNews(query: string, strict = false, network?: { useProxy?: boolean }): Promise<SearchResult[]> {
    await this.hackernewsLimiter.wait();

    try {
      const oneDayAgo = Math.floor((Date.now() - 24 * 3600 * 1000) / 1000);
      const response = await withRetry(
        () => network ? this.sourceRequest(`https://hn.algolia.com/api/v1/search?${new URLSearchParams({ query, tags: 'story', hitsPerPage: '20', numericFilters: `created_at_i>${oneDayAgo}` })}`, network, true) : axios.get<any>('https://hn.algolia.com/api/v1/search', {
          params: {
            query,
            tags: 'story',
            hitsPerPage: 20,
            numericFilters: `created_at_i>${oneDayAgo}`,
          },
          timeout: 15000,
        }),
        { retries: 2, delayMs: 500, label: `HN "${query}"`, isRetryable: network ? error => error instanceof SourceFetchError && (!error.status || error.status >= 500 || error.status === 429) : undefined },
      );

      const results: SearchResult[] = response.data.hits
        .filter((hit: any) => hit.url || hit.story_text)
        .map((hit: any) => ({
          title: hit.title,
          content: hit.story_text || hit.title,
          url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
          source: 'hackernews' as const,
          sourceId: hit.objectID,
          publishedAt: new Date(hit.created_at),
          score: hit.points,
          commentCount: hit.num_comments,
          author: { name: hit.author, username: hit.author },
        }));

      console.log(`Hacker News search for "${query}": found ${results.length} results`);
      return results;
    } catch (error) {
      if (strict) throw error instanceof SourceFetchError ? error : new Error('Hacker News 来源连接或解析失败');
      console.error('Hacker News search error:', error);
      return [];
    }
  }

  private async sourceRequest(url: string, network: { useProxy?: boolean }, json: boolean): Promise<{ data: any }> {
    const response = await requestPublic(url, { ...network, headers: { 'User-Agent': this.getRandomUserAgent(), Accept: json ? 'application/json' : 'text/html', 'Accept-Language': 'en-US,en;q=0.5' } });
    if (response.status < 200 || response.status >= 300) throw new SourceFetchError('http-error', `搜索来源返回 HTTP ${response.status}`, response.status);
    const body = response.body.toString('utf8');
    if (!json) return { data: body };
    try { return { data: JSON.parse(body) }; }
    catch { throw new SourceFetchError('invalid-structure', '搜索来源未返回有效 JSON'); }
  }

  deduplicateResults(allResults: SearchResult[]): SearchResult[] {
    const uniqueUrls = new Set<string>();
    return allResults.filter(item => {
      const normalizedUrl = item.url.replace(/\/$/, '').replace(/^https?:\/\/www\./, 'https://');
      if (uniqueUrls.has(normalizedUrl)) return false;
      uniqueUrls.add(normalizedUrl);
      return true;
    });
  }
}
