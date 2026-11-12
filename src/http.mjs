// 외부 호출 공통 처리: 시간 상한, 재시도(429·5xx·네트워크 오류), 응답 크기 상한, 문자 인코딩.
import { setTimeout as sleep } from 'node:timers/promises';

export const USER_AGENT = 'Mozilla/5.0 (compatible; sec-brief/2.0; +https://github.com/)';

// 재시도 대기 배율. 시험에서만 0 으로 줄인다.
let backoffScale = 1;
export function setBackoffScale(x) {
  backoffScale = x;
}
const wait = (ms) => sleep(ms * backoffScale);

export class HttpError extends Error {
  constructor(message, { status = 0, url = '', body = '', code = '' } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    this.body = body;
    this.code = code; // 응답을 못 받은 경우의 원인(ECONNRESET·TimeoutError 등)
  }
}

// 요청이 서버에 닿지 않은 것이 확실한 연결 오류: 주소를 못 찾음·연결 거부·연결 맺기 시간 초과
const NOT_SENT = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT']);
/** 응답을 못 받았지만 요청은 나가지 않은 것이 확실한가(다시 보내도 두 번 처리되지 않음) */
export function surelyNotSent(err) {
  return NOT_SENT.has(err?.cause?.code || err?.code);
}

function charsetOf(contentType, head) {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType || '');
  if (fromHeader) return fromHeader[1].toLowerCase();
  const fromXml = /<\?xml[^>]*encoding=["']([\w-]+)["']/i.exec(head);
  if (fromXml) return fromXml[1].toLowerCase();
  const fromMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head);
  return fromMeta ? fromMeta[1].toLowerCase() : 'utf-8';
}

async function readBody(res, maxBytes) {
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new HttpError(`응답이 너무 큼(${Math.round(maxBytes / 1048576)}MB 초과)`);
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

function decode(bytes, contentType) {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 512));
  let charset = charsetOf(contentType, head);
  if (charset === 'ks_c_5601-1987' || charset === 'cp949') charset = 'euc-kr';
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function describeError(err) {
  const cause = err?.cause;
  const code = cause?.code || err?.code;
  if (err?.name === 'AbortError' || err?.name === 'TimeoutError') return err.message || '시간 초과';
  if (code === 'ENOTFOUND') return `주소를 찾지 못함(${cause?.hostname || ''})`;
  if (code === 'ECONNREFUSED') return '연결 거부';
  if (code === 'ECONNRESET') return '연결이 끊김';
  if (code) return `${code}${cause?.message ? `: ${cause.message}` : ''}`;
  return err?.message || String(err);
}

function retryDelay(res, attempt, base) {
  const ra = res?.headers?.get?.('retry-after');
  const sec = ra && /^\d+$/.test(ra) ? Number(ra) : 0;
  if (sec > 0) return Math.min(sec, 60) * 1000;
  return base * 2 ** (attempt - 1);
}

/**
 * idempotent=false(메일·메시지 발송처럼 두 번 처리되면 안 되는 요청): 시간 초과·연결 끊김처럼 서버가 이미 받았을 수 있는
 * 경우에는 다시 보내지 않는다. 연결 전에 실패한 것이 확실할 때(surelyNotSent)와 retryOn 의 응답 코드만 다시 보낸다.
 * @returns {Promise<{status:number, headers:Headers, text:string}>}
 */
export async function request(url, opts = {}) {
  const {
    method = 'GET',
    headers = {},
    body,
    timeoutMs = 30000,
    retries = 2,
    retryOn = [429, 500, 502, 503, 504],
    backoffMs = 2000,
    maxBytes = 20 * 1024 * 1024,
    idempotent = true,
  } = opts;
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      const e = new Error(`시간 초과(${Math.round(timeoutMs / 1000)}초)`);
      e.name = 'TimeoutError';
      ctrl.abort(e);
    }, timeoutMs);
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: { 'user-agent': USER_AGENT, ...headers },
        body,
        signal: ctrl.signal,
        redirect: 'follow',
      });
      const bytes = await readBody(res, maxBytes);
      const text = decode(bytes, res.headers.get('content-type'));
      if (!res.ok) {
        if (attempt < retries && retryOn.includes(res.status)) {
          await wait(retryDelay(res, attempt + 1, backoffMs));
          continue;
        }
        throw new HttpError(`HTTP ${res.status}`, { status: res.status, url, body: text.slice(0, 2000) });
      }
      return { status: res.status, headers: res.headers, text };
    } catch (err) {
      if (err instanceof HttpError) throw err;
      const reason = ctrl.signal.aborted ? ctrl.signal.reason : err;
      if (attempt < retries && (idempotent || surelyNotSent(err))) {
        await wait(backoffMs * (attempt + 1));
        continue;
      }
      throw new HttpError(describeError(reason), { url, code: reason?.cause?.code || reason?.code || reason?.name || '' });
    } finally {
      clearTimeout(timer);
    }
  }
}

export async function getText(url, opts) {
  return (await request(url, opts)).text;
}

export async function getJson(url, opts) {
  const { text, status } = await request(url, opts);
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(`JSON 이 아닌 응답(HTTP ${status})`, { status, url, body: text.slice(0, 300) });
  }
}
