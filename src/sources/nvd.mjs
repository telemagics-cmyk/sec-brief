// NVD CVE API 2.0. 키 없이도 되지만 30초에 5회로 제한되므로 요청 사이를 띄운다(NVD_API_KEY 가 있으면 짧게).
import { setTimeout as sleep } from 'node:timers/promises';
import { getJson } from '../http.mjs';

export const NVD_URL = 'https://services.nvd.nist.gov/rest/json/cves/2.0';
const PAGE = 2000;

function buildUrl(params, flags = []) {
  const q = new URLSearchParams(params).toString();
  return `${NVD_URL}?${[q, ...flags].filter(Boolean).join('&')}`;
}

/** 가장 높은 CVSS(v4.0·v3.1·v3.0 중). 같은 점수면 v3.x 를 먼저 쓴다(벡터 해석이 익숙하다). */
export function bestCvss(metrics = {}) {
  let best = null;
  for (const key of ['cvssMetricV31', 'cvssMetricV30', 'cvssMetricV40']) {
    for (const m of metrics[key] || []) {
      const d = m?.cvssData;
      if (!d || typeof d.baseScore !== 'number') continue;
      if (best && d.baseScore <= best.score) continue;
      best = {
        score: d.baseScore,
        version: d.version || key.replace('cvssMetricV', '').replace(/^(\d)(\d)$/, '$1.$2'),
        vector: d.vectorString || '',
        severity: d.baseSeverity || m.baseSeverity || '',
        source: m.source || '',
      };
    }
  }
  return best;
}

export function ssvcOf(metrics = {}) {
  for (const [key, arr] of Object.entries(metrics)) {
    if (!key.startsWith('ssvc')) continue;
    for (const m of arr || []) {
      const opts = m?.ssvcData?.options;
      if (!Array.isArray(opts)) continue;
      const merged = Object.assign({}, ...opts.filter((o) => o && typeof o === 'object'));
      return {
        exploitation: merged.exploitation || '',
        automatable: merged.automatable || '',
        technicalImpact: merged.technicalImpact || '',
      };
    }
  }
  return null;
}

/** configurations 의 CPE 에서 '벤더 제품 + 버전 범위' 를 뽑는다. */
export function cpeTarget(cve) {
  for (const conf of cve.configurations || []) {
    for (const node of conf.nodes || []) {
      for (const match of node.cpeMatch || []) {
        if (match.vulnerable === false) continue;
        const parts = String(match.criteria || '').split(':');
        if (parts.length < 6) continue;
        const vendor = parts[3].replace(/_/g, ' ');
        const product = parts[4].replace(/_/g, ' ');
        const lower = match.versionStartIncluding || match.versionStartExcluding;
        const upperEx = match.versionEndExcluding;
        const upperIn = match.versionEndIncluding;
        let range = '';
        if (upperEx) range = `${lower ? `${lower} 이상 ` : ''}${upperEx} 미만`;
        else if (upperIn) range = `${lower ? `${lower} 이상 ` : ''}${upperIn} 이하`;
        else if (parts[5] && parts[5] !== '*' && parts[5] !== '-') range = parts[5];
        return { vendor, product, range };
      }
    }
  }
  return null;
}

/** CPE 의 update 칸을 버전에 붙인다: 22.7 + r2.3 → 22.7r2.3(Ivanti), 1.8.0 + update_381 → 1.8.0.381, 11.0.0 + milestone1 → 11.0.0-m1 */
export function withUpdate(version, update) {
  const u = String(update ?? '').toLowerCase();
  if (!u || u === '*' || u === '-' || version === '*' || version === '-') return version;
  let m;
  if ((m = /^(?:update_?|u)(\d+)$/.exec(u))) return `${version}.${m[1]}`;
  if ((m = /^milestone_?(\d+)$/.exec(u))) return `${version}-m${m[1]}`;
  if (/^(alpha|beta|rc)_?\d*$/.test(u)) return `${version}-${u.replace('_', '')}`;
  return `${version}${u}`;
}

/**
 * configurations 의 취약한 CPE 전부 → [{ vendor, product, ranges: [{ si 이상, se 초과, ei 이하, ee 미만, exact 같음 }], all?, truncated? }].
 * feed(정보자산 관리 프로그램 같은 내부 도구가 자기 자산과 비교하는 목록)에 싣는다. 공개 정보(NVD)이고, 크기를 위해 개수를 자른다.
 * 버린 것은 표시한다: 버전이 * · - 인 CPE 는 all(모든 버전), 개수를 넘겨 자르면 truncated — 받는 쪽은 이때 '범위 밖'이라 하지 않는다.
 */
export function affectedOf(cve, { maxMatches = 2000, maxProducts = 20, maxRanges = 200 } = {}) {
  const map = new Map();
  let seen = 0;
  let cut = false;
  const unescape = (s) => String(s ?? '').replace(/\\(.)/g, '$1');
  for (const conf of cve.configurations || []) {
    for (const node of conf.nodes || []) {
      for (const m of node.cpeMatch || []) {
        if (m.vulnerable === false) continue;
        if (seen++ >= maxMatches) {
          cut = true;
          continue;
        }
        const parts = String(m.criteria || '').split(/(?<!\\):/);
        if (parts.length < 6 || parts[0] !== 'cpe') continue;
        const vendor = unescape(parts[3]);
        const product = unescape(parts[4]).replace(/_/g, ' ');
        if (!product || product === '*') continue;
        const r = {};
        if (m.versionStartIncluding) r.si = m.versionStartIncluding;
        if (m.versionStartExcluding) r.se = m.versionStartExcluding;
        if (m.versionEndIncluding) r.ei = m.versionEndIncluding;
        if (m.versionEndExcluding) r.ee = m.versionEndExcluding;
        const any = !Object.keys(r).length && (!parts[5] || parts[5] === '*' || parts[5] === '-');
        if (!Object.keys(r).length && !any) r.exact = withUpdate(unescape(parts[5]), unescape(parts[6]));
        const key = `${vendor}|${product}`;
        if (!map.has(key)) {
          if (map.size >= maxProducts) {
            cut = true;
            continue;
          }
          map.set(key, { vendor, product, ranges: [], keys: new Set() });
        }
        const a = map.get(key);
        if (any) {
          a.all = true;
          continue;
        }
        const k = JSON.stringify(r);
        if (a.keys.has(k)) continue;
        if (a.ranges.length >= maxRanges) {
          a.truncated = true;
          continue;
        }
        a.keys.add(k);
        a.ranges.push(r);
      }
    }
  }
  const out = [...map.values()].map(({ keys, ...a }) => a);
  if (cut && out.length) out[out.length - 1].truncated = true;
  return out;
}

export function parseNvdCve(cve) {
  const metrics = cve.metrics || {};
  const description = (cve.descriptions || []).find((d) => d.lang === 'en')?.value || '';
  const cwes = [];
  for (const w of cve.weaknesses || []) {
    for (const d of w.description || []) {
      if (/^CWE-\d+$/.test(d.value) && !cwes.includes(d.value)) cwes.push(d.value);
    }
  }
  return {
    id: cve.id,
    published: cve.published || '',
    status: cve.vulnStatus || '',
    cna: cve.sourceIdentifier || '',
    description: description.replace(/\s+/g, ' ').trim(),
    cvss: bestCvss(metrics),
    ssvc: ssvcOf(metrics),
    cwes,
    refs: (cve.references || []).slice(0, 12).map((r) => ({ url: r.url, tags: r.tags || [] })),
    cpe: cpeTarget(cve),
    affected: affectedOf(cve),
    kev: cve.cisaExploitAdd
      ? { added: cve.cisaExploitAdd, due: cve.cisaActionDue || '', name: cve.cisaVulnerabilityName || '' }
      : null,
  };
}

async function fetchAll(params, flags, { apiKey, timeoutMs, gapMs, log }) {
  const headers = apiKey ? { apiKey } : {};
  const rows = [];
  let start = 0;
  let total = 0;
  for (let page = 0; page < 10; page++) {
    if (page > 0) await sleep(gapMs);
    const data = await getJson(buildUrl({ ...params, resultsPerPage: PAGE, startIndex: start }, flags), {
      headers,
      timeoutMs,
      retries: 3,
      backoffMs: 6500,
      retryOn: [403, 429, 500, 502, 503, 504],
    });
    total = data.totalResults ?? 0;
    for (const v of data.vulnerabilities || []) if (v?.cve?.id) rows.push(parseNvdCve(v.cve));
    start += data.resultsPerPage || PAGE;
    if (start >= total || !(data.vulnerabilities || []).length) break;
    log?.(`NVD ${start}/${total}`);
  }
  return { rows, total };
}

function iso(d) {
  return d.toISOString();
}

/**
 * 기간 안에 공개된 CVE 전부(반려된 것 제외).
 * @returns {Promise<{rows:object[], total:number}>}
 */
export function fetchNvdPublished({ start, end, apiKey = '', timeoutMs = 240000, log } = {}) {
  return fetchAll({ pubStartDate: iso(start), pubEndDate: iso(end) }, ['noRejected'], {
    apiKey,
    timeoutMs,
    gapMs: apiKey ? 1000 : 6500,
    log,
  });
}

/** 기간 안에 CISA KEV 에 등재된 CVE (NVD 가 가진 CVSS·참고 링크를 함께 받으려고 쓴다). */
export function fetchNvdKevAdded({ start, end, apiKey = '', timeoutMs = 120000, log } = {}) {
  return fetchAll({ kevStartDate: iso(start), kevEndDate: iso(end) }, ['hasKev'], {
    apiKey,
    timeoutMs,
    gapMs: apiKey ? 1000 : 6500,
    log,
  });
}
