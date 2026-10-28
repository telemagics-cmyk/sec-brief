// (선택) 메일 맨 아래 '○○ 관련 뉴스' — Secret MAIL_NEWS_KEYWORD(예: 회사 이름)로 Google 뉴스를 찾아 붙인다.
// 공개 저장소·웹에 남기지 않으려고 수집(이력 저장) 단계가 아니라 메일을 보낼 때 가져오고, 어디에도 저장하지 않는다.
import { secret } from './config.mjs';
import { clusterItems } from './news.mjs';
import { fetchFeed, splitAggregatorTitle } from './sources/rss.mjs';

export const MAIL_NEWS_LIMIT = 5;

export function mailNewsKeyword(env = process.env) {
  return secret('MAIL_NEWS_KEYWORD', env);
}

/** Google 뉴스 검색 RSS. when: 으로 최근 며칠만(최대 10일) 받아 오래된 기사에 밀리지 않게 한다. */
export function mailNewsFeedUrl(keyword, days) {
  const d = Math.min(10, Math.max(1, Math.ceil(days)));
  return `https://news.google.com/rss/search?q=${encodeURIComponent(`${keyword} when:${d}d`)}&hl=ko&gl=KR&ceid=KR:ko`;
}

/** 사람이 여는 Google 뉴스 검색 화면('더 보기') */
export function mailNewsSearchUrl(keyword) {
  return `https://news.google.com/search?q=${encodeURIComponent(keyword)}&hl=ko&gl=KR&ceid=KR:ko`;
}

/**
 * 지난 브리핑 이후(브리핑의 수집 끝 시각까지) 키워드 기사를 같은 사건끼리 묶어, 여러 매체가 다룬 순·최근 순으로.
 * 실패해도 메일은 보낸다(error 를 채워 '가져오지 못함'을 보이게).
 * @returns {Promise<null | {keyword:string, items:{title:string,url:string,outlet:string,outlets:number,published:string}[], total:number, error?:string}>}
 *   키워드가 없으면 null
 */
export async function fetchMailNews(brief, { env = process.env, now = new Date(), limit = MAIL_NEWS_LIMIT, getFeed = fetchFeed } = {}) {
  const keyword = mailNewsKeyword(env);
  if (!keyword || !brief) return null;
  const to = Date.parse(brief.window?.to || '') || now.getTime();
  // 지난 브리핑의 수집 끝 시각부터. 모르면(옛 브리핑) 하루 전부터.
  const from = Date.parse(brief.window?.since_at || '') || to - 24 * 3600e3;
  let raw;
  try {
    raw = await getFeed({ url: mailNewsFeedUrl(keyword, (now.getTime() - from) / 86400e3) });
  } catch {
    // 오류 문구에 검색 주소(키워드)가 섞여 공개 Actions 기록에 남지 않게 내용은 버린다
    return { keyword, items: [], total: 0, error: '기사를 가져오지 못했습니다' };
  }
  const seen = new Set();
  const items = [];
  for (const it of raw || []) {
    const t = it.published instanceof Date ? it.published.getTime() : NaN;
    if (!(t >= from && t <= to) || seen.has(it.link)) continue;
    seen.add(it.link);
    const s = splitAggregatorTitle(it.title, it.source);
    items.push({ title: s.title, link: it.link, outlet: s.outlet || it.source || '', published: it.published, description: '' });
  }
  // 한 회사 기사는 제목 첫 낱말(회사 이름)이 다 같으므로 주어로는 합치지 않는다
  const groups = clusterItems(items, { foldSubjects: false }).map((g) => {
    const latest = [...g].sort((a, b) => b.published - a.published)[0];
    return { rep: latest, outlets: new Set(g.map((x) => x.outlet || x.link)).size, latest: latest.published.getTime() };
  });
  groups.sort((a, b) => b.outlets - a.outlets || b.latest - a.latest);
  return {
    keyword,
    total: groups.length,
    items: groups.slice(0, limit).map((g) => ({
      title: g.rep.title,
      url: g.rep.link,
      outlet: g.rep.outlet,
      outlets: g.outlets,
      published: g.rep.published.toISOString(),
    })),
  };
}
