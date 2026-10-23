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
