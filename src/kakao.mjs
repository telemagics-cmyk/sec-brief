// 카카오톡 '나에게 보내기'
//
// 토큰 운영
// - 처음 한 번 로컬에서 `kakao-login` 으로 리프레시 토큰(약 60일)을 받아 KAKAO_REFRESH_TOKEN 에 넣는다.
// - 매일 실행 때 리프레시 토큰으로 액세스 토큰을 새로 받는다.
// - 리프레시 토큰은 남은 기간이 1개월 미만일 때 갱신 응답에 새 값이 오고, 그 순간 옛 값은 만료된다.
//   새 값은 data/kakao-state.json 에 AES-256-GCM 으로 암호화해 저장소에 커밋한다.
//   암호 키는 KAKAO_REFRESH_TOKEN(비밀값)에서 HKDF 로 만든다 — 저장소만으로는 풀 수 없다.
// - KAKAO_REFRESH_TOKEN 을 새로 넣으면(다시 로그인) 저장된 상태보다 새 값을 우선한다.
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { buildKakaoTemplate } from './brief.mjs';
import { secret } from './config.mjs';
import { HttpError, request } from './http.mjs';
import { writeAtomic } from './store.mjs';
import { kstIso, sha256 } from './util.mjs';

const HINTS = {
  KOE322: '리프레시 토큰이 만료됐거나 무효입니다. 로컬에서 `node src/cli.mjs kakao-login` 을 다시 실행해 새 값을 KAKAO_REFRESH_TOKEN 에 넣으세요.',
  KOE010: '클라이언트 시크릿이 맞지 않습니다. [앱] > [플랫폼 키] > [REST API 키] > [클라이언트 시크릿] 값을 KAKAO_CLIENT_SECRET 에 넣으세요.',
  KOE101: 'REST API 키(KAKAO_REST_API_KEY)가 맞지 않습니다. [앱] > [플랫폼 키] > [REST API 키] 값을 확인하세요.',
  KOE006: '리다이렉트 URI 가 등록되지 않았습니다. [앱] > [플랫폼 키] > [REST API 키] > 카카오 로그인 리다이렉트 URI 에 안내된 주소를 똑같이 등록하세요.',
  KOE004: '카카오 로그인이 꺼져 있습니다. [카카오 로그인] > [사용 설정] 의 상태를 ON 으로 바꾸세요.',
  KOE237: '토큰 요청이 너무 잦습니다. 잠시 뒤 다시 시도하세요.',
  KOE320: '인가 코드가 만료됐거나 이미 쓰였습니다. 로그인을 처음부터 다시 하세요.',
  KOE205: '동의항목 설정이 맞지 않습니다. [카카오 로그인] > [동의항목] > [접근권한] 에서 카카오톡 메시지 전송을 설정하세요.',
  '-401': '액세스 토큰이 유효하지 않습니다(만료 또는 연결 끊김). kakao-login 을 다시 실행하세요.',
  '-402': '카카오톡 메시지 전송 동의가 없습니다. [카카오 로그인] > [동의항목] > [접근권한] 에서 카카오톡 메시지 전송을 설정한 뒤 kakao-login 을 다시 실행하세요.',
  '-3': '이 앱에서 카카오톡 메시지 API 를 쓸 수 없습니다. 동의항목(카카오톡 메시지 전송) 설정을 확인하세요.',
  '-2': '메시지 형식이 맞지 않습니다(템플릿 오류).',
};

export class KakaoError extends Error {
  constructor(status, info) {
    const code = info.error_code || (info.code !== undefined ? String(info.code) : '');
    const text = info.error_description || info.msg || info.error || `HTTP ${status}`;
    super(`카카오 ${code ? `${code} ` : ''}${text}${HINTS[code] ? ` / ${HINTS[code]}` : ''}`);
    this.name = 'KakaoError';
    this.status = status;
    this.code = code;
  }
}

function bases(env = process.env) {
  return {
    auth: (env.KAKAO_AUTH_BASE || 'https://kauth.kakao.com').replace(/\/+$/, ''),
    api: (env.KAKAO_API_BASE || 'https://kapi.kakao.com').replace(/\/+$/, ''),
  };
}

async function call(url, { method = 'POST', form, headers = {}, retries = 0 }) {
  try {
    const res = await request(url, {
      method,
      headers: form ? { 'content-type': 'application/x-www-form-urlencoded;charset=utf-8', ...headers } : headers,
      body: form ? new URLSearchParams(form).toString() : undefined,
      timeoutMs: 20000,
      retries,
      retryOn: [502, 503, 504],
    });
    return JSON.parse(res.text);
  } catch (err) {
    if (err instanceof HttpError && err.body) {
      let info;
      try {
        info = JSON.parse(err.body);
      } catch {
        info = { msg: err.body.slice(0, 200) };
      }
      throw new KakaoError(err.status, info);
    }
    throw err;
  }
}

export function refreshAccessToken({ clientId, clientSecret, refreshToken, env }) {
  const form = { grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken };
  if (clientSecret) form.client_secret = clientSecret;
  return call(`${bases(env).auth}/oauth/token`, { form, retries: 1 });
}

export function exchangeCode({ clientId, clientSecret, redirectUri, code, env }) {
  const form = { grant_type: 'authorization_code', client_id: clientId, redirect_uri: redirectUri, code };
  if (clientSecret) form.client_secret = clientSecret;
  return call(`${bases(env).auth}/oauth/token`, { form });
}

export function getMe(accessToken, { env } = {}) {
  return call(`${bases(env).api}/v2/user/me`, { method: 'GET', headers: { authorization: `Bearer ${accessToken}` } });
}

/** 같은 메시지가 두 번 가지 않게 발송은 재시도하지 않는다. */
export async function sendMemo(accessToken, templateObject, { env } = {}) {
  const res = await call(`${bases(env).api}/v2/api/talk/memo/default/send`, {
    form: { template_object: JSON.stringify(templateObject) },
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (res.result_code !== 0) throw new KakaoError(200, { msg: `예상과 다른 응답: ${JSON.stringify(res).slice(0, 200)}` });
  return res;
}

// ------------------------------------------------------------------ 토큰 상태 (암호화)

function keyFrom(seed) {
  return Buffer.from(hkdfSync('sha256', Buffer.from(seed, 'utf8'), Buffer.from('sec-brief/kakao'), Buffer.from('refresh-token-state/v1'), 32));
}

export function seedId(seed) {
  return sha256(`sec-brief:${seed}`).slice(0, 16);
}

export function encryptToken(seed, payload) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', keyFrom(seed), iv);
  const data = Buffer.concat([c.update(JSON.stringify(payload), 'utf8'), c.final()]);
  return { alg: 'A256GCM', iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
}

export function decryptToken(seed, box) {
  const d = createDecipheriv('aes-256-gcm', keyFrom(seed), Buffer.from(box.iv, 'base64'));
  d.setAuthTag(Buffer.from(box.tag, 'base64'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(box.data, 'base64')), d.final()]).toString('utf8'));
}

export function statePath(cfg) {
  return join(cfg.dataDir, 'kakao-state.json');
}

export function loadState(path) {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

function saveState(path, state) {
  writeAtomic(path, `${JSON.stringify(state, null, 2)}\n`);
}

/** 지금 쓸 리프레시 토큰: 시드가 같으면 저장된(갱신된) 값, 아니면 시드 */
export function currentRefreshToken(state, seed) {
  if (state?.seed === seedId(seed) && state.token) {
    try {
      const v = decryptToken(seed, state.token);
      if (v?.refresh_token) return { token: v.refresh_token, from: 'state' };
    } catch {
      // 키가 맞지 않거나 파일이 손상됨 → 시드로
    }
  }
  return { token: seed, from: 'seed' };
}

function mask(value, env) {
  if (value && env.GITHUB_ACTIONS === 'true') console.log(`::add-mask::${value}`);
}

export function kakaoConfigured(env = process.env) {
  return Boolean(secret('KAKAO_REST_API_KEY', env) && secret('KAKAO_REFRESH_TOKEN', env));
}

/**
 * 액세스 토큰 얻기 + 바뀐 리프레시 토큰 저장
 * @returns {Promise<{accessToken:string, rotated:boolean, state:object}>}
 */
export async function obtainAccessToken(cfg, { env = process.env, log = console.log } = {}) {
  const clientId = secret('KAKAO_REST_API_KEY', env);
  const clientSecret = secret('KAKAO_CLIENT_SECRET', env);
  const seed = secret('KAKAO_REFRESH_TOKEN', env);
  const path = statePath(cfg);
  const state = loadState(path);
  const cur = currentRefreshToken(state, seed);
  let tok;
  try {
    tok = await refreshAccessToken({ clientId, clientSecret, refreshToken: cur.token, env });
  } catch (err) {
    // 저장된 값이 안 되면 시드로 한 번 더 (시드가 아직 살아 있는 경우)
    if (cur.from === 'state' && err instanceof KakaoError && err.code === 'KOE322') {
      log('  저장된 리프레시 토큰이 거절되어 KAKAO_REFRESH_TOKEN 값으로 다시 시도합니다.');
      tok = await refreshAccessToken({ clientId, clientSecret, refreshToken: seed, env });
      cur.token = seed;
    } else {
      throw err;
    }
  }
  mask(tok.access_token, env);
  const next = { version: 1, ...state, seed: seedId(seed), refreshed_at: kstIso() };
  let rotated = false;
  if (tok.refresh_token && tok.refresh_token !== cur.token) {
    mask(tok.refresh_token, env);
    next.token = encryptToken(seed, { refresh_token: tok.refresh_token });
    next.rotated_at = kstIso();
    next.refresh_expires_at = tok.refresh_token_expires_in
      ? new Date(Date.now() + Number(tok.refresh_token_expires_in) * 1000).toISOString()
      : null;
    rotated = true;
    log(`  카카오 리프레시 토큰이 갱신되어 암호화해 저장했습니다(만료 ${next.refresh_expires_at?.slice(0, 10) ?? '알 수 없음'}).`);
  } else if (!state.token || state.seed !== next.seed) {
    next.token = encryptToken(seed, { refresh_token: cur.token });
  }
  // 발송이 실패해도 새 토큰을 잃지 않게 바로 저장한다
  saveState(path, next);
  return { accessToken: tok.access_token, rotated, state: next, path };
}

export function testTemplate(cfg) {
  const url = cfg.site.url ? `${cfg.site.url}/` : '';
  return {
    object_type: 'text',
    text: `[${cfg.site.title}] 카카오톡 연결 확인 메시지입니다. 이 메시지가 보이면 설정이 끝났습니다.${url ? '\n아래 버튼으로 웹 이력을 열 수 있습니다.' : ''}`,
    link: { web_url: url, mobile_web_url: url },
    ...(url ? { button_title: '웹 이력 열기' } : {}),
  };
}

/**
 * 브리핑 발송. 같은 날짜는 한 번만 보낸다(--force 로 다시).
 * @returns {Promise<{sent:boolean, skipped?:boolean, reason?:string, template?:string, rotated?:boolean}>}
 */
export async function sendBrief(cfg, brief, { test = false, force = false, env = process.env, log = console.log } = {}) {
  if (!kakaoConfigured(env)) {
    return { sent: false, skipped: true, reason: '카카오톡 설정이 없어 발송을 건너뜁니다 (KAKAO_REST_API_KEY·KAKAO_REFRESH_TOKEN).' };
  }
  const path = statePath(cfg);
  const before = loadState(path);
  if (!test && !force && brief && before.last_sent === brief.date) {
    return { sent: false, skipped: true, reason: `${brief.date} 브리핑은 이미 보냈습니다 (다시 보내려면 --force).` };
  }
  const { accessToken, rotated, state } = await obtainAccessToken(cfg, { env, log });
  const template = test || !brief ? testTemplate(cfg) : buildKakaoTemplate(brief, { siteUrl: cfg.site.url, template: cfg.kakao.template });
  await sendMemo(accessToken, template, { env });
  if (!test && brief) {
    saveState(path, { ...state, last_sent: brief.date, last_sent_at: kstIso() });
  }
  return { sent: true, template: template.object_type, rotated };
}

// ------------------------------------------------------------------ 처음 한 번: 로그인 도우미

function openBrowser(url) {
  try {
    const [cmd, args] =
      process.platform === 'win32'
        ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
        : process.platform === 'darwin'
          ? ['open', [url]]
          : ['xdg-open', [url]];
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
    return true;
  } catch {
    return false;
  }
}

const DONE_PAGE = (ok, msg) => `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>카카오 로그인 ${ok ? '완료' : '실패'}</title><body style="font-family:system-ui,'Malgun Gothic',sans-serif;max-width:560px;margin:60px auto;padding:0 16px;line-height:1.6">
<h1 style="font-size:22px">${ok ? '로그인 완료' : '로그인 실패'}</h1><p>${msg}</p><p>이 창을 닫고 터미널로 돌아가세요.</p></body></html>`;

/** 인가 코드를 받을 때까지 로컬 서버를 연다. */
export function waitForCode({ port, state, timeoutMs = 5 * 60 * 1000, host = '127.0.0.1' }) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const u = new URL(req.url, `http://localhost:${port}`);
      if (u.pathname !== '/oauth') {
        res.writeHead(404).end();
        return;
      }
      const finish = (ok, msg, value) => {
        res.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8' }).end(DONE_PAGE(ok, msg));
        clearTimeout(timer);
        server.close();
        if (ok) resolve(value);
        else reject(new Error(msg));
      };
      // 확인값이 다른 요청(다른 탭·위조 요청)은 거절만 하고 진짜 콜백을 계속 기다린다
      if (u.searchParams.get('state') !== state) {
        res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' }).end(DONE_PAGE(false, '요청 확인값(state)이 맞지 않아 무시했습니다.'));
        return undefined;
      }
      if (u.searchParams.get('error')) {
        return finish(false, `카카오가 오류를 돌려줬습니다: ${u.searchParams.get('error')} ${u.searchParams.get('error_description') || ''}`.trim());
      }
      const code = u.searchParams.get('code');
      if (!code) return finish(false, '인가 코드가 없습니다.');
      return finish(true, '인가 코드를 받았습니다. 토큰을 발급하는 중입니다.', code);
    });
    const timer = setTimeout(() => {
      server.close();
      reject(new Error(`${Math.round(timeoutMs / 60000)}분 안에 로그인이 끝나지 않았습니다.`));
    }, timeoutMs);
    server.on('error', (err) => {
      clearTimeout(timer);
      reject(err.code === 'EADDRINUSE' ? new Error(`포트 ${port} 를 이미 쓰고 있습니다. --port 로 다른 번호를 주고, 그 주소를 리다이렉트 URI 로 등록하세요.`) : err);
    });
    server.listen(port, host);
  });
}

/**
 * 처음 한 번: 브라우저로 카카오 로그인 → 토큰 발급 → 사용자 정보 확인(가입 미완료 자동 연결 끊김 방지)
 * → 확인 메시지 발송 → 리프레시 토큰 안내
 */
export async function kakaoLogin(cfg, { port = 8765, env = process.env, log = console.log, ask, open = true } = {}) {
  const clientId = secret('KAKAO_REST_API_KEY', env) || (await ask('REST API 키: ')).trim();
  if (!clientId) throw new Error('REST API 키가 필요합니다.');
  let clientSecret = secret('KAKAO_CLIENT_SECRET', env);
  if (!clientSecret) clientSecret = (await ask('클라이언트 시크릿 (사용 안 하면 Enter): ')).trim();
  const redirectUri = `http://localhost:${port}/oauth`;
  const state = randomBytes(16).toString('hex');
  const authUrl = `${bases(env).auth}/oauth/authorize?${new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'talk_message',
    state,
  })}`;
  const masked = clientId.length > 8 ? `${clientId.slice(0, 4)}…${clientId.slice(-4)} (${clientId.length}자)` : '(짧은 값 — 키를 다시 확인)';
  log('');
  log(`사용할 REST API 키: ${masked}`);
  log(`리다이렉트 URI   : ${redirectUri}`);
  log('');
  log('1) 카카오 개발자 콘솔에 위 주소가 그대로 등록돼 있어야 합니다.');
  log('     [앱] > [플랫폼 키] > [REST API 키] (위 키와 앞뒤 4글자가 같은 키) > 카카오 로그인 리다이렉트 URI');
  log('2) 브라우저에서 카카오 로그인 후 "카카오톡 메시지 전송"에 동의하세요.');
  log(`   브라우저가 열리지 않으면 이 주소를 직접 여세요:\n   ${authUrl}`);
  log('3) 브라우저에 KOE006 이 나오면: 위 키와 콘솔의 REST API 키가 같은지, 주소를 "비즈니스 인증" 칸이 아닌');
  log('   "카카오 로그인 리다이렉트 URI" 칸에 넣고 저장했는지 확인하세요. (끝내려면 Ctrl+C)');
  log('');
  const waiting = waitForCode({ port, state });
  if (open) openBrowser(authUrl);
  const code = await waiting;
  const tok = await exchangeCode({ clientId, clientSecret, redirectUri, code, env });
  const scopes = String(tok.scope || '');
  // 로그인 뒤 24시간 안에 사용자 정보 API 를 한 번 부르지 않으면 카카오가 연결을 끊는다(가입 미완료 처리).
  const me = await getMe(tok.access_token, { env });
  let sent = false;
  try {
    await sendMemo(tok.access_token, testTemplate(cfg), { env });
    sent = true;
  } catch (err) {
    log(`  ! 확인 메시지 발송 실패: ${err.message}`);
  }
  return {
    refreshToken: tok.refresh_token,
    refreshExpiresIn: tok.refresh_token_expires_in,
    accessExpiresIn: tok.expires_in,
    scopes,
    userId: me?.id,
    sent,
    clientId,
    clientSecret,
  };
}
