// 네이버 뉴스 검색 API (선택). 키가 있을 때만 쓴다.
import { getJson } from '../http.mjs';
import { cleanText, safeUrl } from '../util.mjs';

export const NAVER_NEWS_URL = 'https://openapi.naver.com/v1/search/news.json';

export async function fetchNaverNews(queries, { clientId, clientSecret, timeoutMs = 20000 } = {}) {
  const headers = { 'X-Naver-Client-Id': clientId, 'X-Naver-Client-Secret': clientSecret };
  const items = [];
  for (const q of queries) {
    const url = `${NAVER_NEWS_URL}?${new URLSearchParams({ query: q, display: '30', sort: 'date' })}`;
    const data = await getJson(url, { headers, timeoutMs, retries: 1 });
    for (const it of data?.items || []) {
      const t = Date.parse(it.pubDate);
      items.push({
        title: cleanText(it.title),
        // originallink 는 언론사 원문, link 는 네이버 뉴스 주소
        link: safeUrl(it.originallink) || safeUrl(it.link),
        published: Number.isNaN(t) ? null : new Date(t),
        dateOnly: false,
        description: cleanText(it.description),
        source: '',
        sourceUrl: '',
        categories: [],
      });
    }
  }
  return items.filter((it) => it.title && it.link);
}
