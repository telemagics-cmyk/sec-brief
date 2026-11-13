// 가짜 SMTP 서버로 메일 발송 흐름을 시험한다 (실제 메일 서버는 부르지 않는다).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { renderMarkdown, sinceNote } from '../src/brief.mjs';
import { explainMailError, mailSettings, mailSubject, mailTitle, renderEmailHtml, sendBriefMail } from '../src/mail.mjs';
import { msUntilKst } from '../src/util.mjs';
import { startFakeSmtp } from './fake-smtp.mjs';
import { sampleBrief } from './fixtures.mjs';

let server;
let port;
let failAuth = false;
const mails = [];

before(async () => {
  server = await startFakeSmtp({ mails, failAuth: () => failAuth });
  port = server.port;
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

test('메일에 숨김 글·보이지 않는 문자를 넣지 않는다(스팸 메일의 흔한 특징, 넣은 뒤 첫 발송에서 계정 정지: 2026-11-02)', () => {
  const b = sampleBrief();
  b.overview = '오늘의 요약 문장입니다.';
  const html = renderEmailHtml(b, { siteUrl: 'https://u.github.io/sec-brief', title: 'OO팀 일일 보안 브리핑' });
  const hidden = html.match(/display:\s*none|visibility:\s*hidden|opacity:\s*0|font-size:\s*(?:0(?:px)?|1px)(?![\d.])|max-height:\s*0|mso-hide/gi);
  assert.equal(hidden, null, `숨기는 서식: ${hidden}`);
  const invisible = html.match(/&#847;|&zwnj;|&zwj;|&#8203;|&#8199;|[͏​-‍⁠﻿]/g);
  assert.equal(invisible, null, `보이지 않는 문자 ${invisible?.length}개`);
  assert.equal(html.split('오늘의 요약 문장입니다.').length - 1, 1, '요약은 보이는 곳에 한 번만');
});

test('메일 디자인: Outlook 용 표 뼈대, 어두운 화면 선언', () => {
  const b = sampleBrief();
  b.overview = '오늘의 요약 문장입니다. 패치가 시급합니다.';
  const html = renderEmailHtml(b, { siteUrl: 'https://u.github.io/sec-brief', title: 'OO팀 일일 보안 브리핑' });
  // Outlook(Windows) 은 div 의 최대 폭을 무시하므로 680px 표로 감싼다
  assert.match(html, /<!--\[if mso\]><table role="presentation" width="680"/);
  assert.match(html, /max-width:960px/, '1920×1080 웹메일에 맞춘 최대 폭');
  assert.ok(!/<div style="max-width/.test(html), '폭을 div 로 정하지 않음');
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
  assert.match(html, /· 10\.23<\/span><\/td>/, 'KISA 날짜는 제목 바로 옆 MM.DD(넓은 폭에서 멀리 떨어지지 않게)');
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
  // 최악에 가까운 날: KEV 신규 10건 + 자산 단추
  b.exploited = Array.from({ length: 10 }, (_, i) => ({ ...b.exploited[0], id: `CVE-2026-${i + 2}` }));
  b.critical = [b.critical[0], { ...b.critical[0], id: 'CVE-2026-3' }, { ...b.critical[0], id: 'CVE-2026-4' }];
  const extraNews = { keyword: '가나다전지', total: 9, items: Array.from({ length: 5 }, (_, i) => ({ title: `가나다전지 소식 ${i}`, url: `https://n.example/${i}`, outlet: '가신문', outlets: 3, published: '2026-10-28T01:00:00Z' })) };
  const size = Buffer.byteLength(renderEmailHtml(b, { siteUrl: 'https://u.github.io/sec-brief', extraNews, assetUrl: 'https://asset.example:4800' }));
  assert.ok(size < 90 * 1024, `${Math.round(size / 1024)}KB`);
});

test('메일 폭: 최대 960px, 국내|해외는 칸 폭 기준 두 단(좁으면·calc 를 모르면 한 단), Outlook(Windows)은 680 한 단', () => {
  const html = renderEmailHtml(sampleBrief(), { siteUrl: 'https://u.github.io/sec-brief' });
  const cols = [...html.matchAll(/<div class="col" style="([^"]+)">/g)].map((m) => m[1]);
  assert.equal(cols.length, 2, '국내·해외 두 칸');
  // 화면이 아닌 칸 폭 기준(웹메일의 @media 는 브라우저 창 폭이라 좁은 읽기 창에서 깨짐), 곱셈·괄호 없는 calc, 앞에 width:100%
  for (const s of cols) assert.match(s, /width:100%;min-width:49%;max-width:100%;width:calc\(\d+px - \d+%\);/);
  // 화면 폭 @media 는 두 단을 정하지 않고, 언제나 한 단인 좁은 창에서 두 칸 사이 간격(왼쪽 칸 오른쪽 여백)만 지운다
  const mq = [...html.matchAll(/@media \(max-width: (\d+)px\) \{([^}]*\})/g)];
  assert.ok(mq.every((m) => !/\.col\b/.test(m[2])), '두 단 여부는 @media 로 정하지 않음');
  const gapOff = mq.find((m) => /\.colgap \{ padding-right: 0 !important; \}/.test(m[2]));
  assert.ok(gapOff && +gapOff[1] < 840 + 54, '창 폭이 이 값 이하면 칸 폭 < 840(바깥·카드 여백 54px) — 늘 한 단일 때만');
  assert.equal(html.match(/<td class="colgap" style="padding:0 24px 0 0;">/g)?.length, 1, '간격은 왼쪽 칸에만');
  assert.match(html, /<!--\[if mso\]><style>[^<]*\.colgap\{padding-right:0 !important;\}/, 'Outlook(Windows) 은 늘 한 단이라 간격 없음');
  assert.match(html, /<\/table><\/div><div class="col"/, '두 칸 사이에 빈칸·줄바꿈 없음');
  assert.ok(html.indexOf('국내 보안 뉴스') < html.indexOf('해외 보안 뉴스'), '쌓였을 때 국내 → 해외');
  assert.match(html, /<!--\[if mso\]><table role="presentation" width="680"/, 'Outlook(Windows) 은 680 한 단');
  // Word(Outlook Windows) 는 max-width 를 고정 폭처럼 써서 960 이면 좁은 읽기 창에서 가로로 밀린다 → Outlook 에서만 680 으로 덮어씀
  assert.match(html, /width="100%" class="mailw" style="max-width:960px;/);
  assert.match(html, /<!--\[if mso\]><style>[^<]*\.mailw\{max-width:680px !important;\}/);
});
