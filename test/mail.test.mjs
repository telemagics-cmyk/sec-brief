// 가짜 SMTP 서버로 메일 발송 흐름을 시험한다 (실제 메일 서버는 부르지 않는다).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { renderMarkdown, sinceNote } from '../src/brief.mjs';
import { explainMailError, kisaNames, mailOrg, mailSettings, mailSubject, mailTitle, mastNames, renderEmailHtml, sendBriefMail, sentences } from '../src/mail.mjs';
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
  const heads = [...html.matchAll(/<h[23][^>]*>([^<]+)/g)].map((m) => m[1].trim());
  assert.deepEqual(heads, ['주요 보안 뉴스', '국내 뉴스', '해외 뉴스', 'KISA 보안 업데이트 권고', '실제 악용 확인 취약점', '신규 고위험 취약점']);
  const tiles = [...html.matchAll(/class="metric-label"[^>]*>([^<]+)/g)].map((m) => m[1]);
  assert.deepEqual(tiles, ['보안 뉴스', 'KISA 보안 공지', '고위험 취약점', 'KEV 신규 등재'], '건수 칸은 시안 순서');
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt; 해킹'));
  assert.ok(!/href="javascript:/i.test(html));
  assert.ok(html.includes('href="https://u.github.io/sec-brief/b/2026-10-23.html#kisa"'), '웹에서 보기는 웹 페이지 구역으로');
  assert.ok(!/<script|<link |<img /i.test(html), '메일에는 스크립트·외부 스타일·이미지 없음');
  // <style> 은 휴대폰 배치·Outlook 보정뿐(외부 자원·사용자 글 없음)
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
  assert.match(renderEmailHtml(b, {}), /class="date-line date-clock"[^>]*>10\.23\(금\) 브리핑 이후<\/p>/, '머리 날짜 칸 맨 아래');
  assert.match(renderMarkdown(b), /KST · 10\.23\(금\) 브리핑 이후\n/);
  assert.equal(sinceNote(sampleBrief({ date: '2026-10-27', window: { since_brief: '2026-10-26' } })), '', '바로 전날 브리핑에 이어지면 적지 않음');
  assert.equal(sinceNote(sampleBrief()), '', '기간 정보가 없는 브리핑');
});

test('메일 머리 이름: MAIL_TITLE·MAIL_ORG 로 굵은 이름 | 조직, 큰 제목 — 글자 사이는 벌리지 않음', () => {
  assert.deepEqual(mastNames('OO팀 일일 보안 브리핑', '가나다 · OO센터'), { brand: '가나다 OO팀', unit: 'OO센터', heading: '일일 보안 브리핑' });
  assert.deepEqual(mastNames('OO팀 일일 보안 브리핑', '가나다 OO팀 · OO센터'), { brand: '가나다 OO팀', unit: 'OO센터', heading: '일일 보안 브리핑' }, '회사 이름에 팀 이름이 이미 있으면 되풀이하지 않음');
  assert.deepEqual(mastNames('ABC 일일 보안 브리핑', 'ABC · 운영센터'), { brand: 'ABC', unit: '운영센터', heading: '일일 보안 브리핑' });
  assert.deepEqual(mastNames('OO팀 일일 보안 브리핑', ''), { brand: 'OO팀', unit: '', heading: '일일 보안 브리핑' });
  assert.deepEqual(mastNames('OO팀 일일 보안 브리핑', 'OO센터'), { brand: 'OO팀', unit: 'OO센터', heading: '일일 보안 브리핑' }, '조직이 한 덩이면 칸막이 뒤');
  assert.deepEqual(mastNames('일일 보안 브리핑', ''), { brand: '', unit: '', heading: '일일 보안 브리핑' });
  assert.deepEqual(mastNames('일일 보안 브리핑', 'OO센터'), { brand: 'OO센터', unit: '', heading: '일일 보안 브리핑' });
  assert.deepEqual(mastNames('주간 보안 소식', '가나다 · OO센터'), { brand: '가나다', unit: 'OO센터', heading: '주간 보안 소식' }, '이름 꼴이 아니면 큰 제목은 그대로');
  const pad = '<!--[if mso]>&nbsp;<![endif]-->';
  const html = renderEmailHtml(sampleBrief(), { title: 'OO팀 일일 보안 브리핑', org: '가나다 · OO센터' }).split(pad).join('');
  assert.match(html, /<strong class="brand" [^>]*>가나다 OO팀<\/strong> <span class="brand-gap" style="[^"]*border-left:1px solid #B9B3A7;[^"]*">OO센터<\/span><\/p><h1 class="hero" [^>]*>일일 보안 브리핑<\/h1>/);
  assert.match(html, /<strong style="color:#46565D;">가나다 OO팀<\/strong> <span [^>]*>OO센터<\/span><\/td>/, '꼬리에도 이름 | 조직');
  // 영문 약어가 'G OC' 처럼 떨어져 보이지 않게 벌리지 않는다(큰 글자만 조금 좁힘, 0 은 물려받은 값을 지우는 것)
  assert.ok(!/letter-spacing:\s*(?![\s-]|0(?![.\d]))/.test(html), html.match(/letter-spacing:[^;"]*/g).join(', '));
  // 이름이 없으면 이름 줄 없이 큰 제목만, 꼬리에는 메일 이름
  const plain = renderEmailHtml(sampleBrief(), {});
  assert.ok(!plain.includes('class="brand"'));
  assert.match(plain, /<h1 class="hero" [^>]*>일일 보안 브리핑<\/h1>/);
  assert.match(plain, /<strong style="color:#46565D;">일일 보안 브리핑<\/strong><\/td>/);
  assert.equal(mailOrg({ MAIL_ORG: '  ABC · 운영센터 ' }), 'ABC · 운영센터');
  assert.ok(!mailOrg({}));
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

test('메일 디자인: 시안의 표 뼈대 — 최대 900px(Outlook(Windows) 680 한 단), 밝은 화면 전용, 좁은 창은 위아래로', () => {
  const b = sampleBrief();
  b.overview = '오늘의 요약 문장입니다. 패치가 시급합니다.';
  const html = renderEmailHtml(b, { siteUrl: 'https://u.github.io/sec-brief', title: 'OO팀 일일 보안 브리핑' });
  // Word(Outlook Windows) 는 표의 max-width 를 고정 폭처럼 써서 넓히면 좁은 읽기 창에서 가로로 밀린다 → Word 에는 680 표만,
  // 최대 900 은 div 에(Word 는 div 폭을 무시 — 2026-11-27 Word 렌더로 확인). 본문 표에는 max-width 를 두지 않는다
  assert.match(html, /<!--\[if mso\]><table role="presentation" width="680" align="center"[^>]*><tr><td><!\[endif\]-->\n<div style="max-width:900px;margin:0 auto;">\n<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#FFFFFF" style="width:100%;/);
  assert.match(html, /<\/table>\n<\/div>\n<!--\[if mso\]><\/td><\/tr><\/table><!\[endif\]-->/);
  assert.ok(!/<table[^>]*max-width/.test(html), '표에는 max-width 없음(Word 가 고정 폭으로 씀)');
  // Outlook.com 웹은 '그 밖의 앱에만' 보이게 감싼 <!--[if !mso]><!--> 안의 태그를 지우는 것으로 보인다(2026-11-27 뉴스 칸 무너짐)
  // → 그 꼴을 쓰지 않고, <!--[if mso]> 안에도 열고 닫는 짝이 맞는 것(680 표·행 나눔·빈 줄)만
  assert.ok(!/\[if !mso\]/.test(html), '[if !mso] 없음');
  const msoBlocks = [...html.matchAll(/<!--\[if mso\]>([\s\S]*?)<!\[endif\]-->/g)].map((m) => m[1]);
  for (const x of msoBlocks) assert.ok(/^(<style>|&nbsp;$|<\/tr><tr>$|<\/tr><tr><td style="height:24px;line-height:24px;padding:0;">&nbsp;<\/td><\/tr><tr>$|<table role="presentation" width="680"|<\/td><\/tr><\/table>$)/.test(x), x);
  // Outlook.com 웹은 <!--[if mso]> 안의 <style> 도 적용한다(2026-11-26 본문 680px·국내|해외 9:1) → 거기에는 글꼴만, 배치 규칙 없음
  const msoCss = /<!--\[if mso\]><style>([^<]*)<\/style><!\[endif\]-->/.exec(html)[1];
  assert.ok(!/width|padding|margin|display|height|float|position/.test(msoCss), msoCss);
  assert.match(msoCss, /font-family:'Malgun Gothic'[^}]*text-autospace:none;\}\.serif\{font-family:Georgia,serif !important;\}$/);
  assert.match(html, /<meta name="color-scheme" content="light">/);
  assert.ok(!/prefers-color-scheme/.test(html), '시안대로 밝은 화면 전용');
  // 시안의 머리: 위 남색 굵은 줄, 미색 바탕
  assert.match(html, /<td class="pad mast" bgcolor="#F8F5ED" style="background:#F8F5ED;border-top:5px solid #223947;/);
  // 국내|해외: 칸 폭은 <col>(Word 는 무시 → 행을 나누면 한 칸이 전체 폭), 칸 사이 간격은 칸 안 div 여백(Word 는 무시).
  // 칸(td)에는 폭·옆 여백을 주지 않는다. 680px 이하 창은 위아래, Outlook(Windows)은 두 칸 사이에서 행을 나눠 위아래
  assert.match(html, /<table [^>]*class="ntab" style="table-layout:fixed;width:100%;"><col class="ncolw" width="50%" style="width:50%;"><col class="ncolw" width="50%" style="width:50%;"><tr>\n<td class="ncol" valign="top" style="padding:0;vertical-align:top;"><div class="ngap" style="padding:0 16px 0 0;">/);
  assert.match(html, /<!--\[if mso\]><\/tr><tr><td style="height:24px;line-height:24px;padding:0;">&nbsp;<\/td><\/tr><tr><!\[endif\]-->\n<td class="ncol2 ncol" valign="top" style="padding:0;vertical-align:top;"><div class="ngap" style="padding:0 0 0 16px;">/);
  assert.ok(!/<td class="ncol[^"]*"[^>]*width/.test(html), '뉴스 칸(td)에는 폭을 주지 않음(Word 가 그 폭으로 반쪽 칸을 만듦)');
  // 좁은 창: 칸을 쌓고 여백·열 폭을 풀어(쌓인 칸이 첫 열 폭=반에 갇히지 않게)
  assert.match(html, /@media \(max-width: 680px\) \{[\s\S]*?\.ncol \{ display: block !important; width: 100% !important; padding: 0 !important; \}\n {2}\.ngap \{ padding: 0 !important; \}\n {2}\.ntab \{ table-layout: auto !important; \}\n {2}\.ncolw \{ width: auto !important; \}/);
  // Word 는 class 의 첫 이름만 읽는다(2026-11-19 Word 로 그려 확인) → Outlook 규칙이 걸린 이름은 맨 앞에
  const msoNames = ['serif'];
  for (const m of html.matchAll(/class="([^"]+)"/g)) {
    const names = m[1].split(' ');
    if (names.some((n) => msoNames.includes(n))) assert.ok(msoNames.includes(names[0]), `class="${m[1]}"`);
  }
  assert.ok(html.indexOf('>국내 뉴스 <span') < html.indexOf('>해외 뉴스 <span'), '쌓였을 때 국내 → 해외');
  assert.match(html, /<h2 class="panel-title" [^>]*>오늘의 요약<\/h2>/, '확인할 일이 없는 날은 요약 문장');
});

/** 건수 칸: [이름, 숫자, 숫자 색, 설명] */
function metricsOf(html) {
  return [...html.matchAll(/<p class="metric-label"[^>]*>([^<]+)<\/p>\s*<p class="serif metric-num" style="[^"]*color:(#[0-9A-F]{6});">([^<]+)[\s\S]*?<\/p>\s*<p [^>]*>([^<]+)<\/p>/g)].map((m) => [m[1], m[3], m[2], m[4]]);
}

test('메일 첫 화면: 머리(이름·큰 제목·날짜), 건수 4칸, 오늘의 우선 점검(남색 상자), 웹에서 보기', () => {
  const b = sampleBrief(); // 경보가 바뀐 날, 악용 1건 + 그 밖 2건
  b.actions = [
    { title: 'Plex Media Server 패치 확인', detail: 'CISA 기한 11.10 전 업데이트 여부 점검' },
    { title: 'GitLab 버전 확인', detail: '18.11.13 미만 사용 여부 검토' },
    { title: '원격 접속 장비 점검', detail: '사이버위기 경보 상향에 따른 외부 노출 확인' },
  ];
  const site = 'https://u.github.io/sec-brief';
  const html = renderEmailHtml(b, { siteUrl: site, title: 'OO팀 일일 보안 브리핑', org: 'OO회사 · OO센터' });
  // 날짜 칸: 년월 / 일(세리프 큰 숫자)·요일 / 생성 시각
  assert.match(html, /color:#64583F;">2026년 10월<\/p>/);
  assert.match(html, /<span class="serif date-day" style="font-family:Georgia[^"]*font-size:48px;[^"]*">23<\/span>일 금요일<\/p>/);
  assert.match(html, /class="date-line date-clock"[^>]*>06:41 KST 기준<\/p>/);
  // 경보 → 건수 → 우선 점검 → 웹에서 보기 → 뉴스
  const at = (s) => html.indexOf(s);
  assert.ok(at('사이버위기 경보</p>') > 0 && at('사이버위기 경보</p>') < at('class="metric-label"'));
  assert.ok(at('class="metric-label"') < at('>오늘의 우선 점검<') && at('>오늘의 우선 점검<') < at('>웹에서 보기<') && at('>웹에서 보기<') < at('>주요 보안 뉴스<'));
  // 건수 4칸(시안 순서). 새 경보(KISA)·실제 악용이 있는 날만 숫자를 붉게
  assert.deepEqual(metricsOf(html), [
    ['보안 뉴스', '2', '#203746', '국내 1 · 해외 1'],
    ['KISA 보안 공지', '3', '#803D2E', 'Laravel · Oracle'],
    ['고위험 취약점', '69', '#203746', 'CVSS 9.0 이상'],
    ['KEV 신규 등재', '3', '#803D2E', '이번 수집 기준'],
  ]);
  // 남색 상자: 금색 번호 01~03, 굵은 제목 | 설명
  assert.match(html, /<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#223947" style="background:#223947;"><tr><td class="panel"/);
  const items = [...html.matchAll(/<td class="pkey"[^>]*>([^<]+)<\/td><td class="pdesc"[^>]*>([^<]+)<\/td>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(items, b.actions.map((x) => [x.title, x.detail]));
  assert.deepEqual([...html.matchAll(/<td class="serif" width="41"[^>]*color:#E9C48A;[^>]*>(\d\d)<\/td>/g)].map((m) => m[1]), ['01', '02', '03']);
  // 웹에서 보기: 웹 페이지의 같은 구역(메일 안 이동 링크 # 은 쓰지 않음), 실제 악용은 있는 날만
  const navHtml = html.slice(at('>웹에서 보기<'), at('>주요 보안 뉴스<'));
  const nav = [...navHtml.matchAll(/href="https:\/\/u\.github\.io\/sec-brief\/b\/2026-10-23\.html#([a-z-]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => `${m[1]}:${m[2]}`);
  assert.deepEqual(nav, ['news-domestic:국내 뉴스', 'news-international:해외 뉴스', 'kisa:KISA 권고', 'exploited:실제 악용', 'critical:고위험 취약점']);
  assert.ok(!/href="#/.test(html), '메일 안 이동 링크 없음');
  // 확인할 일이 없으면(규칙 기반 날·예전 브리핑) 요약 문장을 '오늘의 요약'으로, 첫 문장만 굵게(흰 글자)
  const old = sampleBrief();
  old.overview = '가장 시급한 일입니다. 둘째 문장입니다.';
  const h2 = renderEmailHtml(old, {});
  assert.ok(h2.includes('>오늘의 요약<') && !h2.includes('오늘의 우선 점검'));
  assert.match(h2, /line-height:25px;font-weight:bold;color:#FFFFFF;">가장 시급한 일입니다\.<\/p>/);
  assert.match(h2, /line-height:25px;color:#EDF1F0;">둘째 문장입니다\.<\/p>/);
  assert.ok(!h2.includes('>웹에서 보기<'), '웹 주소가 없으면 링크 줄도 없음');
  // 악용이 없는 날: KEV 칸은 0(붉지 않게), 실제 악용 구역·링크 없음
  const calm = sampleBrief({ exploited: [], exploited_more: [], advisories: [] });
  const h3 = renderEmailHtml(calm, { siteUrl: site });
  assert.deepEqual(metricsOf(h3).map((m) => m.slice(1)), [['2', '#203746', '국내 1 · 해외 1'], ['0', '#203746', '새 공지 없음'], ['69', '#203746', 'CVSS 9.0 이상'], ['0', '#203746', '이번 수집 기준']]);
  assert.ok(!h3.includes('실제 악용 확인 취약점') && !h3.includes('#exploited'));
  // 수집 실패: 숫자 대신 '–', 설명은 '수집 실패'(KEV 는 꼬리에도 안내)
  const lost = renderEmailHtml(sampleBrief({ exploited: [], exploited_more: [], critical: [], critical_total: null, failed: { kev: true, nvd: true } }), {});
  assert.deepEqual(metricsOf(lost).slice(2).map((m) => [m[1], m[3]]), [['–', '수집 실패'], ['–', '수집 실패']]);
  assert.ok(lost.includes('CISA KEV 수집 실패 — 실제 악용 취약점은 웹 페이지에서 확인하세요'));
  // KISA 칸의 이름: 둘까지, 나머지는 '외 N'
  const many = sampleBrief({ advisories: ['Fortinet', 'Git', 'Oracle', 'SAP'].map((n, i) => ({ id: `a${i}`, source: 'KISA 보안공지', title: `${n} 제품 보안 업데이트 권고`, url: `https://www.boho.or.kr/${i}`, date: '2026-10-23' })) });
  assert.equal(metricsOf(renderEmailHtml(many, {}))[1][3], 'Fortinet · Git 외 2');
});

test('KISA 공지 이름 줄이기: 제품·보안·신규·대상 앞까지, 취약점 정보는 번호 뒤 첫 낱말, 같은 이름은 한 번, 경보는 뺌', () => {
  assert.deepEqual(kisaNames([
    { title: 'Fortinet 제품 보안 업데이트 권고' },
    { title: 'PHP 보안취약점(PHP2Shell) 관련 기업 보안 대응 수칙' },
    { title: 'PHP 신규 취약점(CVE-2026-115560) 임시 조치 권고' },
    { title: 'Palo Alto Networks 제품 보안 업데이트 권고' },
    { title: 'WordPress 플러그인 보안 업데이트 권고' },
    { title: 'CVE-2026-76146 | 지니언스 Genian SSL PNS 운영체제 명령어 삽입' },
    { title: 'Synology NAS 대상 랜섬웨어 공격 주의 권고' },
    { title: "사이버위기 경보 단계 '관심' → '주의' 상향 조정", alert: true },
  ]), ['Fortinet', 'PHP', 'Palo Alto Networks', 'WordPress', '지니언스', 'Synology NAS']);
  assert.deepEqual(kisaNames([]), []);
});

test('메일 뉴스·KISA: 제목 한 번·매체·시각·요약·점검(금색 표시), KISA 는 금색 점과 굵은 제목·짧은 날짜', () => {
  const b = sampleBrief();
  b.news.domestic[0] = { ...b.news.domestic[0], lang: 'ko', title: '원래 국내 제목', title_ko: '다듬은 국내 제목', check_ko: 'SSO·계정 접속 로그 검토' };
  b.news.international[0] = { ...b.news.international[0], lang: 'en', title: 'Original English Title', title_ko: '번역한 제목' };
  const html = renderEmailHtml(b, {});
  assert.ok(html.includes('다듬은 국내 제목') && !html.includes('원래 국내 제목'), '국내 기사 제목은 한 번만');
  assert.ok(html.includes('번역한 제목') && !html.includes('Original English Title'), '메일은 번역 제목만(원문 제목은 웹 페이지에)');
  assert.match(html, /<h4 class="story-title" style="[^"]*font-size:18px;[^"]*"><a href="https:\/\/news\.example\/1"[^>]*>다듬은 국내 제목<\/a><\/h4>/);
  assert.match(html, /보안뉴스 외 2곳 · \d\d\.\d\d \d\d:\d\d/, '매체·시각');
  assert.match(html, /<strong style="font-size:13px;color:#79571F;">점검<\/strong>&nbsp; SSO·계정 접속 로그 검토<\/p>/);
  assert.equal(html.split('>점검</strong>').length - 1, 1, '점검할 점이 없는 기사는 줄도 없음');
  assert.match(html, />국내 뉴스 <span [^>]*>1건<\/span><\/h3>/);
  assert.match(html, /border-bottom:2px solid #A88442;"><h3 /, '칸 제목은 금색 밑줄');
  // KISA: 보안공지 출처는 되풀이하지 않고 날짜는 MM.DD, 경보단계 등만 작은 표시
  assert.ok(!/KISA 보안공지/.test(html));
  assert.match(html, /color:#906C2F;">•<\/td>/, '금색 점');
  assert.match(html, />Laravel 제품 보안 업데이트 권고<\/a> <span [^>]*>· 10\.23<\/span><\/p>/);
  assert.match(html, /상향 조정<\/a> <span [^>]*>경보단계<\/span> <span [^>]*>· 10\.22<\/span>/);
  assert.match(html, />KISA 보안 업데이트 권고 <span [^>]*>3건<\/span><\/h2>/);
});

test('메일 취약점: 표(제품 | 주요 영향 | CVSS — 실제 악용은 조치 기한), 제목 → NVD, 영향·조치, 번호·다른 표시·링크 한 줄', () => {
  const html = renderEmailHtml(sampleBrief(), { assetUrl: 'https://asset.example:4800' });
  assert.deepEqual([...html.matchAll(/<th class="rcell [^"]*"[^>]*>([^<]+)<\/th>/g)].map((m) => m[1]), ['제품', '주요 영향', '조치 기한', '제품', '주요 영향', 'CVSS']);
  assert.match(html, /<th class="rcell rcol-p" width="47%" align="left" bgcolor="#F4F2EB"/, '머리 칸은 연한 바탕(시안)');
  assert.match(html, /<a href="https:\/\/nvd\.nist\.gov\/vuln\/detail\/CVE-2026-96656"[^>]*>Plex Media Server 파일 이름·경로 외부 제어 취약점<\/a>/);
  assert.match(html, /color:#3C505A;">실제 공격에 악용됨<\/p><p [^>]*><strong [^>]*>조치<\/strong>&nbsp; 즉시 패치<\/p>/);
  // 실제 악용: 셋째 칸은 CISA 조치 기한(MM.DD), 점수는 번호 줄에 — 기한은 되풀이하지 않는다
  assert.match(html, /CVE-2026-96656<\/span> · CVSS 8\.6 · EPSS 0\.8% · <a href="https:\/\/plex\.example\/adv"[^>]*>벤더 공지<\/a> · <a href="https:\/\/asset\.example:4800\/#\/vuln\?brief=2026-10-23&amp;cve=CVE-2026-96656"[^>]*>우리 자산 영향<\/a>/);
  assert.match(html, /color:#803D2E;">11\.10<\/p><\/td>/);
  // 고위험: 셋째 칸은 점수, 번호 줄에는 나머지 표시(웹과 같은 순서)
  assert.match(html, /CVE-2026-110264<\/span> · KISA 권고 · 관심: GitLab · EPSS 0\.5%/);
  assert.match(html, /color:#803D2E;">10\.0<\/p><\/td>/);
  assert.match(html, />실제 악용 확인 취약점 <span [^>]*>CISA KEV 신규 3건<\/span><\/h2>/);
  assert.match(html, /그 밖의 신규 등재 2건: CVE-2026-1, CVE-2026-2/);
  assert.match(html, /CVSS 9\.0 이상 <strong [^>]*>69건 중 주요 1묶음<\/strong> · 나머지 1묶음은 웹 페이지에서 볼 수 있습니다\./);
  assert.ok(html.indexOf('69건 중 주요 1묶음') < html.indexOf('GitLab CE/EE 정수 오버플로'), '범위 안내는 표 위(시안)');
  assert.match(html, /우리 자산 영향 한눈에 보기<\/a> — 오늘 브리핑의 취약점을 자산 대장과 비교합니다/);
  assert.equal(html.split('우리 자산 영향 한눈에 보기').length - 1, 1, '한 번만');
  assert.match(html, /KEV: 미국 사이버보안청\(CISA\)[^<]*CVSS: [^<]*EPSS: /, '표시 풀이는 꼬리에');
});

test('메일 크기: 평소 분량이면 Gmail 이 뒷부분을 자르는 크기(약 102KB)보다 넉넉히 작다', () => {
  const b = sampleBrief();
  const long = '가'.repeat(150);
  b.news.domestic = Array.from({ length: 5 }, (_, i) => ({ ...b.news.domestic[0], id: `d${i}`, summary_ko: long, check_ko: '나'.repeat(36), outlets: Array.from({ length: 20 }, (_, k) => `매체${k}`) }));
  b.news.international = Array.from({ length: 5 }, (_, i) => ({ ...b.news.international[0], id: `i${i}`, summary_ko: long, check_ko: '다'.repeat(36) }));
  b.advisories = Array.from({ length: 10 }, (_, i) => ({ ...b.advisories[1], id: `a${i}`, url: `https://www.boho.or.kr/${i}` }));
  b.actions = Array.from({ length: 3 }, (_, i) => ({ title: `확인할 일 ${i}`.padEnd(24, '라'), detail: '마'.repeat(48) }));
  // 최악에 가까운 날: KEV 신규 10건 + 자산 링크
  b.exploited = Array.from({ length: 10 }, (_, i) => ({ ...b.exploited[0], id: `CVE-2026-${i + 2}` }));
  b.critical = [b.critical[0], { ...b.critical[0], id: 'CVE-2026-3' }, { ...b.critical[0], id: 'CVE-2026-4' }];
  const extraNews = { keyword: '가나다전지', total: 9, items: Array.from({ length: 5 }, (_, i) => ({ title: `가나다전지 소식 ${i}`, url: `https://n.example/${i}`, outlet: '가신문', outlets: 3, published: '2026-10-28T01:00:00Z' })) };
  const size = Buffer.byteLength(renderEmailHtml(b, { siteUrl: 'https://u.github.io/sec-brief', extraNews, assetUrl: 'https://asset.example:4800', org: 'OO회사 · OO센터' }));
  assert.ok(size < 90 * 1024, `${Math.round(size / 1024)}KB`);
});

test('요약 문장 나누기: 마침표·물음표·느낌표 뒤 빈칸에서만 — 소수점·영문 약어·숫자 뒤는 그대로', () => {
  assert.deepEqual(sentences('가 합니다. 나 CVSS 9.8 입니다! 다 U.S. 기관? 라 2026. 11. 13. 마'), ['가 합니다.', '나 CVSS 9.8 입니다!', '다 U.S. 기관?', '라 2026. 11. 13. 마']);
  assert.deepEqual(sentences("주요 뉴스: 국내 '가', 해외 '나'. KISA 공지 5건. 새 취약점: 실제 악용 6건(A, B) · CVSS 9.0 이상 81건."), ["주요 뉴스: 국내 '가', 해외 '나'.", 'KISA 공지 5건.', '새 취약점: 실제 악용 6건(A, B) · CVSS 9.0 이상 81건.']);
  assert.deepEqual(sentences('한 문장입니다.'), ['한 문장입니다.']);
  assert.deepEqual(sentences(''), []);
});

test('메일 뉴스 통합 배치: 국내 언론이 많은 날은 국내·해외 한 목록(중요한 순, 두 건씩 나란히·해외 표시), 아니면 두 칸', () => {
  const b = sampleBrief();
  const ko = (i) => ({ ...b.news.domestic[0], id: `k${i}`, region: 'domestic', title_ko: `국내 기사 ${i}` });
  const en = (i) => ({ ...b.news.international[0], id: `e${i}`, region: 'international', title_ko: `해외 기사 ${i}` });
  b.news = { domestic: [0, 1, 2, 3, 4, 5, 6].map(ko), international: [0, 1, 2].map(en), merged: true, order: ['k0', 'e0', 'k1', 'k2', 'k3', 'e1', 'k4', 'k5', 'k6', 'e2'] };
  const html = renderEmailHtml(b, {});
  assert.ok(html.includes('>국내·해외 통합 <span') && !html.includes('>국내 뉴스 <span'));
  assert.match(html, />국내 7 · 해외 3<\/span><\/h3>/);
  const titles = [...html.matchAll(/>((?:국내|해외) 기사 \d)<\/a>/g)].map((m) => m[1]);
  assert.deepEqual(titles, ['국내 기사 0', '해외 기사 0', '국내 기사 1', '국내 기사 2', '국내 기사 3', '해외 기사 1', '국내 기사 4', '국내 기사 5', '국내 기사 6', '해외 기사 2']);
  assert.equal(html.split('>해외</strong> · ').length - 1, 3, '해외 언론 기사에만 표시');
  // 두 건씩 한 줄(중요한 순서가 가로로 이어짐), Outlook(Windows)·휴대폰은 위아래 — 줄은 칸에 그어 나란한 두 건이 맞는다
  assert.equal(html.match(/<!--\[if mso\]><\/tr><tr><!\[endif\]-->/g).length, 5);
  assert.equal(html.match(/<td class="ncol" valign="top" style="padding:0;vertical-align:top;border-bottom:1px solid #DADBD4;"><div class="ngap" style="padding:0 (?:16px 0 0|0 0 16px);">/g).length, 10);
  // 통합이 아닌 날은 국내 | 해외 두 칸
  const normal = renderEmailHtml(sampleBrief(), {});
  assert.ok(normal.includes('>국내 뉴스 <span') && normal.includes('>해외 뉴스 <span') && !normal.includes('국내·해외 통합'));
});
