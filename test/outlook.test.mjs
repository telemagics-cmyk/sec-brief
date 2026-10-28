// 가짜 Microsoft 로그인·Graph 서버로 Outlook.com 메일 발송 흐름을 시험한다 (실제 Microsoft 는 부르지 않는다).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { setBackoffScale } from '../src/http.mjs';
import { decryptToken, seedId, waitForCode } from '../src/kakao.mjs';
import { mailSettings, mailSubject, sendBriefMail } from '../src/mail.mjs';
import { outlookLogin } from '../src/outlook.mjs';
import { sampleBrief } from './fixtures.mjs';

const CLIENT = '0a1b2c3d-1111-2222-3333-444455556666';
const calls = [];
const sent = [];
let valid = new Set();
let issued = 0;
let sendError = null;
let expectChallenge = '';
let server;
let base;

const json = (res, status, obj) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(obj));
const aad = (res, error, code, text) =>
  json(res, 400, { error, error_description: `AADSTS${code}: ${text} Trace ID: 1111 Correlation ID: 2222 Timestamp: 2026-10-28 01:00:00Z`, error_codes: [code] });

before(async () => {
  setBackoffScale(0);
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      calls.push({ path: url.pathname, method: req.method, body, auth: req.headers.authorization });
      if (url.pathname === '/auth/token') {
        const f = Object.fromEntries(new URLSearchParams(body));
        if (f.client_id !== CLIENT) return aad(res, 'unauthorized_client', 700016, `Application with identifier '${f.client_id}' was not found.`);
        if (!/Mail\.Send/.test(f.scope) || !/offline_access/.test(f.scope)) return aad(res, 'invalid_scope', 70011, 'bad scope');
        // 2026-10-28 실제 응답: 발송 정지 뒤 토큰 갱신도 이 문구로 막힘
        if (f.refresh_token === 'abused') return aad(res, 'invalid_grant', 70000, 'User account is found to be in service abuse mode.');
        if (f.grant_type === 'refresh_token' && !valid.has(f.refresh_token)) {
          return aad(res, 'invalid_grant', 70000, 'The provided value for the input parameter refresh_token is not valid.');
        }
        if (f.grant_type === 'authorization_code') {
          const hashed = createHash('sha256').update(f.code_verifier || '').digest('base64url');
          if (f.code !== 'code-1' || hashed !== expectChallenge || !/^http:\/\/localhost:\d+$/.test(f.redirect_uri)) {
            return aad(res, 'invalid_grant', 501481, 'The Code_Verifier does not match the code_challenge.');
          }
        }
        issued += 1;
        // Microsoft 처럼 쓸 때마다 새 리프레시 토큰을 주고, 옛 값도 바로 막지는 않는다
        const rt = `rt-${issued}`;
        valid.add(rt);
        return json(res, 200, { token_type: 'Bearer', scope: 'https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/User.Read', expires_in: 3600, access_token: `acc-${issued}`, refresh_token: rt });
      }
      if (!String(req.headers.authorization).startsWith('Bearer acc-')) {
        return json(res, 401, { error: { code: 'InvalidAuthenticationToken', message: 'Access token is empty.' } });
      }
      if (url.pathname === '/graph/me' && req.method === 'GET') {
        return json(res, 200, { displayName: 'Sender', mail: null, userPrincipalName: 'sender@outlook.kr' });
      }
      if (url.pathname === '/graph/me/sendMail' && req.method === 'POST') {
        if (sendError) return json(res, sendError.status, sendError.body);
        sent.push(JSON.parse(body));
        return res.writeHead(202).end();
      }
      return json(res, 404, { error: { code: 'NotFound', message: 'no' } });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  setBackoffScale(1);
  server.close();
});

function setup(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sb-outlook-'));
  const cfg = { dataDir: dir, site: { url: 'https://u.github.io/sec-brief', title: '일일 보안 브리핑' } };
  const env = {
    OUTLOOK_AUTH_BASE: `${base}/auth`,
    GRAPH_BASE: `${base}/graph`,
    OUTLOOK_CLIENT_ID: CLIENT,
    OUTLOOK_REFRESH_TOKEN: 'seed-rt',
    MAIL_TO: 'me@example.org',
    ...extra,
  };
  valid = new Set(['seed-rt']);
  issued = 0;
  sent.length = 0;
  calls.length = 0;
  sendError = null;
  return { dir, cfg, env, state: () => JSON.parse(readFileSync(join(dir, 'mail-state.json'), 'utf8')) };
}

const quiet = () => {};

test('메일 설정: Outlook 비밀값이 있으면 Outlook(SMTP 보다 먼저), 받는 주소는 비워도 됨', () => {
  assert.deepEqual(mailSettings({ OUTLOOK_CLIENT_ID: CLIENT, OUTLOOK_REFRESH_TOKEN: 'x' }), { kind: 'outlook', to: [] });
  assert.equal(mailSettings({ OUTLOOK_CLIENT_ID: CLIENT, OUTLOOK_REFRESH_TOKEN: 'x', SMTP_HOST: 'smtp.gmail.com', MAIL_TO: 'a@x.com' }).kind, 'outlook');
  assert.equal(mailSettings({ SMTP_HOST: 'smtp.gmail.com', MAIL_TO: 'a@x.com' }).kind, 'smtp');
  assert.equal(mailSettings({ OUTLOOK_CLIENT_ID: CLIENT }), null, '리프레시 토큰이 없으면 끔');
});

test('Outlook 발송: 토큰 갱신 → 새 리프레시 토큰은 암호화 저장 → HTML 메일, 기록에 주소·토큰 원문 없음', async () => {
  const { dir, cfg, env, state } = setup();
  const r = await sendBriefMail(cfg, sampleBrief(), { env, log: quiet });
  assert.deepEqual({ sent: r.sent, via: r.via, accepted: r.accepted }, { sent: true, via: 'Outlook', accepted: 1 });
  assert.equal(sent.length, 1);
  const m = sent[0];
  assert.equal(m.saveToSentItems, false, '보낸 편지함에 쌓지 않음');
  assert.equal(m.message.subject, mailSubject(sampleBrief(), '일일 보안 브리핑'));
  assert.equal(m.message.body.contentType, 'HTML');
  assert.match(m.message.body.content, /국내 보안 뉴스/);
  assert.deepEqual(m.message.toRecipients, [{ emailAddress: { address: 'me@example.org' } }]);
  assert.equal(m.message.bccRecipients, undefined);
  const st = state();
  assert.equal(st.last_sent, '2026-10-23');
  assert.equal(st.recipients, 1);
  assert.equal(st.seed, seedId('seed-rt'));
  assert.equal(decryptToken('seed-rt', st.token, 'outlook').refresh_token, 'rt-1');
  assert.throws(() => decryptToken('seed-rt', st.token, 'kakao'), '카카오와 키가 다름');
  const raw = readFileSync(join(dir, 'mail-state.json'), 'utf8');
  for (const bad of ['@', 'rt-1', 'acc-1', 'seed-rt']) assert.ok(!raw.includes(bad), `기록에 ${bad} 가 없어야 함`);
  rmSync(dir, { recursive: true, force: true });
});

test('Outlook: 다음 실행은 저장된 토큰, 같은 날은 한 번만, 저장된 토큰이 거절되면 비밀값으로 다시', async () => {
  const { dir, cfg, env, state } = setup();
  await sendBriefMail(cfg, sampleBrief(), { env, log: quiet });
  const again = await sendBriefMail(cfg, sampleBrief(), { env, log: quiet });
  assert.equal(again.skipped, true);
  assert.equal(sent.length, 1);

  calls.length = 0;
  await sendBriefMail(cfg, sampleBrief(), { env, log: quiet, force: true });
  assert.match(calls[0].body, /refresh_token=rt-1/, '저장된(갱신된) 토큰을 먼저 씀');
  assert.equal(decryptToken('seed-rt', state().token, 'outlook').refresh_token, 'rt-2');

  valid = new Set(['seed-rt']); // 저장된 값만 무효가 된 경우
  const logs = [];
  await sendBriefMail(cfg, sampleBrief(), { env, log: (x) => logs.push(x), force: true });
  assert.ok(logs.some((l) => /OUTLOOK_REFRESH_TOKEN 값으로 다시/.test(l)));
  assert.equal(sent.length, 3);

  // 다시 로그인해 비밀값을 바꾸면 새 값을 우선
  valid = new Set(['seed-NEW']);
  await sendBriefMail(cfg, sampleBrief(), { env: { ...env, OUTLOOK_REFRESH_TOKEN: 'seed-NEW' }, log: quiet, force: true });
  assert.equal(state().seed, seedId('seed-NEW'));
  rmSync(dir, { recursive: true, force: true });
});

test('Outlook: 받는 주소를 비우면 계정 자신에게, 여럿이면 숨은 참조, 연결 확인은 발송 기록을 남기지 않음', async () => {
  let s = setup({ MAIL_TO: '' });
  await sendBriefMail(s.cfg, sampleBrief(), { env: s.env, log: quiet });
  assert.deepEqual(sent[0].message.toRecipients, [{ emailAddress: { address: 'sender@outlook.kr' } }], 'mail 이 비면 userPrincipalName');
  rmSync(s.dir, { recursive: true, force: true });

  s = setup({ MAIL_TO: 'a@example.org; b@example.net' });
  const r = await sendBriefMail(s.cfg, sampleBrief(), { env: s.env, log: quiet });
  assert.equal(r.accepted, 2);
  assert.deepEqual(sent[0].message.toRecipients, [{ emailAddress: { address: 'sender@outlook.kr' } }]);
  assert.deepEqual(sent[0].message.bccRecipients.map((x) => x.emailAddress.address), ['a@example.org', 'b@example.net']);
  rmSync(s.dir, { recursive: true, force: true });

  s = setup();
  await sendBriefMail(s.cfg, null, { env: s.env, log: quiet, test: true });
  assert.match(sent[0].message.subject, /메일 연결 확인/);
  const st = s.state();
  assert.equal(st.last_sent, undefined);
  assert.ok(st.token, '연결 확인 때도 새 토큰은 저장');
  rmSync(s.dir, { recursive: true, force: true });
});

test('Outlook 오류 안내: 만료된 토큰·권한 없음·잘못된 앱 ID, 실패해도 새 토큰은 저장', async () => {
  let s = setup({ OUTLOOK_REFRESH_TOKEN: 'expired' });
  await assert.rejects(sendBriefMail(s.cfg, sampleBrief(), { env: s.env, log: quiet }), (err) => {
    assert.match(err.message, /AADSTS70000/);
    assert.match(err.message, /만료됐거나 무효.*mail-login/);
    assert.ok(!/Trace ID/.test(err.message), '추적 번호 꼬리는 뗌');
    return true;
  });
  rmSync(s.dir, { recursive: true, force: true });

  s = setup();
  sendError = { status: 403, body: { error: { code: 'ErrorAccessDenied', message: 'Access is denied. Check credentials and try again.' } } };
  await assert.rejects(sendBriefMail(s.cfg, sampleBrief(), { env: s.env, log: quiet }), /Outlook ErrorAccessDenied: Access is denied.*Mail\.Send/);
  assert.equal(decryptToken('seed-rt', s.state().token, 'outlook').refresh_token, 'rt-1', '발송이 실패해도 갱신된 토큰은 남음');
  assert.equal(s.state().last_sent, undefined);
  rmSync(s.dir, { recursive: true, force: true });

  s = setup({ OUTLOOK_CLIENT_ID: '99999999-9999-9999-9999-999999999999' });
  await assert.rejects(sendBriefMail(s.cfg, sampleBrief(), { env: s.env, log: quiet }), /unauthorized_client.*AADSTS700016.*지원되는 계정 유형/);
  assert.ok(!existsSync(join(s.dir, 'mail-state.json')));
  rmSync(s.dir, { recursive: true, force: true });
});

test('Outlook 오류 안내: 계정 정지·서비스 남용 모드는 토큰 만료가 아니라 계정 잠금으로 안내', async () => {
  // 2026-10-28 GitHub Actions 에서 실제로 받은 두 응답
  let s = setup();
  sendError = {
    status: 403,
    body: { error: { code: 'ErrorAccountSuspend', message: 'Account suspended. Follow the instructions in your Inbox to verify your account., WASCL UserAction verdict is not None. Actual verdict is Suspend, ShowTierUpgrade.' } },
  };
  await assert.rejects(sendBriefMail(s.cfg, sampleBrief(), { env: s.env, log: quiet }), (err) => {
    assert.match(err.message, /^Outlook ErrorAccountSuspend: Account suspended/);
    assert.match(err.message, /스팸 의심으로 이 계정을 묶었습니다.*휴대폰 보안 코드.*mail-login/);
    return true;
  });
  rmSync(s.dir, { recursive: true, force: true });

  s = setup({ OUTLOOK_REFRESH_TOKEN: 'abused' });
  await assert.rejects(sendBriefMail(s.cfg, sampleBrief(), { env: s.env, log: quiet }), (err) => {
    assert.match(err.message, /invalid_grant AADSTS70000: User account is found to be in service abuse mode/);
    assert.match(err.message, /휴대폰 보안 코드/);
    assert.ok(!/만료됐거나 무효/.test(err.message), '만료된 토큰으로 잘못 안내하지 않음');
    return true;
  });
  rmSync(s.dir, { recursive: true, force: true });
});

async function freePort() {
  const srv = createNetServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const { port } = srv.address();
  await new Promise((r) => srv.close(r));
  return port;
}

test('mail-login: state·PKCE 를 확인한 뒤 토큰 교환, 확인 메일은 로그인한 계정으로', async () => {
  const { env } = setup();
  const port = await freePort();
  const logs = [];
  const done = outlookLogin({
    port,
    env: { OUTLOOK_AUTH_BASE: env.OUTLOOK_AUTH_BASE, GRAPH_BASE: env.GRAPH_BASE },
    log: (x) => logs.push(String(x)),
    ask: async () => CLIENT,
    open: false,
    message: { subject: '연결 확인', html: '<p>확인</p>' },
  });
  let authUrl;
  for (let i = 0; i < 200 && !authUrl; i++) {
    await new Promise((r) => setTimeout(r, 10));
    authUrl = logs.map((l) => /https?:\/\/\S+\/authorize\?\S+/.exec(l)?.[0]).find(Boolean);
  }
  assert.ok(authUrl, '로그인 주소를 안내');
  const u = new URL(authUrl);
  const q = Object.fromEntries(u.searchParams);
  assert.equal(q.client_id, CLIENT);
  assert.equal(q.redirect_uri, `http://localhost:${port}`);
  assert.equal(q.code_challenge_method, 'S256');
  assert.equal(q.prompt, 'select_account');
  assert.match(q.scope, /offline_access/);
  assert.match(q.scope, /Mail\.Send/);
  assert.ok(!/Mail\.Read/.test(q.scope), '받은 메일 읽기 권한은 요청하지 않음');
  expectChallenge = q.code_challenge;

  // 확인값이 다른 요청은 거절만 하고 계속 기다린다
  const forged = await fetch(`http://127.0.0.1:${port}/?code=evil&state=wrong`);
  assert.equal(forged.status, 400);
  const ok = await fetch(`http://127.0.0.1:${port}/?code=code-1&state=${q.state}`);
  assert.equal(ok.status, 200);
  const r = await done;
  assert.equal(r.clientId, CLIENT);
  assert.equal(r.refreshToken, 'rt-1');
  assert.equal(r.account.address, 'sender@outlook.kr');
  assert.equal(r.sent, true);
  assert.deepEqual(sent[0].message.toRecipients, [{ emailAddress: { address: 'sender@outlook.kr' } }]);

  await assert.rejects(outlookLogin({ port, env: {}, log: quiet, ask: async () => 'not-a-guid', open: false }), /8-4-4-4-12/);
});

test('로그인 콜백의 오류 문구는 화면에 이스케이프해 보여 준다', async () => {
  const port = await freePort();
  const waiting = waitForCode({ port, state: 's1', path: '/', label: 'Microsoft' });
  const failed = assert.rejects(waiting, /Microsoft 가 오류를 돌려줬습니다: access_denied/);
  const res = await fetch(`http://127.0.0.1:${port}/?state=s1&error=access_denied&error_description=${encodeURIComponent('<script>alert(1)</script>')}`);
  const html = await res.text();
  assert.equal(res.status, 400);
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  await failed;
});

test('메일 이름(MAIL_TITLE)은 브리핑 메일의 제목·본문과 연결 확인 메일에 쓰인다', async () => {
  let s = setup({ MAIL_TITLE: 'OO팀 일일 보안 브리핑' });
  await sendBriefMail(s.cfg, sampleBrief(), { env: s.env, log: quiet });
  const m = sent[0].message;
  assert.match(m.subject, /\[OO팀 일일 보안 브리핑\] 10\.23\(금\)$/);
  assert.ok(m.body.content.includes('>OO팀 일일 보안 브리핑</p>'), '본문 머리');
  assert.ok(!m.body.content.includes('>일일 보안 브리핑</p>'));
  await sendBriefMail(s.cfg, null, { test: true, env: s.env, log: quiet });
  assert.equal(sent[1].message.subject, '[OO팀 일일 보안 브리핑] 메일 연결 확인');
  rmSync(s.dir, { recursive: true, force: true });

  s = setup();
  await sendBriefMail(s.cfg, sampleBrief(), { env: s.env, log: quiet });
  assert.match(sent[0].message.subject, /\[일일 보안 브리핑\] 10\.23\(금\)$/, '없으면 site.title');
  rmSync(s.dir, { recursive: true, force: true });
});
