// 가짜 SMTP 서버로 메일 발송 흐름을 시험한다 (실제 메일 서버는 부르지 않는다).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { renderMarkdown, sinceNote } from '../src/brief.mjs';
import { explainMailError, mailSettings, mailSubject, mailTitle, renderEmailHtml, sendBriefMail } from '../src/mail.mjs';
import { msUntilKst } from '../src/util.mjs';
import { sampleBrief } from './fixtures.mjs';

let server;
let port;
let failAuth = false;
const mails = [];

before(async () => {
  server = createServer((sock) => {
    sock.setEncoding('utf8');
    sock.on('error', () => {});
    let buf = '';
    let inData = false;
    let data = '';
    let mail = { from: '', to: [], auth: '' };
    const send = (l) => sock.write(`${l}\r\n`);
    send('220 fake.smtp ESMTP');
    sock.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            mails.push({ ...mail, data });
            data = '';
            mail = { from: '', to: [], auth: mail.auth };
            send('250 2.0.0 OK queued');
          } else data += `${line.startsWith('..') ? line.slice(1) : line}\n`;
          continue;
        }
        const cmd = line.toUpperCase();
        if (cmd.startsWith('EHLO')) sock.write('250-fake.smtp\r\n250-AUTH PLAIN\r\n250 8BITMIME\r\n');
        else if (cmd.startsWith('HELO')) send('250 fake');
        else if (cmd.startsWith('AUTH')) {
          mail.auth = Buffer.from(line.split(' ')[2] || '', 'base64').toString('utf8').split('\0').slice(1).join(':');
          send(failAuth ? '535 5.7.8 Username and Password not accepted' : '235 2.7.0 Accepted');
        } else if (cmd.startsWith('MAIL FROM')) {
          mail.from = line.slice(10);
          send('250 OK');
        } else if (cmd.startsWith('RCPT TO')) {
          mail.to.push(line.slice(8));
          send('250 OK');
        } else if (cmd === 'DATA') {
          inData = true;
          send('354 go ahead');
        } else if (cmd === 'QUIT') {
          send('221 bye');
          sock.end();
        } else send('250 OK');
      }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});

after(() => server.close());

function setup(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sb-mail-'));
  const cfg = { dataDir: dir, site: { url: 'https://u.github.io/sec-brief', title: '일일 보안 브리핑' } };
  const env = {
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String(port),
    SMTP_SECURITY: 'none',
    SMTP_USER: 'sender@example.com',
    SMTP_PASS: 'app-password-xyz',
    MAIL_TO: 'me@example.org',
    ...extra,
  };
  return { dir, cfg, env };
}

test('메일 설정 읽기: 465 는 SSL, 587 은 STARTTLS, 받는 주소 여러 개, 잘못된 주소는 오류', () => {
  assert.equal(mailSettings({}), null);
  const a = mailSettings({ SMTP_HOST: 'smtp.gmail.com', MAIL_TO: 'a@x.com, b@y.com;c@z.org', SMTP_USER: 'me@gmail.com' });
  assert.deepEqual({ port: a.port, security: a.security, to: a.to, from: a.from }, { port: 465, security: 'ssl', to: ['a@x.com', 'b@y.com', 'c@z.org'], from: 'me@gmail.com' });
  assert.equal(mailSettings({ SMTP_HOST: 'h', SMTP_PORT: '587', MAIL_TO: 'a@x.com' }).security, 'starttls');
  assert.equal(mailSettings({ SMTP_HOST: 'h', MAIL_TO: 'a@x.com', SMTP_PASS: 'abcd efgh ijkl mnop' }).pass, 'abcdefghijklmnop', 'Gmail 앱 비밀번호 띄어쓰기');
  assert.equal(mailSettings({ SMTP_HOST: 'h', MAIL_TO: 'a@x.com', SMTP_PASS: 'my pass 12' }).pass, 'my pass 12', '다른 비밀번호는 그대로');
  assert.throws(() => mailSettings({ SMTP_HOST: 'h', MAIL_TO: 'a@x.com, 이건주소아님' }), /메일 주소가 아닌 값/);
});

test('메일 본문: 웹과 같은 순서, 글 이스케이프, javascript: 주소는 링크로 만들지 않음', () => {
  const b = sampleBrief();
  b.news.domestic[0].title = '<img src=x onerror=alert(1)> 해킹';
  b.news.domestic[0].url = 'javascript:alert(1)';
  const html = renderEmailHtml(b, { siteUrl: 'https://u.github.io/sec-brief' });
  const heads = [...html.matchAll(/<h2[^>]*>([^<]+)/g)].map((m) => m[1].trim());
  assert.deepEqual(heads, ['국내 보안 뉴스', '해외 보안 뉴스', 'KISA 공지', '악용 확인 취약점', '신규 고위험 취약점']);
  const tiles = [...html.matchAll(/font-size:11\.5px;[^>]*>([^<]+)/g)].map((m) => m[1]);
  assert.deepEqual(tiles, ['국내 뉴스', '해외 뉴스', 'KISA 공지', '악용 확인', '고위험 9.0+'], '건수 칸도 같은 순서');
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt; 해킹'));
  assert.ok(!/href="javascript:/i.test(html));
  assert.ok(html.includes('href="https://u.github.io/sec-brief/b/2026-10-23.html#kisa"'), '건수 칸은 웹 페이지 섹션으로 연결');
  assert.ok(!/<script|<style|<link /i.test(html), '메일에는 스크립트·외부 스타일 없음');
  assert.equal(mailSubject(b), '[경보] [일일 보안 브리핑] 10.23(금)', '날짜까지만(건수 없음)');
  assert.equal(mailSubject({ ...b, advisories: [] }, 'OO팀 일일 보안 브리핑'), '[OO팀 일일 보안 브리핑] 10.23(금)');
});

test('발송: 로그인·받는 사람·제목, 같은 날은 한 번만, 기록 파일에는 주소를 남기지 않음', async () => {
  const { dir, cfg, env } = setup();
  mails.length = 0;
  const r = await sendBriefMail(cfg, sampleBrief(), { env });
  assert.deepEqual({ sent: r.sent, accepted: r.accepted }, { sent: true, accepted: 1 });
  assert.equal(mails.length, 1);
  assert.equal(mails[0].auth, 'sender@example.com:app-password-xyz');
  assert.match(mails[0].from, /sender@example\.com/);
  assert.deepEqual(mails[0].to, ['<me@example.org>']);
  assert.match(mails[0].data, /^Subject: =\?UTF-8\?/m, '한글 제목은 인코딩');
  assert.match(mails[0].data, /text\/html/);
  assert.match(mails[0].data, /text\/plain/);
  const state = readFileSync(join(dir, 'mail-state.json'), 'utf8');
  assert.match(state, /"last_sent": "2026-10-23"/);
  assert.ok(!state.includes('@'), '공개 저장소에 남는 기록에 주소를 쓰지 않는다');
  const again = await sendBriefMail(cfg, sampleBrief(), { env });
  assert.equal(again.skipped, true);
  assert.equal(mails.length, 1);
  await sendBriefMail(cfg, sampleBrief(), { env, force: true });
  assert.equal(mails.length, 2);
  rmSync(dir, { recursive: true, force: true });
});

test('받는 사람이 여럿이면 서로 주소가 보이지 않게 숨은 참조', async () => {
  const { dir, cfg, env } = setup({ MAIL_TO: 'a@example.org,b@example.org' });
  mails.length = 0;
  const r = await sendBriefMail(cfg, sampleBrief(), { env });
  assert.equal(r.accepted, 2, '받는 사람 수에 보내는 주소는 넣지 않는다');
  assert.deepEqual(mails[0].to.sort(), ['<a@example.org>', '<b@example.org>', '<sender@example.com>']);
  assert.match(mails[0].data, /^To: sender@example\.com/m);
  assert.ok(!/^Bcc:/im.test(mails[0].data), '숨은 참조 머리글은 메일에 남지 않는다');
  assert.ok(!mails[0].data.includes('a@example.org'), '다른 수신자 주소가 본문·머리글에 없다');
  rmSync(dir, { recursive: true, force: true });
});

test('연결 확인 메일은 기록을 남기지 않고, 로그인 실패는 앱 비밀번호 안내', async () => {
  const { dir, cfg, env } = setup();
  mails.length = 0;
  const r = await sendBriefMail(cfg, null, { env, test: true });
  assert.equal(r.sent, true);
  assert.match(mails[0].data, /^Subject: =\?UTF-8\?/m);
  assert.throws(() => readFileSync(join(dir, 'mail-state.json')));
  failAuth = true;
  await assert.rejects(sendBriefMail(cfg, sampleBrief(), { env }), /SMTP 로그인 실패.*앱 비밀번호/);
  failAuth = false;
  rmSync(dir, { recursive: true, force: true });
});

test('연결 실패 안내에 서버 주소와 해외 접속 차단 가능성', async () => {
  const msg = explainMailError({ code: 'ETIMEDOUT', message: 'Connection timeout' }, { host: 'smtp.naver.com', port: 465 });
  assert.match(msg, /smtp\.naver\.com:465/);
  assert.match(msg, /해외/);
});

test('발송 시각 기다리기 계산 (KST)', () => {
  const at = (iso) => new Date(iso);
  assert.equal(msUntilKst('06:30', at('2026-10-23T20:05:00Z')), 85 * 60000, '05:05 KST → 06:30 까지 85분');
  assert.equal(msUntilKst('06:30', at('2026-10-23T21:40:00Z')), 0, '이미 지났으면 0');
  assert.throws(() => msUntilKst('6시'), /HH:MM/);
});

test('주말·연휴 뒤 브리핑은 메일·Markdown 머리에 "지난 브리핑 이후"를 적는다', () => {
  const b = sampleBrief({ date: '2026-10-26', window: { hours: 73, since_brief: '2026-10-23' } });
  assert.equal(sinceNote(b), '10.23(금) 브리핑 이후');
  assert.match(renderEmailHtml(b, {}), /KST 생성 · 10\.23\(금\) 브리핑 이후/);
  assert.match(renderMarkdown(b), /KST · 10\.23\(금\) 브리핑 이후 · 요약/);
  assert.equal(sinceNote(sampleBrief({ date: '2026-10-27', window: { since_brief: '2026-10-26' } })), '', '바로 전날 브리핑에 이어지면 적지 않음');
  assert.equal(sinceNote(sampleBrief()), '', '기간 정보가 없는 브리핑');
});

test('메일 이름: Secret MAIL_TITLE 이 있으면 그것, 없으면 site.title (웹·카카오와 별개)', () => {
  const cfg = { site: { title: '일일 보안 브리핑' } };
  assert.equal(mailTitle(cfg, {}), '일일 보안 브리핑');
  assert.equal(mailTitle(cfg, { MAIL_TITLE: '  OO팀 일일 보안 브리핑 ' }), 'OO팀 일일 보안 브리핑');
  assert.equal(mailTitle(cfg, { MAIL_TITLE: ' ' }), '일일 보안 브리핑', '공백만 있으면 없는 것으로');
});
