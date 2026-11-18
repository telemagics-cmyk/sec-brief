// 가짜 SMTP 서버로 메일 발송 흐름을 시험한다 (실제 메일 서버는 부르지 않는다).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { renderMarkdown, sinceNote } from '../src/brief.mjs';
import { brandLine, explainMailError, mailOrg, mailSettings, mailSubject, mailTitle, renderEmailHtml, sendBriefMail, sentences } from '../src/mail.mjs';
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
  assert.deepEqual(heads, ['주요 보안 뉴스', '국내 보안 뉴스', '해외 보안 뉴스', '보안 업데이트 권고', '실제 악용 확인 취약점', '신규 고위험 취약점']);
  const tiles = [...html.matchAll(/class="tile-label[^"]*"[^>]*>([^<]+)/g)].map((m) => m[1]);
  assert.deepEqual(tiles, ['국내·해외 뉴스', 'KISA 공지', '실제 악용', 'CVSS 9.0 이상'], '건수도 같은 순서');
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt; 해킹'));
  assert.ok(!/href="javascript:/i.test(html));
  assert.ok(html.includes('href="https://u.github.io/sec-brief/b/2026-10-23.html#kisa"'), '건수 칸은 웹 페이지 섹션으로 연결');
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
  assert.match(renderEmailHtml(b, {}), /KST · 10\.23\(금\) 브리핑 이후<\/p>/);
  assert.match(renderMarkdown(b), /KST · 10\.23\(금\) 브리핑 이후\n/);
  assert.equal(sinceNote(sampleBrief({ date: '2026-10-27', window: { since_brief: '2026-10-26' } })), '', '바로 전날 브리핑에 이어지면 적지 않음');
  assert.equal(sinceNote(sampleBrief()), '', '기간 정보가 없는 브리핑');
});

test('메일 머리 이름: MAIL_TITLE 로 영문 이름 줄, 글자 사이는 벌리지 않음, 조직 이름(MAIL_ORG)은 있을 때만', () => {
  assert.equal(brandLine('ABC 일일 보안 브리핑'), 'ABC / DAILY SECURITY BRIEF');
  assert.equal(brandLine('일일 보안 브리핑'), 'DAILY SECURITY BRIEF');
  assert.equal(brandLine('주간 보안 소식'), '주간 보안 소식');
  const html = renderEmailHtml(sampleBrief(), { title: 'ABC 일일 보안 브리핑' });
  assert.match(html, /<p style="margin:0;font-size:12px;line-height:18px;font-weight:bold;color:#243747;">ABC \/ DAILY SECURITY BRIEF<\/p><\/td>/, '조직 이름이 없으면 이름 줄만');
  // 영문 약어가 'G OC' 처럼 떨어져 보이지 않게 벌리지 않는다(큰 문구만 조금 좁힘)
  assert.ok(!/letter-spacing:\s*(?!-)/.test(html));
  assert.match(html, /font-weight:bold;color:#5F6F7B;">ABC 일일 보안 브리핑<\/p>/, '꼬리에는 메일 이름');
  const withOrg = renderEmailHtml(sampleBrief(), { title: 'ABC 일일 보안 브리핑', org: 'ABC · 운영센터' });
  assert.match(withOrg, /font-weight:bold;color:#5F6F7B;">ABC · 운영센터<\/p>/, '꼬리에는 조직 이름');
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

test('메일 디자인: 시안의 표 뼈대 — 최대 880px(Outlook(Windows) 680 한 단), 밝은 화면 전용, 휴대폰은 위아래로', () => {
  const b = sampleBrief();
  b.overview = '오늘의 요약 문장입니다. 패치가 시급합니다.';
  const html = renderEmailHtml(b, { siteUrl: 'https://u.github.io/sec-brief', title: 'OO팀 일일 보안 브리핑' });
  assert.match(html, /<!--\[if mso\]><table role="presentation" width="680"/);
  assert.match(html, /width="100%" class="mailw" bgcolor="#FFFFFF" style="max-width:880px;/);
  // Word(Outlook Windows) 는 max-width 를 고정 폭처럼 써서 넓히면 좁은 읽기 창에서 가로로 밀린다 → Outlook 에서만 680
  assert.match(html, /<!--\[if mso\]><style>[^<]*\.mailw\{max-width:680px !important;\}/);
  assert.ok(!/<div style="max-width/.test(html), '폭을 div 로 정하지 않음');
  assert.match(html, /<meta name="color-scheme" content="light">/);
  assert.ok(!/prefers-color-scheme/.test(html), '시안대로 밝은 화면 전용');
  // 국내|해외: 표 두 칸(어느 웹메일이든 나란히), 휴대폰은 @media 로 위아래, Outlook(Windows)은 두 칸 사이에서 행을 나눠 위아래
  assert.match(html, /<td class="ncol" valign="top" style="width:50%;[^"]*">[\s\S]*<!--\[if mso\]><\/tr><tr><!\[endif\]-->\s*<td class="ncol ncol2"/);
  assert.match(html, /@media \(max-width: 640px\) \{[\s\S]*?\.ncol \{ display: block !important; width: 100% !important;/);
  assert.match(html, /<!--\[if mso\]><style>[^<]*\.ncol\{width:100% !important;padding:0 !important;\}/);
  assert.ok(html.indexOf('국내 보안 뉴스') < html.indexOf('해외 보안 뉴스'), '쌓였을 때 국내 → 해외');
  assert.match(html, /<h2 [^>]*>오늘의 요약<\/h2>/, '확인할 일이 없는 날은 요약 문장');
});

test('메일 첫 화면: 이름·월일·한 줄 문구, 건수(실제 악용 칸은 있는 날만), 오늘 먼저 확인할 일', () => {
  const b = sampleBrief(); // 경보가 바뀐 날, 악용 1건 + 그 밖 2건
  b.actions = [
    { title: 'Plex Media Server 패치 확인', detail: 'CISA 기한 11.10 전 업데이트 여부 점검' },
    { title: 'GitLab 버전 확인', detail: '18.11.13 미만 사용 여부 검토' },
    { title: '원격 접속 장비 점검', detail: '사이버위기 경보 상향에 따른 외부 노출 확인' },
  ];
  const html = renderEmailHtml(b, { siteUrl: 'https://u.github.io/sec-brief', title: 'OO팀 일일 보안 브리핑', org: 'OO회사 · OO센터' });
  assert.match(html, />OO팀 \/ DAILY SECURITY BRIEF<\/p><p [^>]*>OO회사 · OO센터<\/p>/);
  assert.match(html, />OCT<\/p><p class="serif" [^>]*>23<\/p>/);
  assert.match(html, /<p class="hero" [^>]*>안전한 하루를 위한<br>보안 인사이트\.<\/p>/);
  assert.match(html, />2026년 10월 23일 금요일 · 06:41 KST<\/p>/);
  // 경보 → 건수 → 확인할 일 → 뉴스
  const at = (s) => html.indexOf(s);
  assert.ok(at('사이버위기 경보</p>') > 0 && at('사이버위기 경보</p>') < at('class="tile-label"'));
  assert.ok(at('class="tile-label"') < at('오늘 먼저 확인할 3가지') && at('오늘 먼저 확인할 3가지') < at('주요 보안 뉴스'));
  const tiles = [...html.matchAll(/<span style="[^"]*color:(#[0-9A-F]{6});">([^<]+)<\/span><br><span class="tile-label"[^>]*>([^<]+)<\/span>/g)].map((m) => [m[3], m[2], m[1]]);
  assert.deepEqual(tiles, [['국내·해외 뉴스', '2', '#243747'], ['KISA 공지', '3', '#9C351C'], ['실제 악용', '3', '#9C351C'], ['CVSS 9.0 이상', '69', '#243747']]);
  assert.ok(html.includes('href="https://u.github.io/sec-brief/b/2026-10-23.html#exploited"'), '건수는 웹 페이지 구역으로');
  const items = [...html.matchAll(/<p style="margin:0;font-size:15px;line-height:24px;font-weight:bold;color:#243747;">([^<]+)<\/p><p [^>]*>([^<]+)<\/p>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(items, b.actions.map((x) => [x.title, x.detail]));
  assert.deepEqual([...html.matchAll(/color:#9A783C;">(0\d)<\/p>/g)].map((m) => m[1]).slice(0, 3), ['01', '02', '03']);
  // 확인할 일이 없으면(규칙 기반 날·예전 브리핑) 요약 문장을 '오늘의 요약'으로, 첫 문장만 굵게
  const old = sampleBrief();
  old.overview = '가장 시급한 일입니다. 둘째 문장입니다.';
  const h2 = renderEmailHtml(old, {});
  assert.ok(h2.includes('>오늘의 요약<') && !h2.includes('오늘 먼저 확인할'));
  assert.match(h2, /line-height:24px;font-weight:bold;color:#243747;">가장 시급한 일입니다\.<\/p>/);
  assert.match(h2, /line-height:24px;color:#243747;">둘째 문장입니다\.<\/p>/);
  // 악용이 없는 날: 건수 칸 3개, 꼬리에 'KEV 0건'
  const calm = sampleBrief({ exploited: [], exploited_more: [] });
  const h3 = renderEmailHtml(calm, {});
  assert.deepEqual([...h3.matchAll(/class="tile-label"[^>]*>([^<]+)/g)].map((m) => m[1]), ['국내·해외 뉴스', 'KISA 공지', 'CVSS 9.0 이상']);
  assert.ok(h3.includes('CISA KEV 신규 등재 0건 · 이번 수집 기준') && !h3.includes('실제 악용 확인 취약점'));
});

test('메일 뉴스·KISA: 금색 번호·제목 한 번·매체·시각·요약·확인 포인트, KISA 는 굵은 제목과 짧은 날짜', () => {
  const b = sampleBrief();
  b.news.domestic[0] = { ...b.news.domestic[0], lang: 'ko', title: '원래 국내 제목', title_ko: '다듬은 국내 제목', check_ko: 'SSO·계정 접속 로그 검토' };
  b.news.international[0] = { ...b.news.international[0], lang: 'en', title: 'Original English Title', title_ko: '번역한 제목' };
  const html = renderEmailHtml(b, {});
  assert.ok(html.includes('다듬은 국내 제목') && !html.includes('원래 국내 제목'), '국내 기사 제목은 한 번만');
  assert.ok(html.includes('번역한 제목') && !html.includes('Original English Title'), '메일은 번역 제목만(원문 제목은 웹 페이지에)');
  assert.match(html, /보안뉴스 외 2곳 · \d\d\.\d\d \d\d:\d\d/, '매체·시각');
  assert.match(html, /font-weight:bold;color:#8B6B35;">확인 포인트 · SSO·계정 접속 로그 검토<\/p>/);
  assert.equal(html.split('확인 포인트 ·').length - 1, 1, '확인 포인트가 없는 기사는 줄도 없음');
  assert.match(html, />국내 보안 뉴스 <span [^>]*>1건<\/span><\/h3>/);
  // KISA: 보안공지 출처는 되풀이하지 않고 날짜는 MM.DD, 경보단계 등만 작은 표시
  assert.ok(!/KISA 보안공지 ·/.test(html));
  assert.match(html, />Laravel 제품 보안 업데이트 권고<\/a> <span [^>]*>· 10\.23<\/span><\/p>/);
  assert.match(html, /상향 조정<\/a> <span [^>]*>경보단계<\/span> <span [^>]*>· 10\.22<\/span>/);
  assert.match(html, />보안 업데이트 권고 <span [^>]*>KISA 3건<\/span><\/h2>/);
});

test('메일 취약점: 왼쪽 표시(KEV 진하게·CVSS), 제목 → NVD, 영향·조치(금색), 번호·다른 표시·링크 한 줄', () => {
  const raw = renderEmailHtml(sampleBrief(), { assetUrl: 'https://asset.example:4800' });
  // Outlook(Windows) 에서만 보이는 안쪽 빈칸: 표시마다 앞뒤로
  const pad = '<!--[if mso]>&nbsp;<![endif]-->';
  assert.ok(raw.includes(`background:#9C351C;">${pad}KEV${pad}</span>`), 'KEV 는 진한 칸');
  assert.ok(raw.includes(`background:#FFF0E9;">${pad}CVSS 10.0${pad}</span>`));
  const html = raw.split(pad).join('');
  assert.match(html, /<a href="https:\/\/nvd\.nist\.gov\/vuln\/detail\/CVE-2026-96656"[^>]*>Plex Media Server 파일 이름·경로 외부 제어 취약점<\/a>/);
  assert.match(html, /color:#8B6B35;">조치 · 즉시 패치<\/p>/);
  // 웹과 같은 순서의 나머지 표시(왼쪽 칸과 같은 것은 빼고) · 벤더 공지 · 우리 자산 영향
  assert.match(html, /CVE-2026-96656<\/span> · CVSS 8\.6 · 기한 2026-11-10 · EPSS 0\.8% · <a href="https:\/\/plex\.example\/adv"[^>]*>벤더 공지<\/a> · <a href="https:\/\/asset\.example:4800\/#\/vuln\?brief=2026-10-23&amp;cve=CVE-2026-96656"[^>]*>우리 자산 영향<\/a>/);
  assert.match(html, /CVE-2026-110264<\/span> · KISA 권고 · 관심: GitLab · EPSS 0\.5%/);
  assert.match(html, />실제 악용 확인 취약점 <span [^>]*>CISA KEV 신규 3건<\/span><\/h2>/);
  assert.match(html, /그 밖의 신규 등재 2건: CVE-2026-1, CVE-2026-2/);
  assert.match(html, /CVSS 9\.0 이상 69건 중 주요 1묶음 · 나머지 1묶음은 웹 페이지에서 볼 수 있습니다\./);
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
