// src/sources/cveorg.mjs — CVE.org(CVE 레코드 5.x)에 제조사(CNA)가 적은 영향 제품·버전.
// NVD 는 새 CVE 를 며칠 뒤에야 분석해 CPE 를 붙이므로, 브리핑 당일의 고위험 취약점은 대개 이쪽에만 영향 버전이 있다.
// feed(사내 자산 관리 프로그램이 가져가 비교하는 목록)를 채우는 데만 쓰고, 실패해도 브리핑은 그대로 만든다.
// 알아볼 수 없는 버전은 버리지 않고 표시한다: 모든 버전이면 all, 커밋 번호처럼 버전이 아닌 값이 있으면 truncated
// — 받는 쪽은 이때 '범위 밖'이라 하지 않는다.
import { getJson } from '../http.mjs';

const BASE = 'https://cveawg.mitre.org/api/cve';
const VERSION_OK = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,40}$/;
const GIT_HASH = /^[0-9a-f]{12,64}$/i;
const ANY = /^(\*|-|0|n\/a|na|unspecified|all|any)$/i;
const ok = (v) => {
  const s = String(v ?? '').trim();
  return s && !ANY.test(s) && !GIT_HASH.test(s) && VERSION_OK.test(s) ? s : '';
};

// '3.0' → '3.1' (마지막 숫자를 하나 올린다, 숫자가 아니면 '')
function nextPrefix(prefix) {
  const parts = prefix.split('.');
  const last = Number(parts.at(-1));
  if (!parts[0] || !Number.isInteger(last)) return '';
  parts[parts.length - 1] = String(last + 1);
  return ok(parts.join('.'));
}

// GitHub 등은 '>= 3.0, < 3.5' 처럼 조건을 version 칸에 적는다 → 구간 하나(모르는 꼴이면 null)
function conditionRange(text) {
  const r = {};
  for (const part of String(text).split(/\s*,\s*/)) {
    const m = /^(>=|>|<=|<|=)\s*(\S+)$/.exec(part.trim());
    if (!m || !ok(m[2])) return null;
    r[{ '>=': 'si', '>': 'se', '<=': 'ei', '<': 'ee', '=': 'exact' }[m[1]]] = m[2];
  }
  return Object.keys(r).length ? r : null;
}

// 버전 한 줄 → { ranges } · { all } · { unknown }
function rangesOf(v) {
  const base = String(v.version ?? '').trim();
  const lt = String(v.lessThan ?? '').trim();
  const le = String(v.lessThanOrEqual ?? '').trim();
  if (v.versionType === 'git' || GIT_HASH.test(base)) return { unknown: true }; // 리눅스 커널 기록 등: 커밋 번호는 버전이 아니다
  if (lt || le) {
    const r = {};
    if (ok(base)) r.si = base;
    if (lt && !ANY.test(lt)) {
      const e = ok(lt.replace(/\.\*$/, ''));
      if (!e) return { unknown: true };
      r.ee = e;
    } else if (le && !ANY.test(le)) {
      // '3.0.*' 이하 = 3.0 계열 전부 → 3.1 미만
      const e = /\.\*$/.test(le) ? nextPrefix(le.replace(/\.\*$/, '')) : ok(le);
      if (!e) return { unknown: true };
      if (/\.\*$/.test(le)) r.ee = e;
      else r.ei = e;
    }
    if (!r.ee && !r.ei && !r.si) return { all: true }; // 0 ~ * : 모든 버전
    return { ranges: [r] };
  }
  if (!base || ANY.test(base)) return { all: true };
  if (/[<>=]/.test(base)) {
    const r = conditionRange(base);
    return r ? { ranges: [r] } : { unknown: true };
  }
  return ok(base) ? { ranges: [{ exact: base }] } : { unknown: true };
}

/** CVE 레코드 → [{ vendor, product, ranges: [{ si 이상, se 초과, ei 이하, ee 미만, exact 같음 }], all?, truncated? }] (영향 받음 표시만) */
export function affectedFromRecord(json) {
  const cna = json?.containers?.cna;
  const out = [];
  for (const a of Array.isArray(cna?.affected) ? cna.affected.slice(0, 20) : []) {
    const vendor = String(a?.vendor ?? '').trim().slice(0, 80);
    const product = String(a?.product ?? '').trim().slice(0, 120);
    if (!product || /^n\/a$/i.test(product)) continue;
    const ranges = [];
    const keys = new Set();
    let all = a.defaultStatus === 'affected';
    let truncated = false;
    const versions = Array.isArray(a.versions) ? a.versions : [];
    for (const v of versions.slice(0, 200)) {
      if (v?.status !== 'affected') continue;
      const got = rangesOf(v);
      if (got.all) all = true;
      if (got.unknown) truncated = true;
      for (const r of got.ranges ?? []) {
        const k = JSON.stringify(r);
        if (keys.has(k)) continue;
        keys.add(k);
        ranges.push(r);
      }
    }
    if (versions.length > 200) truncated = true;
    if (!ranges.length && !all && !truncated) continue;
    out.push({ vendor, product, ranges, ...(all ? { all: true } : {}), ...(truncated ? { truncated: true } : {}) });
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
