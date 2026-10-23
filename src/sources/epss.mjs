// FIRST EPSS: 앞으로 30일 안에 악용될 확률 추정치.
import { getJson } from '../http.mjs';
import { chunk } from '../util.mjs';

export const EPSS_URL = 'https://api.first.org/data/v1/epss';

/** @returns {Promise<Map<string, {epss:number, percentile:number}>>} */
export async function fetchEpss(ids, { timeoutMs = 30000 } = {}) {
  const out = new Map();
  for (const part of chunk([...new Set(ids)].filter(Boolean), 80)) {
    const data = await getJson(`${EPSS_URL}?cve=${part.join(',')}`, { timeoutMs, retries: 2 });
    for (const d of data?.data || []) {
      const epss = Number(d.epss);
      const percentile = Number(d.percentile);
      if (!Number.isNaN(epss)) out.set(String(d.cve).toUpperCase(), { epss, percentile });
    }
  }
  return out;
}
