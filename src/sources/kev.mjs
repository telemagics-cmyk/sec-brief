// CISA KEV(실제 악용이 확인된 취약점 목록). CISA 주소가 안 되면 CISA 의 GitHub 사본을 쓴다.
import { getJson } from '../http.mjs';
import { safeUrl } from '../util.mjs';

export const KEV_URLS = [
  'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json',
  'https://raw.githubusercontent.com/cisagov/kev-data/develop/known_exploited_vulnerabilities.json',
];

/** notes 칸에서 벤더 공지 주소만 고른다 (CISA 지침·NVD 링크는 뺀다). */
export function vendorLinksFromNotes(notes) {
  const urls = String(notes ?? '').match(/https?:\/\/[^\s;,]+/g) || [];
  return urls
    .map((u) => safeUrl(u.replace(/[).]+$/, '')))
    .filter((u) => u && !/(^https?:\/\/(www\.)?cisa\.gov\/)|nvd\.nist\.gov/i.test(u));
}

export function normalizeKev(v) {
  return {
    id: String(v.cveID || '').toUpperCase(),
    vendor: v.vendorProject || '',
    product: v.product || '',
    name: v.vulnerabilityName || '',
    dateAdded: v.dateAdded || '',
    due: v.dueDate || '',
    ransomware: v.knownRansomwareCampaignUse || 'Unknown',
    description: v.shortDescription || '',
    requiredAction: v.requiredAction || '',
    cwes: Array.isArray(v.cwes) ? v.cwes : [],
    vendorLinks: vendorLinksFromNotes(v.notes),
  };
}

/** @returns {Promise<{catalogVersion:string, total:number, items:object[], via:string}>} */
export async function fetchKev({ since, urls = KEV_URLS, timeoutMs = 60000 } = {}) {
  let lastErr;
  for (const url of urls) {
    try {
      const data = await getJson(url, { timeoutMs, retries: 1 });
      if (!Array.isArray(data?.vulnerabilities)) throw new Error('KEV 형식이 아님');
      const items = data.vulnerabilities
        .map(normalizeKev)
        .filter((v) => v.id && (!since || v.dateAdded >= since))
        .sort((a, b) => b.dateAdded.localeCompare(a.dateAdded) || a.id.localeCompare(b.id));
      return { catalogVersion: data.catalogVersion || '', total: data.vulnerabilities.length, items, via: url };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}
