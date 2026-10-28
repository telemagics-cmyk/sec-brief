// 하루치 브리핑 만들기: 수집(동시에) → 선별 → (선택) Claude 요약 → 저장.
// 출처 하나가 실패해도 나머지로 브리핑을 만들고, 실패한 출처는 브리핑 맨 아래 '수집 상태'에 남긴다.
import { setTimeout as sleep } from 'node:timers/promises';
import { BRIEF_VERSION, renderMarkdown, ruleOverview } from './brief.mjs';
import { secret } from './config.mjs';
import { selectNews } from './news.mjs';
import { fetchEpss } from './sources/epss.mjs';
import { fetchKev } from './sources/kev.mjs';
import { fetchNaverNews } from './sources/naver.mjs';
import { fetchNvdKevAdded, fetchNvdPublished } from './sources/nvd.mjs';
import { fetchFeed, splitAggregatorTitle } from './sources/rss.mjs';
import { listBriefDates, loadBrief, recentHistory, saveBrief } from './store.mjs';
import { applySummary, callClaude } from './summarize.mjs';
import { addDays, canonicalUrl, kstDate, kstIso, shortHash } from './util.mjs';
import { newsTextOf, selectCritical, selectExploited } from './vulns.mjs';

function countOf(r) {
  if (!r) return 0;
  if (Array.isArray(r)) return r.length;
  if (r instanceof Map) return r.size;
  if (Array.isArray(r.items)) return r.items.length;
  if (Array.isArray(r.rows)) return r.rows.length;
  return 0;
}

export function selectAdvisories(results, { date, days = 2, seen = new Set(), limit = 10 }) {
  const from = addDays(date, -(Math.max(1, days) - 1));
  const out = [];
  const keys = new Set();
  for (const { feed, items } of results) {
    for (const it of items || []) {
      if (!it.published) continue;
      const d = kstDate(it.published);
      if (d < from || d > date) continue;
      const key = canonicalUrl(it.link);
      if (seen.has(key) || keys.has(key)) continue;
      keys.add(key);
      const item = { id: `a-${shortHash(key, 8)}`, source: feed.name, title: it.title, url: it.link, date: d };
      // 사이버위기 경보 단계 변경은 맨 앞에 강조한다
      if (feed.id === 'kisa-alert' || /경보\s*단계|경보.*(상향|하향|발령|해제)/.test(it.title)) item.alert = true;
      out.push(item);
    }
  }
  out.sort((a, b) => Number(Boolean(b.alert)) - Number(Boolean(a.alert)) || b.date.localeCompare(a.date));
  return out.slice(0, limit);
}

/** 주말·연휴를 쉬고 온 날에도 거슬러 모으는 최대 기간 */
const MAX_GAP_DAYS = 10;

/**
 * 수집 기간. 평소에는 설정값(기사 window_hours·KEV kev_days·KISA advisories.days)이고,
 * 주말·공휴일에 쉬고 온 날은 지난 브리핑 이후를 모두 모은다(최대 MAX_GAP_DAYS일).
 * @param {object|null} prev 오늘 이전 가장 최근 브리핑
 * @returns {{hours:number, kevSince:string, advisoryDays:number, sinceBrief:string, sinceAt:string}}
 *   sinceAt: 지난 브리핑의 수집 끝 시각(메일 관심 뉴스가 그 이후 기사만 고르는 데 씀)
 */
export function collectWindow(cfg, { now, date, prev = null }) {
  let hours = cfg.window_hours;
  let kevSince = addDays(date, -cfg.vulns.kev_days);
  let advisoryDays = cfg.advisories.days;
  let sinceAt = '';
  if (prev?.date && prev.date < date) {
    const last = Date.parse(prev.window?.to || prev.generated_at || '');
    if (!Number.isNaN(last)) {
      // 지난 수집 끝 시각과 한 시간 겹치게(늦게 올라온 기사)
      hours = Math.max(hours, Math.ceil((now.getTime() - last) / 3600000) + 1);
      sinceAt = new Date(last).toISOString();
    }
    if (prev.date < kevSince) kevSince = prev.date;
    advisoryDays = Math.max(advisoryDays, Math.round((Date.parse(date) - Date.parse(prev.date)) / 86400000) + 1);
  }
  const floor = addDays(date, -MAX_GAP_DAYS);
  return {
    hours: Math.min(hours, MAX_GAP_DAYS * 24),
    kevSince: kevSince < floor ? floor : kevSince,
    advisoryDays: Math.min(advisoryDays, MAX_GAP_DAYS + 1),
    sinceBrief: prev?.date && prev.date < date ? prev.date : '',
    sinceAt,
  };
}

function hostOf(u) {
  try {
    return new URL(u).hostname.replace(/^(www|m)\./, '');
  } catch {
    return '';
  }
}

function newsForBrief(n) {
  const out = {
    id: n.id,
    region: n.region,
    lang: n.lang,
    title: n.title,
    url: n.url,
    source: n.source,
    published: n.published,
    snippet: n.snippet,
    outlets: n.outlets,
    related: n.related,
    cves: n.cves,
    score: n.score,
  };
  if (n.title_ko) out.title_ko = n.title_ko;
  if (n.summary_ko) out.summary_ko = n.summary_ko;
  return out;
}

/**
 * @param {object} cfg loadConfig() 결과
 * @param {{now?:Date, date?:string, force?:boolean, log?:Function, env?:object}} opts
 * @returns {Promise<{brief:object, skipped:boolean}>}
 */
export async function collectBrief(cfg, { now = new Date(), date = kstDate(now), force = false, log = console.log, env = process.env } = {}) {
  const existing = loadBrief(cfg.dataDir, date);
  if (existing && !force) {
    log(`${date} 브리핑이 이미 있어 건너뜁니다 (다시 만들려면 --force).`);
    return { brief: existing, skipped: true };
  }
  const history = recentHistory(cfg.dataDir, date);
  const sources = [];
  const track = async (id, name, fn) => {
    const t0 = Date.now();
    try {
      const r = await fn();
      sources.push({ id, name, ok: true, count: countOf(r), ms: Date.now() - t0 });
      return r;
    } catch (err) {
      sources.push({ id, name, ok: false, count: 0, ms: Date.now() - t0, error: String(err?.message || err).slice(0, 200) });
      log(`  ! ${name}: ${err?.message || err}`);
      return null;
    }
  };

  const prevDate = listBriefDates(cfg.dataDir).filter((d) => d < date).pop();
  let prev = null;
  try {
    prev = prevDate ? loadBrief(cfg.dataDir, prevDate) : null;
  } catch {
    // 지난 브리핑을 못 읽으면 평소 기간으로
  }
  const win = collectWindow(cfg, { now, date, prev });
  const windowStart = new Date(now.getTime() - win.hours * 3600 * 1000);
  const kevSince = win.kevSince;
  const nvdKey = secret('NVD_API_KEY', env);
  const naverId = secret('NAVER_CLIENT_ID', env);
  const naverSecret = secret('NAVER_CLIENT_SECRET', env);

  log(`${date} 브리핑 수집 시작 (기사 ${win.hours}시간${win.hours > cfg.window_hours ? ` — 지난 브리핑 ${win.sinceBrief} 이후` : ''}, KEV ${kevSince} 이후 등재분)`);
  const feeds = cfg.news.feeds.filter((f) => f.enabled !== false && f.url);
  const [kev, feedResults, advResults, naverItems, nvd] = await Promise.all([
    track('kev', 'CISA KEV', () => fetchKev({ since: kevSince })),
    Promise.all(feeds.map((f, i) => track(f.id, f.name, () => fetchFeed(f)).then((items) => ({ feed: { ...f, priority: i }, items })))),
    Promise.all(cfg.advisories.feeds.filter((f) => f.enabled !== false).map((f) => track(f.id, f.name, () => fetchFeed(f)).then((items) => ({ feed: f, items })))),
    naverId && naverSecret
      ? track('naver', '네이버 뉴스 검색', () => fetchNaverNews(cfg.news.naver_queries, { clientId: naverId, clientSecret: naverSecret }))
      : Promise.resolve(null),
    (async () => {
      const kevNvd = await track('nvd-kev', 'NVD (KEV 상세)', () =>
        fetchNvdKevAdded({ start: new Date(`${kevSince}T00:00:00Z`), end: now, apiKey: nvdKey }),
      );
      await sleep(nvdKey ? 1000 : 6500);
      const pub = await track('nvd', 'NVD (신규 CVE)', () => fetchNvdPublished({ start: windowStart, end: now, apiKey: nvdKey }));
      return { kevNvd, pub };
    })(),
  ]);

  // 뉴스
  const items = [];
  for (const { feed, items: list } of feedResults) {
    for (const it of list || []) {
      let { title } = it;
      let outlet = feed.name;
      if (feed.kind === 'aggregator') {
        const s = splitAggregatorTitle(it.title, it.source);
        title = s.title;
        outlet = s.outlet || it.source || feed.name;
        // 언론사 이름 대신 주소를 주는 경우가 있다
        if (/^https?:\/\//i.test(outlet)) outlet = hostOf(outlet) || feed.name;
      }
      items.push({ ...it, title, outlet, lang: feed.lang || 'ko', kind: feed.kind || 'security', priority: feed.priority });
    }
  }
  for (const it of naverItems || []) items.push({ ...it, outlet: hostOf(it.link) || '네이버 뉴스', lang: 'ko', kind: 'search', priority: 50 });
  const newsSel = selectNews(items, {
    now,
    windowHours: win.hours,
    history,
    domesticLimit: cfg.news.domestic_limit,
    internationalLimit: cfg.news.international_limit,
  });

  // KISA 공지
  const advisories = selectAdvisories(advResults, { date, days: win.advisoryDays, seen: history.advisoryUrls, limit: cfg.advisories.limit });

  // 취약점
  const kevItems = kev?.items || [];
  const pubRows = nvd.pub?.rows || [];
  const critCandidates = pubRows.filter((r) => r.cvss && r.cvss.score >= cfg.vulns.cvss_min);
  const epss = (await track('epss', 'FIRST EPSS', () => fetchEpss([...kevItems.map((k) => k.id), ...critCandidates.map((r) => r.id)]))) || new Map();
  const nvdById = new Map([...pubRows, ...(nvd.kevNvd?.rows || [])].map((r) => [r.id, r]));
  const exploited = selectExploited({ kevItems, nvdById, epss, seenIds: history.exploitedIds, limit: cfg.vulns.exploited_limit });
  const kevIds = new Set([...kevItems.map((k) => k.id), ...pubRows.filter((r) => r.kev).map((r) => r.id)]);
  const critical = selectCritical({
    nvdRows: pubRows,
    epss,
    seenIds: new Set([...history.criticalIds, ...history.exploitedIds]),
    kevIds,
    advisories,
    newsText: newsTextOf(newsSel.candidates),
    cvssMin: cfg.vulns.cvss_min,
    limit: cfg.vulns.critical_limit,
    watch: cfg.vulns.watch,
    today: date,
  });

  const draft = {
    date,
    exploited: exploited.shown,
    critical: critical.shown,
    advisories,
    news: { domestic: newsSel.domestic, international: newsSel.international },
    newsCandidates: newsSel.candidates,
    overview: '',
  };

  // 요약: Claude(선택) → 실패하거나 없으면 규칙 기반
  const engineCfg = cfg.summarizer.engine;
  const apiKey = secret('ANTHROPIC_API_KEY', env);
  let summarizer = { engine: 'rules' };
  if (engineCfg === 'claude' || (engineCfg === 'auto' && apiKey)) {
    if (!apiKey) {
      summarizer = { engine: 'rules', ok: false, error: 'ANTHROPIC_API_KEY 없음' };
    } else {
      const t0 = Date.now();
      try {
        log(`  Claude(${cfg.summarizer.model}) 로 선별·요약 중…`);
        const { out, usage, model } = await callClaude(draft, {
          model: cfg.summarizer.model,
          effort: cfg.summarizer.effort,
          domesticLimit: cfg.news.domestic_limit,
          internationalLimit: cfg.news.international_limit,
          newsCandidates: cfg.summarizer.news_candidates,
        });
        const result = applySummary(draft, out, { domesticLimit: cfg.news.domestic_limit, internationalLimit: cfg.news.international_limit });
        summarizer = {
          engine: model,
          ok: true,
          ms: Date.now() - t0,
          applied: result.applied,
          rejected: result.rejected,
          input_tokens: usage.input_tokens ?? null,
          output_tokens: usage.output_tokens ?? null,
        };
      } catch (err) {
        summarizer = { engine: 'rules', ok: false, ms: Date.now() - t0, error: String(err?.message || err).slice(0, 200) };
        log(`  ! Claude 요약 실패, 규칙 기반 문안으로 계속: ${summarizer.error}`);
      }
    }
  }

  // '없음'과 '가져오지 못함'을 구분해 보여 주려고 실패한 출처 묶음을 기록한다
  const okOf = (pred) => sources.some((s) => s.ok && pred(s.id));
  const failed = {
    kev: !okOf((id) => id === 'kev'),
    nvd: !okOf((id) => id === 'nvd'),
    kisa: !okOf((id) => cfg.advisories.feeds.some((f) => f.id === id)),
    news: !okOf((id) => id === 'naver' || feeds.some((f) => f.id === id)),
  };

  const brief = {
    version: BRIEF_VERSION,
    date,
    generated_at: kstIso(now),
    window: { hours: win.hours, from: windowStart.toISOString(), to: now.toISOString(), since_brief: win.sinceBrief, since_at: win.sinceAt },
    engine: summarizer.ok ? summarizer.engine : 'rules',
    overview: '',
    cvss_min: cfg.vulns.cvss_min,
    critical_total: failed.nvd ? null : critical.total,
    failed,
    exploited: draft.exploited,
    exploited_more: exploited.more.map((v) => ({ id: v.id, title: v.ko.title })),
    critical: draft.critical,
    critical_more: critical.more.map((g) => ({ id: g.id, ids: g.ids, label: g.label, cvss: g.cvss.score, title: g.ko.title })),
    advisories,
    news: { domestic: draft.news.domestic.map(newsForBrief), international: draft.news.international.map(newsForBrief) },
    sources,
    summarizer,
    stats: {
      news: newsSel.stats,
      nvd_published: nvd.pub?.total ?? null,
      kev_catalog: kev?.catalogVersion ?? '',
      kev_recent: kevItems.length,
    },
  };
  brief.overview = draft.overview || ruleOverview(brief);

  if (failed.kev && failed.nvd && failed.news) {
    throw new Error('취약점·뉴스 출처가 모두 실패해 브리핑을 만들지 않았습니다 (네트워크 확인)');
  }
  saveBrief(cfg.dataDir, brief, renderMarkdown(brief, { siteUrl: cfg.site.url }));
  return { brief, skipped: false };
}
