// 날짜(KST)·문자열·HTML 처리처럼 여러 모듈이 함께 쓰는 작은 도구들.
import { createHash } from 'node:crypto';

const KST_MS = 9 * 3600 * 1000;
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** Date → 'YYYY-MM-DD' (한국 시간) */
export function kstDate(d = new Date()) {
  return new Date(d.getTime() + KST_MS).toISOString().slice(0, 10);
}

/** Date → '2026-10-23T06:41:02+09:00' */
export function kstIso(d = new Date()) {
  return `${new Date(d.getTime() + KST_MS).toISOString().slice(0, 19)}+09:00`;
}

/** Date → 'YYYY-MM-DD HH:mm' (한국 시간) */
export function kstStamp(d = new Date()) {
  return new Date(d.getTime() + KST_MS).toISOString().slice(0, 16).replace('T', ' ');
}

export function isYmd(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

export function weekdayKo(ymd) {
  return WEEKDAYS[new Date(`${ymd}T00:00:00Z`).getUTCDay()];
}

export function addDays(ymd, n) {
  const t = Date.parse(`${ymd}T00:00:00Z`) + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

/** '2026-10-23' → '10.23(금)' */
export function shortDay(ymd) {
  return `${ymd.slice(5, 7)}.${ymd.slice(8, 10)}(${weekdayKo(ymd)})`;
}

/**
 * RSS·Atom 의 날짜 문자열을 읽는다. 시간대가 없으면 한국 시간으로 본다
 * (국내 언론 RSS 는 '2026-10-23 14:46:14', KISA 는 '2026-10-22' 처럼 준다).
 * @returns {{date: Date, dateOnly: boolean} | null}
 */
export function parseFeedDate(raw) {
  const s = String(raw ?? '').trim().replace(/\s+KST$/i, ' +0900');
  if (!s) return null;
  let m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})\.?$/);
  if (m) {
    const d = new Date(`${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}T00:00:00+09:00`);
    return Number.isNaN(d.getTime()) ? null : { date: d, dateOnly: true };
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/);
  if (m) {
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}+09:00`);
    return Number.isNaN(d.getTime()) ? null : { date: d, dateOnly: false };
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : { date: new Date(t), dateOnly: false };
}

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', bull: '•',
  laquo: '«', raquo: '»', copy: '©', reg: '®', trade: '™', times: '×', rarr: '→', larr: '←',
};

export function decodeEntities(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (all, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : all;
    }
    return NAMED_ENTITIES[e.toLowerCase()] ?? all;
  });
}

/** HTML 조각 → 읽을 수 있는 한 줄 글 (태그 제거, 엔티티 해석, 공백 정리) */
export function cleanText(s) {
  const once = decodeEntities(String(s ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'));
  const noTags = once.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ');
  return decodeEntities(noTags).replace(/[​﻿]/g, '').replace(/\s+/g, ' ').trim();
}

/** 글자 수(코드 포인트) 기준으로 자르고 '…' 를 붙인다. */
export function truncate(s, max) {
  const chars = [...String(s ?? '')];
  if (chars.length <= max) return chars.join('');
  return `${chars.slice(0, Math.max(1, max - 1)).join('').trimEnd()}…`;
}

export function charLength(s) {
  return [...String(s ?? '')].length;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** http(s) 주소만 통과시킨다 (javascript: 같은 것은 빈 문자열). */
export function safeUrl(u) {
  try {
    const url = new URL(String(u ?? '').trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

export function sha256(s) {
  return createHash('sha256').update(String(s)).digest('hex');
}

export function shortHash(s, n = 10) {
  return sha256(s).slice(0, n);
}

/** 중복 판정용 주소: 추적용 쿼리(utm_*)·조각(#)을 뗀다. */
export function canonicalUrl(u) {
  const href = safeUrl(u);
  if (!href) return String(u ?? '').trim();
  const url = new URL(href);
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid|gclid|ref$|_s_id$)/i.test(key)) url.searchParams.delete(key);
  }
  url.hostname = url.hostname.replace(/^(www|m)\./, '');
  return url.href.replace(/\/$/, '');
}

export function uniq(arr) {
  return [...new Set(arr)];
}

export function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** CVE 번호 목록 (문장 안에서 찾기, 대문자로 맞춤) */
export function findCveIds(text) {
  return uniq((String(text ?? '').match(/CVE-\d{4}-\d{4,}/gi) || []).map((x) => x.toUpperCase()));
}

export function fmtPercent(p, digits = 1) {
  if (p === null || p === undefined || Number.isNaN(p)) return '';
  return `${(p * 100).toFixed(digits)}%`;
}
