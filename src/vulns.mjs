// 취약점 선별
// - 악용 확인: CISA KEV 신규 등재분 (NVD 의 CVSS·참고 링크, EPSS 를 덧붙임)
// - 신규 고위험: 수집 창 안에 공개된 CVSS 기준 이상 CVE. 같은 공지·저장소의 CVE 는 한 묶음으로 보고,
//   관심 제품·KISA 권고·뉴스 보도·SSVC·EPSS 로 가점, 오래된 번호·워드프레스 플러그인 등은 감점한다.
import { cleanText, findCveIds, truncate, uniq } from './util.mjs';
import { CNA_VENDOR, COORDINATOR_CNAS, CWE_KO, VULN_PHRASES_KO, translateVulnName } from './vocab.mjs';

const NVD_DETAIL = 'https://nvd.nist.gov/vuln/detail/';

export function nvdUrl(id) {
  return `${NVD_DETAIL}${id}`;
}

/** CVSS 벡터 → {av, pr, ui, c, i, a} (v3·v4 모두) */
export function parseVector(vector) {
  const out = {};
  for (const part of String(vector ?? '').split('/')) {
    const [k, v] = part.split(':');
    if (k && v) out[k] = v;
  }
  return {
    av: out.AV, pr: out.PR, ui: out.UI,
    c: out.C ?? out.VC, i: out.I ?? out.VI, a: out.A ?? out.VA,
  };
}

export function isRemoteNoAuth(vector) {
  const v = parseVector(vector);
  return v.av === 'N' && v.pr === 'N';
}

/** 벡터·SSVC 로 만든 한 줄 영향 설명 */
export function impactText({ vector, ssvc, fallback = '' } = {}) {
  const v = parseVector(vector);
  const where = { N: '원격에서', A: '인접 네트워크에서', L: '로컬에서', P: '물리적 접근으로' }[v.av];
  const who = { N: '인증 없이', L: '낮은 권한으로', H: '관리자 권한으로' }[v.pr];
  const ui = v.ui === 'N' ? '사용자 개입 없이' : v.ui ? '사용자 동작이 필요하며' : '';
  const highs = ['c', 'i', 'a'].filter((k) => v[k] === 'H');
  let result = '';
  if (ssvc?.technicalImpact === 'total' || highs.length === 3) result = '시스템 장악 우려';
  else if (v.c === 'H' && v.i === 'H') result = '정보 탈취·변조 우려';
  else if (v.c === 'H') result = '중요 정보 노출 우려';
  else if (v.i === 'H') result = '데이터 변조 우려';
  else if (v.a === 'H') result = '서비스 마비 우려';
  const how = [where, who, ui].filter(Boolean).join(' ');
  const tail = ssvc?.automatable === 'yes' ? ' (자동화 공격 가능)' : '';
  if (!how && !result) return fallback;
  return `${how ? `${how} 공격 가능` : '공격 조건 확인 필요'}${result ? ` — ${result}` : ''}${tail}`;
}

function firstMatchKo(text) {
  for (const [re, ko] of VULN_PHRASES_KO) {
    if (/^(복수|취약점|세부 미공개)$/.test(ko)) continue;
    if (new RegExp(re.source, 'i').test(text)) return ko;
  }
  return '';
}

/** 취약점 유형(한국어): CWE 표 → 설명의 영어 표현 순서로 찾는다. */
export function vulnTypeKo({ cwes = [], description = '' } = {}) {
  for (const c of cwes) if (CWE_KO[c]) return CWE_KO[c];
  return firstMatchKo(description);
}

// 제품 이름 뒤에 올 수 있는 이음말: 'X 1.2 before 1.3', 'X is a ...', 'X (VCO) on-prem has ...'
const WORD = '[A-Z0-9][\\w.+/-]*';
const NEXT_WORD = `(?: (?:${WORD}|\\([A-Z0-9]{2,10}\\)|for|of))`;
const PRODUCT_PATTERNS = [
  new RegExp(`(?:discovered|found|identified|determined) in (${WORD}${NEXT_WORD}{0,4}?)(?= affecting| versions?\\b| up to| before| through| prior| \\d|,|\\.|$)`),
  new RegExp(`vulnerability in (?:the )?(${WORD}${NEXT_WORD}{0,4}?)(?: [a-z][\\w-]*)? (?:allows|could|may|before|through|from|versions?|\\d)`),
  new RegExp(`on affected (${WORD}(?: ${WORD}){0,4})`),
  new RegExp(`^(?:The )?([A-Za-z0-9][\\w.+/-]*${NEXT_WORD}{0,5}?)(?: \\([^)]{1,20}\\))? (?:(?:is an?|is affected|are affected|has|contains|before|through|prior|versions?|from|allows|in versions|on-prem)\\b|\\d)`),
  new RegExp(`\\bin (?:the )?([A-Z]${'[\\w.+/-]*'}${NEXT_WORD}{0,5}?) (?:allows|could|may|via|when|before|through|versions?)\\b`),
];

// 뉴스 보도 여부를 볼 때 흔해서 쓰면 안 되는 제품 낱말
const COMMON_PRODUCT_WORDS = new Set(
  ('server client edition manager management service services windows microsoft google apple cloud enterprise ' +
    'gateway portal plugin firmware router system systems software platform console agent center studio office ' +
    'network networks security access admin azure linux android chrome version versions orchestrator application ' +
    'applications library framework module driver kernel engine control controller').split(' '),
);

/** 뉴스 제목에서 찾을 제품 낱말: 벤더명·흔한 낱말을 뺀 다섯 글자 이상 */
export function productTokens(label, vendor) {
  const v = String(vendor || '').toLowerCase();
  return String(label || '')
    .split(/[\s/()]+/)
    .filter((w) => w.length >= 5 && w.toLowerCase() !== v && !COMMON_PRODUCT_WORDS.has(w.toLowerCase()));
}

/** 설명에서 제품 이름을 찾는다(없으면 빈 문자열). */
export function productFromDescription(desc) {
  const d = String(desc ?? '').trim();
  if (!d || /^no description/i.test(d)) return '';
  for (const re of PRODUCT_PATTERNS) {
    const m = d.match(re);
    if (m && m[1] && m[1].length >= 2 && m[1].length <= 60 && !/^(A|An|The|This|In|It)$/.test(m[1])) return m[1].trim();
  }
  return '';
}

function vendorOf(row) {
  if (row.cpe?.vendor) return titleCase(row.cpe.vendor);
  if (!COORDINATOR_CNAS.has(row.cna) && CNA_VENDOR[row.cna]) return CNA_VENDOR[row.cna];
  return '';
}

function titleCase(s) {
  return String(s).replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** 'Microsoft Exchange Server' 에 'Microsoft' 가 낱말로 들어 있는가 ('Beta' 안의 'B' 는 아님) */
export function hasWord(text, word) {
  const first = String(word || '').toLowerCase().split(/\s+/)[0];
  return Boolean(first) && String(text || '').toLowerCase().split(/[\s/()-]+/).includes(first);
}

/** 그룹 이름: 'GitLab CE/EE' 처럼 제품까지, 모르면 벤더, 그것도 모르면 CVE 번호 */
export function labelOf(row) {
  const vendor = vendorOf(row);
  const product = row.cpe?.product ? titleCase(row.cpe.product) : productFromDescription(row.description);
  if (product && vendor && !hasWord(product, vendor)) return `${vendor} ${product}`;
  return product || vendor || '';
}

/** 같은 공지·저장소를 가리키는 참고 링크 키 */
export function refKeys(row) {
  const keys = [];
  for (const r of (row.refs || []).slice(0, 3)) {
    let u;
    try {
      u = new URL(r.url);
    } catch {
      continue;
    }
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'github.com') {
      const [owner, repo] = u.pathname.split('/').filter(Boolean);
      if (owner && repo && owner !== 'advisories' && owner !== 'cisagov') keys.push(`gh:${owner}/${repo}`.toLowerCase());
      continue;
    }
    if (/(^|\.)(nvd\.nist\.gov|cve\.org|mitre\.org|vuldb\.com|patchstack\.com|wordfence\.com|vulncheck\.com|gist\.github\.com|msrc\.microsoft\.com|youtube\.com|twitter\.com|x\.com)$/.test(host)) continue;
    keys.push(`${host}${u.pathname}${u.search}`.toLowerCase());
  }
  return keys;
}

function groupRows(rows) {
  const parent = rows.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const owner = new Map();
  rows.forEach((row, i) => {
    for (const k of refKeys(row)) {
      if (owner.has(k)) parent[find(i)] = find(owner.get(k));
      else owner.set(k, i);
    }
  });
  const groups = new Map();
  rows.forEach((row, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(row);
  });
  return [...groups.values()];
}

function wordMatch(hay, term) {
  if (!term) return false;
  if (/^[\x20-\x7e]+$/.test(term)) {
    const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^A-Za-z0-9])${esc}([^A-Za-z0-9]|$)`, 'i').test(hay);
  }
  return hay.includes(term);
}

/** 'Fortinet 제품 보안 업데이트 권고' → 'Fortinet' */
export function advisoryVendor(title) {
  const m = String(title).match(/^\s*(.+?)\s*(?:제품|보안|신규|취약점|업데이트)/);
  return m ? m[1].replace(/^\[[^\]]*\]\s*/, '').trim() : '';
}

const MS_CLOUD = /\bAzure\b|Microsoft 365|\bM365\b|Copilot|\bEntra\b|Dynamics 365|Power (Apps|Automate|Platform|Pages)|\bBing\b|Microsoft Account|\bAAD\b|Microsoft Purview|Defender for Cloud/;

function vendorLinks(row) {
  const refs = row?.refs || [];
  const tagged = refs.filter((r) => (r.tags || []).some((t) => /vendor advisory|patch|mitigation/i.test(t)));
  return uniq([...tagged, ...refs].map((r) => r.url)).filter((u) => !/nvd\.nist\.gov/.test(u));
}

function targetText(row, label) {
  if (row.cpe) return `${titleCase(row.cpe.vendor)} ${titleCase(row.cpe.product)}${row.cpe.range ? ` ${row.cpe.range}` : ''}`;
  const m = String(row.description).match(/\b(before|prior to|through|up to and including|up to)\s+v?(\d[\w.-]*\d|\d)/i);
  if (label && m) {
    const ver = m[2];
    const word = /before|prior/i.test(m[1]) ? `${ver} 미만` : `${ver} 이하`;
    return `${label} ${word}`;
  }
  return label || '';
}

/**
 * CISA KEV 신규 → 브리핑 항목
 * @param {{kevItems:object[], nvdById:Map, epss:Map, seenIds:Set<string>, limit:number}} p
 */
export function selectExploited({ kevItems, nvdById = new Map(), epss = new Map(), seenIds = new Set(), limit = 10 }) {
  const rows = kevItems
    .filter((k) => !seenIds.has(k.id))
    .map((k) => {
      const n = nvdById.get(k.id);
      const e = epss.get(k.id);
      const cwes = k.cwes?.length ? k.cwes : n?.cwes ?? [];
      const vector = n?.cvss?.vector || '';
      const links = uniq([...(k.vendorLinks || []), ...vendorLinks(n)]).slice(0, 3);
      return {
        id: k.id,
        section: 'exploited',
        vendor: k.vendor,
        product: k.product,
        name: k.name,
        dateAdded: k.dateAdded,
        due: k.due,
        ransomware: k.ransomware === 'Known',
        description: k.description,
        cwes,
        cvss: n?.cvss ? { score: n.cvss.score, version: n.cvss.version, vector } : null,
        ssvc: n?.ssvc ?? null,
        epss: e?.epss ?? null,
        epssPct: e?.percentile ?? null,
        published: n?.published ?? '',
        links,
        nvd: nvdUrl(k.id),
        ko: {
          title: truncate(kevTitleKo(k, cwes), 60),
          target: `${k.vendor} ${k.product}`.trim(),
          impact: `실제 공격에 악용됨${k.ransomware === 'Known' ? '(랜섬웨어 공격에 쓰임)' : ''}${vector ? ` · ${impactText({ vector, ssvc: n?.ssvc })}` : ''}`,
          action: `벤더 권고에 따라 즉시 패치·완화 조치${k.due ? ` (CISA 조치 기한 ${k.due})` : ''}`,
        },
      };
    })
    .sort((a, b) => b.dateAdded.localeCompare(a.dateAdded) || Number(b.ransomware) - Number(a.ransomware) || (b.cvss?.score ?? 0) - (a.cvss?.score ?? 0));
  return { shown: rows.slice(0, limit), more: rows.slice(limit) };
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * KEV 제목: 'Plex Media Server External Control of File Name or Path Vulnerability'
 *   → 'Plex Media Server 파일 이름·경로 외부 제어 취약점'
 * 번역하고도 영어 낱말이 둘 넘게 남으면 CWE 로 정한 유형을 쓴다.
 */
export function kevTitleKo(k, cwes = k.cwes || []) {
  const vendor = String(k.vendor || '').trim();
  const product = String(k.product || '').trim();
  const label = product && vendor && !hasWord(product, vendor) ? `${vendor} ${product}` : product || vendor;
  let rest = String(k.name || '');
  for (const p of [vendor, product]) if (p) rest = rest.replace(new RegExp(`^\\s*${escapeRe(p)}\\s+`, 'i'), '');
  const restKo = translateVulnName(rest);
  const englishLeft = (restKo.match(/[A-Za-z]{3,}/g) || []).length;
  const typeKo = englishLeft > 2 || !/[가-힣]/.test(restKo) ? `${vulnTypeKo({ cwes, description: rest }) || '보안'} 취약점` : restKo;
  return `${label} ${typeKo}`.trim();
}

/**
 * NVD 신규 고위험 → 묶음 단위 항목
 * @param {object} p
 * @param {object[]} p.nvdRows       parseNvdCve 결과
 * @param {Map} p.epss
 * @param {Set<string>} p.seenIds    최근 브리핑에서 다룬 CVE
 * @param {Set<string>} p.kevIds     악용 확인 칸에 이미 실은 CVE
 * @param {object[]} p.advisories    KISA 공지 (title, url)
 * @param {string} p.newsText        뉴스 제목들을 이은 글 (보도 여부 판단)
 */
export function selectCritical({ nvdRows, epss = new Map(), seenIds = new Set(), kevIds = new Set(), advisories = [], newsText = '', cvssMin = 9, limit = 5, watch = [], today }) {
  const year = Number(String(today || new Date().toISOString()).slice(0, 4));
  const all = nvdRows.filter((r) => r.cvss && r.cvss.score >= cvssMin);
  const fresh = all.filter((r) => !kevIds.has(r.id) && !seenIds.has(r.id));
  const advVendors = advisories.map((a) => ({ vendor: advisoryVendor(a.title), url: a.url, title: a.title })).filter((a) => a.vendor);
  const watchHasWp = watch.some((w) => /wordpress/i.test(w));
  const groups = groupRows(fresh).map((rows) => {
    rows.sort((a, b) => b.cvss.score - a.cvss.score || a.id.localeCompare(b.id));
    const top = rows[0];
    const label = rows.map(labelOf).find(Boolean) || '';
    // 관심 제품·KISA 권고는 '무슨 제품인지'로만 맞춘다. 설명 전체로 맞추면 'PHP 로 만든 Joomla' 가 PHP 로 잡힌다.
    const cpeNames = rows.map((r) => (r.cpe ? `${r.cpe.vendor} ${r.cpe.product}` : '')).join(' ');
    const hay = `${label} ${vendorOf(top)} ${cpeNames}`;
    const ids = rows.map((r) => r.id);
    const epssMax = Math.max(0, ...ids.map((id) => epss.get(id)?.epss ?? 0));
    const watchHit = watch.find((w) => wordMatch(hay, w)) || '';
    const kisa = advVendors.find((a) => wordMatch(hay, a.vendor));
    const newsHit = ids.some((id) => newsText.includes(id)) || productTokens(label, vendorOf(top)).some((t) => wordMatch(newsText, t));
    const oldId = ids.every((id) => Number(id.slice(4, 8)) < year - 1);
    const wordpress = rows.some((r) => /patchstack|wordfence/.test(r.cna) || /wordpress/i.test(r.description));
    const msCloud = top.cna === 'secure@microsoft.com' && MS_CLOUD.test(top.description);
    const ssvc = rows.map((r) => r.ssvc).find((s) => s?.exploitation === 'active') || rows.map((r) => r.ssvc).find((s) => s?.exploitation === 'poc') || top.ssvc;
    let score = top.cvss.score;
    if (ssvc?.exploitation === 'active') score += 3;
    else if (ssvc?.exploitation === 'poc') score += 1.5;
    if (ssvc?.automatable === 'yes') score += 0.5;
    if (watchHit) score += 2;
    if (kisa) score += 2;
    if (newsHit) score += 2;
    score += epssMax * 5;
    if (isRemoteNoAuth(top.cvss.vector)) score += 0.5;
    score += Math.min(rows.length - 1, 3) * 0.2;
    if (oldId) score -= 2.5;
    if (wordpress && !watchHasWp) score -= 1.5;
    if (msCloud) score -= 1.5;
    if (top.status === 'Deferred') score -= 0.5;
    const cwes = uniq(rows.flatMap((r) => r.cwes));
    const typeKo = vulnTypeKo({ cwes, description: top.description });
    const docId = (top.refs?.[0]?.url.match(/docId=([a-z0-9-]+?)(?:en_us)?(?:&|$)/i) || [])[1];
    const vendor = vendorOf(top);
    const productKnown = label && label.toLowerCase() !== vendor.toLowerCase();
    const name = productKnown ? label : docId && vendor ? `${vendor} 공지 ${docId}` : label || vendor || top.id;
    const links = uniq([...vendorLinks(top), ...(kisa ? [kisa.url] : [])]).slice(0, 3);
    return {
      id: top.id,
      ids,
      section: 'critical',
      label: name,
      vendor: vendorOf(top),
      cna: top.cna,
      status: top.status,
      published: top.published,
      description: top.description,
      descriptions: rows.slice(0, 5).map((r) => ({ id: r.id, text: truncate(r.description, 300) })),
      cwes,
      cvss: { score: top.cvss.score, version: top.cvss.version, vector: top.cvss.vector },
      ssvc: ssvc ?? null,
      epss: epssMax || null,
      links,
      nvd: nvdUrl(top.id),
      flags: {
        watch: watchHit,
        kisa: kisa ? kisa.title : '',
        news: Boolean(newsHit),
        oldId,
        wordpress,
        msCloud,
        remoteNoAuth: isRemoteNoAuth(top.cvss.vector),
      },
      score: Math.round(score * 100) / 100,
      ko: {
        title: truncate(`${name} ${typeKo || '취약점'}${rows.length > 1 ? ` 등 ${rows.length}건` : ''}`, 60),
        target: targetText(top, label) || name,
        impact: impactText({ vector: top.cvss.vector, ssvc, fallback: '공격 조건 확인 필요' }),
        action: msCloud
          ? '클라우드 서비스 취약점 — 벤더가 조치했는지, 고객 조치가 필요한지 MSRC 공지에서 확인'
          : '벤더 보안 공지를 확인해 패치 적용',
      },
    };
  });
  groups.sort((a, b) => b.score - a.score || b.cvss.score - a.cvss.score);
  // 같은 벤더가 상위를 독차지하지 않게 벤더당 2묶음까지
  const shown = [];
  const perVendor = new Map();
  for (const g of groups) {
    if (shown.length >= limit) break;
    const key = (g.vendor || g.cna || g.id).toLowerCase();
    if ((perVendor.get(key) || 0) >= 2) continue;
    perVendor.set(key, (perVendor.get(key) || 0) + 1);
    shown.push(g);
  }
  const more = groups.filter((g) => !shown.includes(g));
  return { shown, more, total: all.length, fresh: fresh.length };
}

/** 뉴스에서 CVE 번호를 찾아 낼 때 쓰는 보조: 텍스트 묶음 */
export function newsTextOf(newsItems) {
  return newsItems.map((n) => `${n.title} ${(n.related || []).map((r) => r.title).join(' ')} ${n.snippet || ''}`).join('\n');
}

export { findCveIds, cleanText };
