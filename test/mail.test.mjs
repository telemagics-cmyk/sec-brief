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
  const tiles = [...html.matchAll(/class="tile-label[^"]*"[^>]*>([^<]+)/g)].map((m) => m[1]);
  assert.deepEqual(tiles, ['국내 뉴스', '해외 뉴스', 'KISA 공지', '악용 확인', '고위험'], '건수 칸도 같은 순서(휴대폰에서 한 줄)');
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt; 해킹'));
  assert.ok(!/href="javascript:/i.test(html));
  assert.ok(html.includes('href="https://u.github.io/sec-brief/b/2026-10-23.html#kisa"'), '건수 칸은 웹 페이지 섹션으로 연결');
  assert.ok(!/<script|<link |<img /i.test(html), '메일에는 스크립트·외부 스타일·이미지 없음');
  // <style> 은 어두운 화면용 덮어쓰기·Outlook 글꼴뿐(외부 자원·사용자 글 없음)
  const css = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
  assert.ok(!/url\(|@import|expression|<|>/i.test(css), css);
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
  assert.match(renderMarkdown(b), /KST · 10\.23\(금\) 브리핑 이후\n/);
  assert.equal(sinceNote(sampleBrief({ date: '2026-10-27', window: { since_brief: '2026-10-26' } })), '', '바로 전날 브리핑에 이어지면 적지 않음');
  assert.equal(sinceNote(sampleBrief()), '', '기간 정보가 없는 브리핑');
});

test('메일 본문 맨 위 이름은 글자 간격을 벌리지 않는다(영문 약어가 떨어져 보이지 않게)', () => {
  const html = renderEmailHtml(sampleBrief(), { title: 'ABC 일일 보안 브리핑' });
  assert.match(html, />ABC 일일 보안 브리핑<\/p>/);
  assert.ok(!html.includes('letter-spacing'));
});

test('메일 이름: Secret MAIL_TITLE 이 있으면 그것, 없으면 site.title (웹·카카오와 별개)', () => {
  const cfg = { site: { title: '일일 보안 브리핑' } };
  assert.equal(mailTitle(cfg, {}), '일일 보안 브리핑');
  assert.equal(mailTitle(cfg, { MAIL_TITLE: '  OO팀 일일 보안 브리핑 ' }), 'OO팀 일일 보안 브리핑');
  assert.equal(mailTitle(cfg, { MAIL_TITLE: ' ' }), '일일 보안 브리핑', '공백만 있으면 없는 것으로');
});

test('메일 디자인: Outlook 용 표 뼈대, 받은편지함 미리 보기 글, 어두운 화면 선언', () => {
  const b = sampleBrief();
  b.overview = '오늘의 요약 문장입니다. 패치가 시급합니다.';
  const html = renderEmailHtml(b, { siteUrl: 'https://u.github.io/sec-brief', title: 'OO팀 일일 보안 브리핑' });
  // Outlook(Windows) 은 div 의 최대 폭을 무시하므로 680px 표로 감싼다
  assert.match(html, /<!--\[if mso\]><table role="presentation" width="680"/);
  assert.match(html, /max-width:680px/);
  assert.ok(!/<div style="max-width/.test(html), '폭을 div 로 정하지 않음');
  // 미리 보기 글: 요약 문장(본문에는 숨김)
  assert.match(html, /<div style="display:none;[^"]*mso-hide:all;[^"]*">오늘의 요약 문장입니다\. 패치가 시급합니다\./);
  assert.match(html, /<meta name="color-scheme" content="light dark">/);
  assert.match(html, /@media \(prefers-color-scheme: dark\)/);
  assert.match(html, /<p [^>]*>오늘의 요약<\/p>/, '요약 상자에 이름표');
});

test('메일 디자인: 국내 기사는 제목 한 번, 번역한 해외 기사만 원문 제목, KISA 는 짧은 날짜', () => {
  const b = sampleBrief();
  b.news.domestic[0] = { ...b.news.domestic[0], lang: 'ko', title: '원래 국내 제목', title_ko: '다듬은 국내 제목' };
  b.news.international[0] = { ...b.news.international[0], lang: 'en', title: 'Original English Title', title_ko: '번역한 제목' };
  const html = renderEmailHtml(b, {});
  assert.ok(html.includes('다듬은 국내 제목') && !html.includes('원래 국내 제목'), '국내 기사 제목은 한 번만');
  assert.ok(html.includes('번역한 제목') && html.includes('Original English Title'), '해외 기사는 원문 제목도');
  assert.match(html, /보안뉴스 외 2곳 · \d\d\.\d\d \d\d:\d\d/, '매체·시각');
  assert.match(html, />10\.23<\/td>/, 'KISA 날짜는 MM.DD');
  assert.ok(!/KISA 보안공지 ·/.test(html), '보안공지 출처는 되풀이하지 않음');
});

test('메일 디자인: 취약점 표시는 색 있는 칸(KEV·CVSS 9 이상 빨강), 조치는 굵게', () => {
  const raw = renderEmailHtml(sampleBrief(), {});
  // Outlook(Windows) 에서만 보이는 안쪽 빈칸: 표시·단추마다 앞뒤로
  const pad = '<!--[if mso]>&nbsp;<![endif]-->';
  assert.ok(raw.includes(`>${pad}KEV${pad}</span>`));
  assert.ok(raw.includes(`>${pad}NVD${pad}</a>`));
  assert.match(raw, /<\/span> <span class="p-/, '표시 사이에 빈칸(Outlook 에서 붙지 않게)');
  const html = raw.split(pad).join('').replace(/<\/span> <span/g, '</span><span');
  assert.match(html, /class="p-hot"[^>]*>KEV<\/span>/);
  assert.match(html, /class="p-hot"[^>]*>CVSS 10\.0<\/span>/);
  assert.match(html, /class="p-warn"[^>]*>기한 2026-11-10<\/span>/);
  assert.match(html, /class="p-note"[^>]*>KISA 권고<\/span>/);
  assert.match(html, />조치<\/td>\n<td class="ink" [^>]*font-weight:bold;">즉시 패치<\/td>/);
  // 악용 카드는 KEV 가 맨 앞, EPSS(참고)는 맨 뒤
  const first = /<div>(<span class="p-\w+"[^>]*>[^<]+<\/span>)+<\/div>/.exec(html)[0];
  const labels = [...first.matchAll(/>([^<]+)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(labels, ['KEV', 'CVSS 8.6', '기한 2026-11-10', 'EPSS 0.8%']);
});

test('메일 크기: 평소 분량이면 Gmail 이 뒷부분을 자르는 크기(약 102KB)보다 넉넉히 작다', () => {
  const b = sampleBrief();
  const long = '가'.repeat(150);
  b.news.domestic = Array.from({ length: 5 }, (_, i) => ({ ...b.news.domestic[0], id: `d${i}`, summary_ko: long, outlets: Array.from({ length: 20 }, (_, k) => `매체${k}`) }));
  b.news.international = Array.from({ length: 5 }, (_, i) => ({ ...b.news.international[0], id: `i${i}`, summary_ko: long }));
  b.advisories = Array.from({ length: 10 }, (_, i) => ({ ...b.advisories[1], id: `a${i}`, url: `https://www.boho.or.kr/${i}` }));
  b.exploited = [b.exploited[0], { ...b.exploited[0], id: 'CVE-2026-2' }];
  b.critical = [b.critical[0], { ...b.critical[0], id: 'CVE-2026-3' }, { ...b.critical[0], id: 'CVE-2026-4' }];
  const extraNews = { keyword: '가나다전지', total: 9, items: Array.from({ length: 5 }, (_, i) => ({ title: `가나다전지 소식 ${i}`, url: `https://n.example/${i}`, outlet: '가신문', outlets: 3, published: '2026-10-28T01:00:00Z' })) };
  const size = Buffer.byteLength(renderEmailHtml(b, { siteUrl: 'https://u.github.io/sec-brief', extraNews }));
  assert.ok(size < 90 * 1024, `${Math.round(size / 1024)}KB`);
});
