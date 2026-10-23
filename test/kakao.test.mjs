// 가짜 카카오 서버로 토큰 갱신·암호화 저장·발송 흐름을 시험한다 (실제 카카오는 부르지 않는다).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { currentRefreshToken, decryptToken, KakaoError, loadState, sendBrief, seedId } from '../src/kakao.mjs';
import { sampleBrief } from './fixtures.mjs';

const calls = [];
let rotateNext = false;
let tokenError = null;
let validRefresh = new Set(['seed-token-1']);
let server;
let base;

before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const form = Object.fromEntries(new URLSearchParams(body));
      calls.push({ path: req.url, method: req.method, form, auth: req.headers.authorization, type: req.headers['content-type'] });
      const json = (status, obj) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(obj));
      if (req.url === '/oauth/token') {
        if (tokenError) return json(tokenError.status, tokenError.body);
        if (form.client_secret !== 'secret-1') return json(401, { error: 'invalid_client', error_description: 'Bad client credentials', error_code: 'KOE010' });
        if (!validRefresh.has(form.refresh_token)) return json(400, { error: 'invalid_grant', error_description: 'expired_or_invalid_refresh_token', error_code: 'KOE322' });
        const out = { token_type: 'bearer', access_token: `access-${calls.length}`, expires_in: 21599 };
        if (rotateNext) {
          validRefresh = new Set(['rotated-token-2']); // 새 값이 나오면 옛 값은 바로 만료
          out.refresh_token = 'rotated-token-2';
          out.refresh_token_expires_in = 5183999;
          rotateNext = false;
        }
        return json(200, out);
      }
      if (req.url === '/v2/api/talk/memo/default/send') {
        if (!String(req.headers.authorization).startsWith('Bearer access-')) return json(401, { msg: 'this access token does not exist', code: -401 });
        return json(200, { result_code: 0 });
      }
      return json(404, { msg: 'not found', code: -1 });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'sb-kakao-'));
  const cfg = { dataDir: dir, site: { url: 'https://u.github.io/sec-brief', title: '일일 보안 브리핑' }, kakao: { template: 'list' } };
  const env = {
    KAKAO_AUTH_BASE: base,
    KAKAO_API_BASE: base,
    KAKAO_REST_API_KEY: 'rest-key',
    KAKAO_CLIENT_SECRET: 'secret-1',
    KAKAO_REFRESH_TOKEN: 'seed-token-1',
  };
  return { dir, cfg, env, log: () => {} };
}

test('설정이 없으면 건너뛴다', async () => {
  const { cfg, dir } = setup();
  const r = await sendBrief(cfg, sampleBrief(), { env: {} });
  assert.equal(r.skipped, true);
  rmSync(dir, { recursive: true, force: true });
});

test('발송: 갱신 → 리스트형 메시지 → 같은 날 두 번은 안 보냄', async () => {
  const { cfg, env, dir, log } = setup();
  calls.length = 0;
  const r = await sendBrief(cfg, sampleBrief(), { env, log });
  assert.equal(r.sent, true);
  assert.equal(r.template, 'list');
  const token = calls.find((c) => c.path === '/oauth/token');
  assert.equal(token.form.grant_type, 'refresh_token');
  assert.equal(token.form.client_id, 'rest-key');
  assert.equal(token.form.refresh_token, 'seed-token-1');
  const send = calls.find((c) => c.path === '/v2/api/talk/memo/default/send');
  assert.match(send.type, /application\/x-www-form-urlencoded/);
  const tpl = JSON.parse(send.form.template_object);
  assert.equal(tpl.object_type, 'list');
  const state = loadState(join(dir, 'kakao-state.json'));
  assert.equal(state.last_sent, '2026-10-23');
  assert.equal(state.seed, seedId('seed-token-1'));
  assert.ok(!readFileSync(join(dir, 'kakao-state.json'), 'utf8').includes('seed-token-1'), '토큰이 평문으로 저장되면 안 된다');

  calls.length = 0;
  const again = await sendBrief(cfg, sampleBrief(), { env, log });
  assert.equal(again.skipped, true);
  assert.equal(calls.length, 0, '이미 보낸 날은 카카오를 부르지도 않는다');
  const forced = await sendBrief(cfg, sampleBrief(), { env, log, force: true });
  assert.equal(forced.sent, true);
  rmSync(dir, { recursive: true, force: true });
});

test('리프레시 토큰 교체: 새 값을 암호화해 저장하고 다음 실행부터 그 값을 쓴다', async () => {
  const { cfg, env, dir, log } = setup();
  validRefresh = new Set(['seed-token-1']);
  rotateNext = true;
  const r = await sendBrief(cfg, sampleBrief(), { env, log });
  assert.equal(r.rotated, true);
  const state = loadState(join(dir, 'kakao-state.json'));
  assert.equal(decryptToken('seed-token-1', state.token).refresh_token, 'rotated-token-2');
  assert.ok(state.refresh_expires_at);
  assert.deepEqual(currentRefreshToken(state, 'seed-token-1'), { token: 'rotated-token-2', from: 'state' });
  calls.length = 0;
  await sendBrief(cfg, sampleBrief({ date: '2026-10-24' }), { env, log });
  assert.equal(calls.find((c) => c.path === '/oauth/token').form.refresh_token, 'rotated-token-2');
  // 다른 비밀값으로는 풀리지 않는다
  assert.throws(() => decryptToken('other-seed', state.token));
  rmSync(dir, { recursive: true, force: true });
});

test('다시 로그인해 KAKAO_REFRESH_TOKEN 을 바꾸면 새 값을 우선한다', async () => {
  const { cfg, env, dir, log } = setup();
  validRefresh = new Set(['seed-token-1']);
  await sendBrief(cfg, sampleBrief(), { env, log });
  validRefresh = new Set(['seed-token-NEW']);
  calls.length = 0;
  const r = await sendBrief(cfg, sampleBrief({ date: '2026-10-24' }), { env: { ...env, KAKAO_REFRESH_TOKEN: 'seed-token-NEW' }, log });
  assert.equal(r.sent, true);
  assert.equal(calls.find((c) => c.path === '/oauth/token').form.refresh_token, 'seed-token-NEW');
  assert.equal(loadState(join(dir, 'kakao-state.json')).seed, seedId('seed-token-NEW'));
  rmSync(dir, { recursive: true, force: true });
});

test('오류 안내: 만료된 토큰(KOE322)·잘못된 시크릿(KOE010)은 할 일을 알려 준다', async () => {
  const { cfg, env, dir, log } = setup();
  validRefresh = new Set(['something-else']);
  await assert.rejects(sendBrief(cfg, sampleBrief(), { env, log }), (err) => err instanceof KakaoError && err.code === 'KOE322' && /kakao-login/.test(err.message));
  validRefresh = new Set(['seed-token-1']);
  await assert.rejects(sendBrief(cfg, sampleBrief(), { env: { ...env, KAKAO_CLIENT_SECRET: 'wrong' }, log }), (err) => err.code === 'KOE010' && /클라이언트 시크릿/.test(err.message));
  tokenError = { status: 401, body: { error: 'invalid_client', error_description: 'Not exist client_id [x]', error_code: 'KOE101' } };
  await assert.rejects(sendBrief(cfg, sampleBrief(), { env, log }), (err) => err.code === 'KOE101' && /Not exist client_id/.test(err.message));
  tokenError = null;
  rmSync(dir, { recursive: true, force: true });
});

test('연결 확인 메시지(--test)는 텍스트형이고 발송 기록을 남기지 않는다', async () => {
  const { cfg, env, dir, log } = setup();
  validRefresh = new Set(['seed-token-1']);
  calls.length = 0;
  const r = await sendBrief(cfg, null, { env, log, test: true });
  assert.equal(r.template, 'text');
  const tpl = JSON.parse(calls.find((c) => c.path.endsWith('/send')).form.template_object);
  assert.match(tpl.text, /연결 확인/);
  assert.equal(loadState(join(dir, 'kakao-state.json')).last_sent, undefined);
  rmSync(dir, { recursive: true, force: true });
});
