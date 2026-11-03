// src/feed.mjs — 브리핑에 실린 취약점을 기계가 읽는 목록으로: _site/feed/YYYY-MM-DD.json · feed/latest.json
// 사내의 자산 관리 프로그램 같은 도구가 이 목록을 가져가 자기 자산과 비교한다(그쪽 자산 정보는 이리로 오지 않는다).
// 내용은 브리핑과 같은 공개 정보(CISA KEV·NVD)뿐이다. 형식이 바뀌면 format 의 숫자를 올린다.
import { nvdUrl } from './vulns.mjs';

export const FEED_FORMAT = 'sec-brief-vulns/1';

// 고위험 묶음의 '제품' — 라벨이 제조사 이름뿐이거나 '○○ 공지 문서번호' 꼴이면 제품으로 쓰지 않는다(이름만으로 넓게 맞춰지지 않게)
function productOf(g) {
  const label = String(g.label || '').trim();
  const vendor = String(g.vendor || '').trim();
  if (!label || label.toLowerCase() === vendor.toLowerCase() || / 공지 /.test(label)) return '';
  return label;
}

const score = (c) => (typeof c === 'number' ? c : typeof c?.score === 'number' ? c.score : null);

/** 브리핑 하나 → feed. site.url 이 있으면 브리핑 웹 페이지 주소를 함께 */
export function feedOf(b, site = {}) {
  const base = String(site.url || '').replace(/\/+$/, '');
  const items = [];
  for (const v of b.exploited || []) {
    items.push({ id: v.id, ids: [v.id], kind: 'kev', title: v.ko?.title || v.name || v.id, vendor: v.vendor || '', product: v.product || '', cvss: score(v.cvss), epss: v.epss ?? null, kev: true, due: v.due || '', ransomware: Boolean(v.ransomware), nvd: v.nvd || nvdUrl(v.id), affected: v.affected || [] });
  }
  for (const v of b.exploited_more || []) {
    items.push({ id: v.id, ids: [v.id], kind: 'kev', title: v.title || v.id, vendor: v.vendor || '', product: v.product || '', cvss: null, epss: null, kev: true, due: v.due || '', ransomware: false, nvd: nvdUrl(v.id), affected: v.affected || [] });
  }
  for (const g of b.critical || []) {
    items.push({ id: g.id, ids: g.ids || [g.id], kind: 'crit', title: g.ko?.title || g.label || g.id, vendor: g.vendor || '', product: productOf(g), cvss: score(g.cvss), epss: g.epss ?? null, kev: false, due: '', ransomware: false, nvd: g.nvd || nvdUrl(g.id), affected: g.affected || [] });
  }
  for (const g of b.critical_more || []) {
    items.push({ id: g.id, ids: g.ids || [g.id], kind: 'more', title: g.title || g.label || g.id, vendor: g.vendor || '', product: productOf(g), cvss: score(g.cvss), epss: null, kev: false, due: '', ransomware: false, nvd: nvdUrl(g.id), affected: g.affected || [] });
  }
  return { format: FEED_FORMAT, date: b.date, generated_at: b.generated_at || '', page: base ? `${base}/b/${b.date}.html` : '', items };
}
