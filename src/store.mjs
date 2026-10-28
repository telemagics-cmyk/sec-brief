// 브리핑 이력 저장소: data/briefs/YYYY/YYYY-MM-DD.json (+ 같은 이름의 .md)
// 중복 방지 기록을 따로 두지 않고, 최근 브리핑 파일에서 이미 다룬 CVE·기사를 읽어 낸다.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { addDays, canonicalUrl, isYmd } from './util.mjs';

export function briefFile(dataDir, date, ext = 'json') {
  return join(dataDir, 'briefs', date.slice(0, 4), `${date}.${ext}`);
}

export function writeAtomic(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, path);
}

export function saveBrief(dataDir, brief, markdown) {
  writeAtomic(briefFile(dataDir, brief.date), `${JSON.stringify(brief, null, 2)}\n`);
  if (markdown !== undefined) writeAtomic(briefFile(dataDir, brief.date, 'md'), markdown);
}

export function loadBrief(dataDir, date) {
  const p = briefFile(dataDir, date);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8'));
}

/** 저장된 브리핑 날짜 (오름차순) */
export function listBriefDates(dataDir) {
  const root = join(dataDir, 'briefs');
  if (!existsSync(root)) return [];
  const dates = [];
  for (const year of readdirSync(root)) {
    if (!/^\d{4}$/.test(year)) continue;
    for (const f of readdirSync(join(root, year))) {
      const m = f.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
      if (m && isYmd(m[1])) dates.push(m[1]);
    }
  }
  return dates.sort();
}

export function loadAllBriefs(dataDir) {
  return listBriefDates(dataDir)
    .reverse()
    .map((d) => {
      try {
        return loadBrief(dataDir, d);
      } catch (err) {
        console.warn(`경고: ${d} 브리핑을 읽지 못해 건너뜁니다 — ${err.message}`);
        return null;
      }
    })
    .filter(Boolean);
}

/**
 * 오늘 이전 브리핑에서 이미 다룬 것들. 같은 날 다시 만들 때(--force) 자기 자신과 겹치지 않게 오늘은 뺀다.
 * 기사 제목은 최근 titleDays 일과 최근 titleDays 회 중 더 긴 쪽과 비교한다(주말·연휴에 쉬어도 바로 앞 브리핑과는 비교).
 */
export function recentHistory(dataDir, today, { days = 30, titleDays = 2 } = {}) {
  const from = addDays(today, -days);
  const dates = listBriefDates(dataDir).filter((d) => d >= from && d < today);
  const lastBriefs = dates[Math.max(0, dates.length - titleDays)];
  const byDays = addDays(today, -titleDays);
  const titleFrom = lastBriefs && lastBriefs < byDays ? lastBriefs : byDays;
  const h = {
    seenUrls: new Set(),
    exploitedIds: new Set(),
    criticalIds: new Set(),
    advisoryUrls: new Set(),
    recentNewsTitles: [],
  };
  for (const date of dates) {
    let b;
    try {
      b = loadBrief(dataDir, date);
    } catch {
      continue;
    }
    if (!b) continue;
    if (b.legacy) {
      for (const id of b.cves || []) h.criticalIds.add(id);
      for (const u of b.links || []) h.seenUrls.add(canonicalUrl(u));
      continue;
    }
    for (const v of b.exploited || []) h.exploitedIds.add(v.id);
    for (const v of b.exploited_more || []) h.exploitedIds.add(v.id);
    for (const g of [...(b.critical || []), ...(b.critical_more || [])]) for (const id of g.ids || [g.id]) h.criticalIds.add(id);
    for (const a of b.advisories || []) h.advisoryUrls.add(canonicalUrl(a.url));
    for (const n of [...(b.news?.domestic || []), ...(b.news?.international || [])]) {
      h.seenUrls.add(canonicalUrl(n.url));
      for (const r of n.related || []) h.seenUrls.add(canonicalUrl(r.url));
      if (date >= titleFrom) h.recentNewsTitles.push(n.title);
    }
  }
  return h;
}
