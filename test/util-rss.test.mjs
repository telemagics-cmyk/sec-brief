import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseFeed, splitAggregatorTitle } from '../src/sources/rss.mjs';
import { canonicalUrl, cleanText, findCveIds, kstDate, parseFeedDate, publicError, safeUrl, shortDay, truncate } from '../src/util.mjs';

test('날짜: 시간대 없는 국내 RSS 시각은 한국 시간으로 본다', () => {
  assert.equal(parseFeedDate('2026-10-23 14:46:14').date.toISOString(), '2026-10-23T05:46:14.000Z');
  assert.equal(parseFeedDate('2026-10-22').dateOnly, true);
  assert.equal(kstDate(parseFeedDate(' 2026-10-22 ').date), '2026-10-22');
  assert.equal(parseFeedDate('Fri, 23 Oct 2026 14:00:03 +0900').date.toISOString(), '2026-10-23T05:00:03.000Z');
  assert.equal(parseFeedDate('Thu, 22 Oct 2026 20:52:00 GMT').date.toISOString(), '2026-10-22T20:52:00.000Z');
  assert.equal(parseFeedDate('Fri, 23 Oct 2026 14:00:03 KST').date.toISOString(), '2026-10-23T05:00:03.000Z');
  assert.equal(parseFeedDate('아무 글'), null);
  assert.equal(parseFeedDate(''), null);
});

test('문자열 도구', () => {
  assert.equal(truncate('가나다라마바사', 5), '가나다라…');
  assert.equal(truncate('가나다', 5), '가나다');
  assert.equal(safeUrl('javascript:alert(1)'), '');
  assert.equal(safeUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(canonicalUrl('https://www.example.com/news?id=1&utm_source=x#top'), 'https://example.com/news?id=1');
  assert.equal(cleanText('<p>A &amp;amp; B</p><p>C&nbsp;D</p>'), 'A & B C D');
  assert.deepEqual(findCveIds('cve-2026-106931 그리고 CVE-2026-0322, CVE-2026-106931'), ['CVE-2026-106931', 'CVE-2026-0322']);
  assert.equal(shortDay('2026-10-23'), '10.23(금)');
});

const KISA = `<rss version="2.0"><channel>
  <title><![CDATA[보호나라>알림마당>보안공지]]></title>
  <item>
    <title><![CDATA[ GitLab 제품 보안 업데이트 권고 ]]></title>
    <link><![CDATA[ https://www.boho.or.kr/kr/bbs/view.do?bbsId=B0000133&menuNo=205020&nttId=72232 ]]></link>
    <pubDate><![CDATA[ 2026-10-22 ]]></pubDate>
  </item>
</channel></rss>`;

test('RSS: KISA 형식(CDATA 안 공백, 날짜만)', () => {
  const [it] = parseFeed(KISA);
  assert.equal(it.title, 'GitLab 제품 보안 업데이트 권고');
  assert.equal(it.link, 'https://www.boho.or.kr/kr/bbs/view.do?bbsId=B0000133&menuNo=205020&nttId=72232');
  assert.equal(it.dateOnly, true);
  assert.equal(kstDate(it.published), '2026-10-22');
});

const GNEWS = `<?xml version="1.0"?><rss version="2.0"><channel><item>
<title>한전, 개인정보 유출 1만1천명 추가 확인 - 연합뉴스TV</title>
<link>https://news.google.com/rss/articles/CBMi?oc=5</link>
<pubDate>Fri, 23 Oct 2026 00:14:00 GMT</pubDate>
<description>&lt;a href="https://news.google.com/x"&gt;한전&lt;/a&gt;&amp;nbsp;&lt;font color="#6f6f6f"&gt;연합뉴스TV&lt;/font&gt;</description>
<source url="https://www.yonhapnewstv.co.kr">연합뉴스TV</source>
</item></channel></rss>`;

test('RSS: Google 뉴스 제목에서 언론사 떼기', () => {
  const [it] = parseFeed(GNEWS);
  assert.equal(it.source, '연합뉴스TV');
  const s = splitAggregatorTitle(it.title, it.source);
  assert.equal(s.title, '한전, 개인정보 유출 1만1천명 추가 확인');
  assert.equal(s.outlet, '연합뉴스TV');
  assert.ok(!it.description.includes('<'));
});

const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
<entry><title type="html">Fortinet &amp;amp; friends</title>
<link rel="alternate" href="https://example.com/a?x=1&amp;y=2"/><updated>2026-10-22T10:00:00Z</updated>
<summary>짧은 요약</summary></entry></feed>`;

test('Atom 피드와 위험한 주소', () => {
  const [it] = parseFeed(ATOM);
  assert.equal(it.title, 'Fortinet & friends');
  assert.equal(it.link, 'https://example.com/a?x=1&y=2');
  const bad = parseFeed('<rss><channel><item><title>x</title><link>javascript:alert(1)</link></item></channel></rss>');
  assert.equal(bad.length, 0, 'javascript: 링크 항목은 버린다');
});

test('RSS: DTD·엔티티 선언은 해석하지 않는다', () => {
  const evil = `<?xml version="1.0"?><!DOCTYPE r [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;">]>
<rss><channel><item><title>&b;</title><link>https://example.com/</link></item></channel></rss>`;
  const [it] = parseFeed(evil);
  assert.equal(it.title, '&b;');
});

test('공개 오류 문구: 조직·요청 번호, 키, 메일 주소를 가리고 나머지는 그대로', () => {
  const rate = '429 {"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed the rate limit for your organization (4d1b7c1d-1a2b-4c3d-8e9f-0123456789ab) of 50,000 input tokens per minute."},"request_id":"req_011CTabcdefGHIJK"}';
  const r = publicError(new Error(rate), 400);
  assert.ok(!r.includes('4d1b7c1d') && !r.includes('req_011'), r);
  assert.match(r, /rate_limit_error/);
  assert.equal(publicError('HTTP 401 https://api.example.com/v1?serviceKey=AbC123%2Bxyz&_type=json'), 'HTTP 401 https://api.example.com/v1?serviceKey=…&_type=json');
  assert.equal(publicError('invalid x-api-key sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'), 'invalid x-api-key …');
  assert.equal(publicError('SMTP 로그인 실패 me@gmail.com'), 'SMTP 로그인 실패 …@…');
  assert.equal(publicError('HTTP 503'), 'HTTP 503');
  assert.equal(publicError('AADSTS70000: User account is found to be in service abuse mode.'), 'AADSTS70000: User account is found to be in service abuse mode.');
  assert.equal(publicError('가'.repeat(300)).length, 200, '길이 상한');
  assert.equal(publicError(`토큰 ${'A1'.repeat(20)} 끝`), '토큰 … 끝', '긴 불투명 값은 키로 보고 가림');
});
