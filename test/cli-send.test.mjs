// 실제 CLI(send --scheduled)를 가짜 시각·가짜 Microsoft 서버로 실행해 정시 실행의 기다리기·건너뛰기·예비 경고를 시험한다.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../src/config.mjs';
import { saveBrief } from '../src/store.mjs';
import { sampleBrief } from './fixtures.mjs';

const DATE = '2026-10-29';
const mails = [];
let server;
let base;

before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const json = (status, obj) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(obj));
      if (req.url === '/auth/token') {
        return json(200, { access_token: 'acc', refresh_token: 'rt-next', scope: 'https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/User.Read', expires_in: 3600 });
      }
      if (req.url.startsWith('/graph/me/sendMail')) {
        mails.push(JSON.parse(body).message.subject);
        return res.writeHead(202).end();
      }
      if (req.url.startsWith('/graph/me')) return json(200, { mail: null, userPrincipalName: 'sender@outlook.kr' });
      return json(404, {});
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

function dataDir() {
  const dir = mkdtempSync(join(tmpdir(), 'sb-cli-'));
  saveBrief(dir, sampleBrief({ date: DATE }), '# 시험');
  return dir;
}

/** DATE 의 KST 시각(HH:MM:SS)에 GitHub Actions 안인 것처럼 `send --scheduled` 를 실행한다 */
function send(dir, kstTime, event = 'workflow_dispatch') {
  const env = {
    ...process.env,
    FAKE_NOW: `${DATE}T${kstTime}+09:00`,
    GITHUB_ACTIONS: 'true',
    GITHUB_EVENT_NAME: event,
    SEC_BRIEF_DATA_DIR: dir,
    SITE_URL: 'https://u.github.io/sec-brief',
    OUTLOOK_AUTH_BASE: `${base}/auth`,
    GRAPH_BASE: `${base}/graph`,
    OUTLOOK_CLIENT_ID: '0a1b2c3d-1111-2222-3333-444455556666',
    OUTLOOK_REFRESH_TOKEN: 'seed-rt',
    MAIL_TO: 'me@example.org',
    // 저장소의 .env(로컬 비밀값)가 끼어들어 실제로 보내지 않게, 빈 값 대신 공백으로 막는다(공백은 '설정 없음')
    KAKAO_REST_API_KEY: ' ',
    KAKAO_REFRESH_TOKEN: ' ',
    SMTP_HOST: ' ',
  };
  const clock = pathToFileURL(join(ROOT, 'test', 'fake-clock.mjs')).href;
  const started = Date.now();
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['--import', clock, join(ROOT, 'src', 'cli.mjs'), 'send', '--scheduled'], { cwd: ROOT, env });
    // 기다리기 판단이 고장 나면 몇 시간씩 멈추므로 시험은 20초에 끊는다
    const timer = setTimeout(() => p.kill(), 20000);
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out, ms: Date.now() - started });
    });
  });
}

test('정시 실행(외부 호출): 06:30 전에 끝나면 발송 시각까지 기다렸다 보낸다', async () => {
  const dir = dataDir();
  const before = mails.length;
  const r = await send(dir, '06:29:57');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /발송 시각\(06:30 KST\)까지 1분 기다립니다/);
  assert.ok(r.ms >= 2000, `기다리지 않음: ${r.ms}ms`);
  assert.match(r.out, /메일 발송 완료 \(Outlook, 받는 사람 1명\): 2026-10-29/);
  assert.equal(mails.length, before + 1);
  assert.ok(!/예비 예약 실행이 보냈습니다/.test(r.out), '정시 실행에는 예비 경고 없음');
  rmSync(dir, { recursive: true, force: true });
});

test('정시 실행을 밤중에 부르면 기다리지 않고(작업 시간 제한 초과) 이번에는 보내지 않는다', async () => {
  const dir = dataDir();
  const before = mails.length;
  const r = await send(dir, '01:00:00');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /::notice::발송 시각\(06:30 KST\)까지 330분 남아 이번 실행에서는 보내지 않습니다/);
  assert.equal(mails.length, before);
  assert.ok(r.ms < 30000);
  rmSync(dir, { recursive: true, force: true });
});

test('GitHub 예비 예약이 보내면 늦은 발송 경고, 이미 보낸 날은 경고 없이 건너뜀', async () => {
  const dir = dataDir();
  const r = await send(dir, '08:31:00', 'schedule');
  assert.equal(r.code, 0, r.out);
  assert.ok(!/기다립니다/.test(r.out));
  assert.match(r.out, /메일 발송 완료/);
  assert.match(r.out, /::warning::GitHub 예비 예약 실행이 보냈습니다\(늦은 발송\)/);

  const again = await send(dir, '09:42:00', 'schedule');
  assert.equal(again.code, 0, again.out);
  assert.match(again.out, /2026-10-29 브리핑 메일은 이미 보냈습니다/);
  assert.ok(!/예비 예약 실행이 보냈습니다/.test(again.out));
  rmSync(dir, { recursive: true, force: true });
});
