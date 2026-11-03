// src/sources/cveorg.mjs — CVE.org(CVE 레코드 5.x)에 제조사(CNA)가 적은 영향 제품·버전.
// NVD 는 새 CVE 를 며칠 뒤에야 분석해 CPE 를 붙이므로, 브리핑 당일의 고위험 취약점은 대개 이쪽에만 영향 버전이 있다.
// feed(사내 자산 관리 프로그램이 가져가 비교하는 목록)를 채우는 데만 쓰고, 실패해도 브리핑은 그대로 만든다.
import { getJson } from '../http.mjs';

const BASE = 'https://cveawg.mitre.org/api/cve';
const VERSION_OK = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,40}$/;
const clean = (v) => {
  const s = String(v ?? '').trim();
  return s && s !== '*' && s !== '-' && s !== '0' && !/^(n\/a|unspecified|all)$/i.test(s) && VERSION_OK.test(s) ? s : '';
};

// '3.0' → '3.1' (마지막 숫자를 하나 올린다, 숫자가 아니면 '')
function nextPrefix(prefix) {
  const parts = prefix.split('.');
  const last = Number(parts.at(-1));
  if (!parts[0] || !Number.isInteger(last)) return '';
  parts[parts.length - 1] = String(last + 1);
  return clean(parts.join('.'));
}

/** CVE 레코드 → [{ vendor, product, ranges: [{ si 이상, ei 이하, ee 미만, exact 같음 }] }] (영향 받음 표시만) */
export function affectedFromRecord(json) {
  const cna = json?.containers?.cna;
  const out = [];
  for (const a of Array.isArray(cna?.affected) ? cna.affected.slice(0, 20) : []) {
    const vendor = String(a?.vendor ?? '').trim().slice(0, 80);
    const product = String(a?.product ?? '').trim().slice(0, 120);
    if (!product || /^n\/a$/i.test(product)) continue;
    const ranges = [];
    let open = a.defaultStatus === 'affected';
    for (const v of Array.isArray(a.versions) ? a.versions.slice(0, 60) : []) {
      if (v?.status !== 'affected') continue;
      const r = {};
      if (v.lessThan || v.lessThanOrEqual) {
        if (clean(v.version)) r.si = clean(v.version);
        const lt = clean(String(v.lessThan ?? '').replace(/\.?\*$/, ''));
        const le = String(v.lessThanOrEqual ?? '');
        // '3.0.*' 이하 = 3.0 계열 전부 → 3.1 미만
        if (lt) r.ee = lt;
        else if (/\*$/.test(le)) {
          const next = nextPrefix(le.replace(/\.?\*$/, ''));
          if (next) r.ee = next;
        } else if (clean(le)) r.ei = clean(le);
      } else if (clean(v.version)) r.exact = clean(v.version);
      else open = true;
      if (Object.keys(r).length && ranges.length < 40 && !ranges.some((x) => JSON.stringify(x) === JSON.stringify(r))) ranges.push(r);
    }
    if (!ranges.length && !open) continue;
    out.push({ vendor, product, ranges: open && !ranges.length ? [] : ranges });
  }
  return out;
}

/** 여러 CVE 의 영향 버전(동시에 4개씩, 하나에 10초까지, 실패한 번호는 건너뜀) → Map(번호 → affected) */
export async function fetchCnaAffected(ids, { concurrency = 4, timeoutMs = 10000, max = 40, get = getJson } = {}) {
  const list = [...new Set(ids)].filter((id) => /^CVE-\d{4}-\d{4,}$/.test(id)).slice(0, max);
  const out = new Map();
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const id = list[next++];
      try {
        const json = await get(`${BASE}/${id}`, { timeoutMs, retries: 1 });
        const affected = affectedFromRecord(json);
        if (affected.length) out.set(id, affected);
      } catch {
        // 이 번호는 이름만으로 비교된다
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker));
  return out;
}
