// Outlook.com(개인 Microsoft 계정, 예: @outlook.kr)으로 메일 보내기 — Microsoft Graph /me/sendMail
//
// Outlook.com 은 비밀번호 방식 SMTP 를 막았고(OAuth 만), 새 계정은 SMTP 자체가 꺼진 경우가 많아 Graph 메일 API 를 쓴다.
// 토큰 운영 (카카오와 같은 방식)
// - 처음 한 번 로컬에서 `mail-login` 으로 로그인해 리프레시 토큰을 받아 OUTLOOK_REFRESH_TOKEN 에 넣는다.
// - 매일 실행 때 리프레시 토큰으로 액세스 토큰을 받는다. 응답마다 새 리프레시 토큰이 온다(옛 값도 만료 전까지는 유효).
//   새 값은 data/mail-state.json 에 AES-256-GCM 으로 암호화해 커밋한다. 키는 OUTLOOK_REFRESH_TOKEN(비밀값)에서 유도.
// - 리프레시 토큰은 오래(약 90일) 쓰지 않으면 만료된다. 매일 실행되는 한 다시 로그인할 일이 없다.
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { secret } from './config.mjs';
import { HttpError, request } from './http.mjs';
import { currentRefreshToken, encryptToken, openBrowser, seedId, waitForCode } from './kakao.mjs';
import { writeAtomic } from './store.mjs';
import { kstIso } from './util.mjs';

export const SCOPES = 'offline_access https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/User.Read';
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RELOGIN = '로컬에서 `node src/cli.mjs mail-login` 을 다시 실행해 새 값을 OUTLOOK_REFRESH_TOKEN 에 넣으세요.';
// 계정 정지·서비스 남용 모드는 토큰이 아니라 계정 문제라 사람이 직접 풀어야 한다
const LOCKED = `Microsoft 가 스팸 의심으로 이 계정을 묶었습니다(토큰 문제 아님). account.microsoft.com 에 로그인해 안내대로(휴대폰 보안 코드 등) 계정을 푼 뒤, ${RELOGIN}`;

const HINTS = {
  invalid_grant: `리프레시 토큰이 만료됐거나 무효입니다(오래 쓰지 않았거나 비밀번호를 바꿨거나 권한을 취소함). ${RELOGIN}`,
  unauthorized_client: "앱 등록의 '지원되는 계정 유형'이 개인 Microsoft 계정을 포함하지 않습니다. '개인 Microsoft 계정만'으로 새로 등록하세요.",
  invalid_client: "앱이 클라이언트 비밀을 요구합니다. 리디렉션 URI 를 '웹'이 아니라 '퍼블릭 클라이언트/네이티브(모바일 및 데스크톱)'에 등록하세요.",
  AADSTS700016: "응용 프로그램(클라이언트) ID 를 찾지 못했습니다. OUTLOOK_CLIENT_ID 값과 앱 등록의 '지원되는 계정 유형'(개인 Microsoft 계정)을 확인하세요.",
  AADSTS50011: "리디렉션 URI 가 맞지 않습니다. 앱 등록 > 인증 > '퍼블릭 클라이언트/네이티브(모바일 및 데스크톱)'에 http://localhost 를 넣으세요.",
  AADSTS65001: `메일 보내기 권한에 동의하지 않았습니다. ${RELOGIN}`,
  ErrorAccessDenied: "메일 보내기 권한(Mail.Send)이 없습니다. 앱 등록 > API 사용 권한 > Microsoft Graph > 위임된 권한 > Mail.Send 를 추가하고 mail-login 을 다시 하세요.",
  InvalidAuthenticationToken: `액세스 토큰이 거절됐습니다. 계속되면 ${RELOGIN}`,
  ErrorMessageSubmissionBlocked: 'Outlook.com 이 이 계정의 발송을 막았습니다(새 계정 확인·스팸 의심 등). outlook.com 에 로그인해 안내(휴대폰 확인 등)를 따르세요.',
  ErrorAccountSuspend: LOCKED,
  ErrorSubmissionQuotaExceeded: 'Outlook.com 의 하루 발송 한도를 넘었습니다. 내일 다시 보냅니다.',
  MailboxNotEnabledForRESTAPI: '이 계정의 사서함에서 메일 API 를 쓸 수 없습니다. outlook.com 에 한 번 로그인해 받은 편지함을 연 뒤 다시 시도하세요.',
};

export class OutlookError extends Error {
  constructor(status, info) {
    const graph = info?.error && typeof info.error === 'object' ? info.error : null;
    const oauth = graph ? '' : String(info?.error || '');
    const aad = Array.isArray(info?.error_codes) && info.error_codes.length ? `AADSTS${info.error_codes[0]}` : '';
    const code = graph?.code || aad || oauth;
    // Microsoft 오류 설명 끝의 'Trace ID ...' 꼬리는 뗀다
    const text = String(graph?.message || info?.error_description || info?.msg || `HTTP ${status}`).replace(/\s*Trace ID:[\s\S]*$/, '').slice(0, 300);
    // 'service abuse mode' 는 invalid_grant(AADSTS70000)로 오지만 만료된 토큰이 아니다
    const hint = (/service abuse mode/i.test(text) && LOCKED) || HINTS[graph?.code] || HINTS[aad] || HINTS[oauth] || '';
    const prefix = graph?.code ? `${graph.code}: ` : oauth && oauth !== code ? `${oauth} ` : '';
    super(`Outlook ${prefix}${text}${hint ? ` / ${hint}` : ''}`);
    this.name = 'OutlookError';
    this.status = status;
    this.code = code;
    this.oauth = oauth;
  }
}

function bases(env = process.env) {
  return {
    auth: (env.OUTLOOK_AUTH_BASE || 'https://login.microsoftonline.com/consumers/oauth2/v2.0').replace(/\/+$/, ''),
    graph: (env.GRAPH_BASE || 'https://graph.microsoft.com/v1.0').replace(/\/+$/, ''),
  };
}

async function call(url, { method = 'POST', form, json, headers = {}, retries = 0, retryOn = [502, 503, 504] }) {
  const body = form ? new URLSearchParams(form).toString() : json ? JSON.stringify(json) : undefined;
  const type = form ? { 'content-type': 'application/x-www-form-urlencoded' } : json ? { 'content-type': 'application/json' } : {};
  try {
    const res = await request(url, { method, headers: { ...type, ...headers }, body, timeoutMs: 30000, retries, retryOn });
    return res.text ? JSON.parse(res.text) : {};
  } catch (err) {
    if (err instanceof HttpError && err.body) {
      let info;
      try {
        info = JSON.parse(err.body);
      } catch {
        info = { msg: err.body.slice(0, 200) };
      }
      throw new OutlookError(err.status, info);
    }
    throw err;
  }
}

export function refreshAccessToken({ clientId, refreshToken, env }) {
  return call(`${bases(env).auth}/token`, {
    form: { client_id: clientId, grant_type: 'refresh_token', refresh_token: refreshToken, scope: SCOPES },
    retries: 1,
  });
}

export function exchangeCode({ clientId, code, redirectUri, verifier, env }) {
  return call(`${bases(env).auth}/token`, {
    form: { client_id: clientId, grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier, scope: SCOPES },
  });
}

/** 로그인한 계정의 주소 */
export async function getAccount(accessToken, { env } = {}) {
  const me = await call(`${bases(env).graph}/me?$select=displayName,mail,userPrincipalName`, {
    method: 'GET',
    headers: { authorization: `Bearer ${accessToken}` },
    retries: 1,
  });
  return { address: me.mail || me.userPrincipalName || '', name: me.displayName || '' };
}

/**
 * 메일 발송(202 Accepted). 같은 메일이 두 번 가지 않게 처리되지 않았다는 응답(429·503)에만 한 번 다시 보낸다.
 * 보낸 편지함에는 남기지 않는다.
 */
export async function sendGraphMail(accessToken, { subject, html, to, bcc = [], env }) {
  const list = (xs) => xs.map((address) => ({ emailAddress: { address } }));
  await call(`${bases(env).graph}/me/sendMail`, {
    headers: { authorization: `Bearer ${accessToken}` },
    json: {
      message: { subject, body: { contentType: 'HTML', content: html }, toRecipients: list(to), ...(bcc.length ? { bccRecipients: list(bcc) } : {}) },
      saveToSentItems: false,
    },
    retries: 1,
    retryOn: [429, 503],
  });
}

// ------------------------------------------------------------------ 토큰 상태 (data/mail-state.json, 암호화)

export function outlookConfigured(env = process.env) {
  return Boolean(secret('OUTLOOK_CLIENT_ID', env) && secret('OUTLOOK_REFRESH_TOKEN', env));
}

export function mask(value, env = process.env) {
  if (value && env.GITHUB_ACTIONS === 'true') console.log(`::add-mask::${value}`);
}

function loadState(path) {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * 액세스 토큰 얻기 + 새 리프레시 토큰을 암호화해 바로 저장(발송이 실패해도 잃지 않게)
 * @returns {Promise<{accessToken:string, rotated:boolean, state:object}>}
 */
export async function obtainAccessToken(path, { env = process.env, log = console.log } = {}) {
  const clientId = secret('OUTLOOK_CLIENT_ID', env);
  const seed = secret('OUTLOOK_REFRESH_TOKEN', env);
  const state = loadState(path);
  const cur = currentRefreshToken(state, seed, 'outlook');
  let tok;
  try {
    tok = await refreshAccessToken({ clientId, refreshToken: cur.token, env });
  } catch (err) {
    // 저장된 값이 안 되면 비밀값(처음 로그인 때 받은 값)으로 한 번 더
    if (cur.from === 'state' && err instanceof OutlookError && err.oauth === 'invalid_grant') {
      log('  저장된 Outlook 리프레시 토큰이 거절되어 OUTLOOK_REFRESH_TOKEN 값으로 다시 시도합니다.');
      tok = await refreshAccessToken({ clientId, refreshToken: seed, env });
      cur.token = seed;
    } else {
      throw err;
    }
  }
  if (!tok.access_token) throw new OutlookError(200, { msg: '토큰 응답에 access_token 이 없습니다.' });
  mask(tok.access_token, env);
  const next = { version: 1, ...state, seed: seedId(seed), refreshed_at: kstIso() };
  let rotated = false;
  if (tok.refresh_token && tok.refresh_token !== cur.token) {
    mask(tok.refresh_token, env);
    next.token = encryptToken(seed, { refresh_token: tok.refresh_token }, 'outlook');
    next.rotated_at = kstIso();
    rotated = true;
  } else if (!state.token || state.seed !== next.seed) {
    next.token = encryptToken(seed, { refresh_token: cur.token }, 'outlook');
  }
  writeAtomic(path, `${JSON.stringify(next, null, 2)}\n`);
  return { accessToken: tok.access_token, rotated, state: next };
}

// ------------------------------------------------------------------ 처음 한 번: 로그인 도우미

/**
 * 브라우저로 Microsoft 로그인(인가 코드 + PKCE, 클라이언트 비밀 없음) → 토큰 발급 → 계정 확인
 * → 그 계정으로 확인 메일 발송 → 리프레시 토큰 반환
 * @param {{subject:string, html:string}} message 확인 메일
 */
export async function outlookLogin({ port = 8766, env = process.env, log = console.log, ask, open = true, message }) {
  const clientId = secret('OUTLOOK_CLIENT_ID', env) || (await ask('애플리케이션(클라이언트) ID: ')).trim();
  if (!GUID_RE.test(clientId)) {
    throw new Error("애플리케이션(클라이언트) ID 는 '0a1b2c3d-…' 꼴(8-4-4-4-12자리)입니다. 앱 등록의 '개요' 화면에서 복사하세요.");
  }
  // 등록한 주소는 http://localhost — localhost 는 포트가 달라도 같은 주소로 본다(Microsoft 규칙)
  const redirectUri = `http://localhost:${port}`;
  const state = randomBytes(16).toString('hex');
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const authUrl = `${bases(env).auth}/authorize?${new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  })}`;
  // 주소를 보여 주기 전에 콜백을 받을 로컬 서버부터 연다
  const waiting = waitForCode({ port, state, path: '/', label: 'Microsoft' });
  log('');
  log(`사용할 애플리케이션 ID: ${clientId}`);
  log(`리디렉션 URI         : ${redirectUri} (앱 등록에는 http://localhost 로 등록)`);
  log('');
  log('1) 브라우저에서 메일을 보낼 Outlook 계정(예: …@outlook.kr)으로 로그인하고 권한 요청에 동의하세요.');
  log('   (메일 보내기·기본 프로필 읽기 — 받은 메일을 읽는 권한은 요청하지 않습니다)');
  log(`   브라우저가 열리지 않으면 이 주소를 직접 여세요:\n   ${authUrl}`);
  log('2) 브라우저에 오류가 나오면:');
  log("   AADSTS50011 → 리디렉션 URI 를 '퍼블릭 클라이언트/네이티브(모바일 및 데스크톱)'에 http://localhost 로 등록했는지");
  log("   AADSTS700016·unauthorized_client → ID 가 맞는지, '지원되는 계정 유형'이 '개인 Microsoft 계정만'인지");
  log('   (끝내려면 Ctrl+C)');
  log('');
  if (open) openBrowser(authUrl);
  let code;
  try {
    code = await waiting;
  } catch (err) {
    const m = /AADSTS\d+|unauthorized_client|invalid_client/.exec(err.message);
    throw new Error(m && HINTS[m[0]] ? `${err.message} / ${HINTS[m[0]]}` : err.message);
  }
  const tok = await exchangeCode({ clientId, code, redirectUri, verifier, env });
  if (!tok.refresh_token) throw new Error('리프레시 토큰을 받지 못했습니다(offline_access 동의 필요). 다시 로그인하세요.');
  const account = await getAccount(tok.access_token, { env });
  let sent = false;
  if (message && account.address) {
    try {
      await sendGraphMail(tok.access_token, { subject: message.subject, html: message.html, to: [account.address], env });
      sent = true;
    } catch (err) {
      log(`  ! 확인 메일 발송 실패: ${err.message}`);
    }
  }
  return { clientId, refreshToken: tok.refresh_token, scopes: String(tok.scope || ''), account, sent };
}
