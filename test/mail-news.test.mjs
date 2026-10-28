// 메일에만 붙는 관심 키워드 뉴스: 기간·중복·묶기·순서, 실패 처리, 메일 맨 아래 배치 (실제 네트워크 없음).
// 공개 저장소이므로 실제 검색어 대신 지어낸 회사 이름을 쓴다.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fetchMailNews } from '../src/mail-news.mjs';
import { renderEmailHtml, sendBriefMail } from '../src/mail.mjs';
import { sampleBrief } from './fixtures.mjs';

const KW = '가나다전지';
const NOW = new Date('2026-10-28T21:30:00Z'); // 10-29 06:30 KST 발송
const brief = sampleBrief({
  date: '2026-10-29',
  window: { hours: 30, from: '2026-10-27T15:05:00Z', to: '2026-10-28T21:05:00Z', since_brief: '2026-10-28', since_at: '2026-10-27T21:05:00Z' },
});
// Google 뉴스 RSS 처럼 제목 끝에 ' - 언론사'
const item = (title, outlet, iso, link) => ({ title: `${title} - ${outlet}`, link, published: new Date(iso), source: outlet, description: '' });
const FEED = [
  item('가나다전지, 유럽 배터리사와 양극재 공급 계약 체결', '가신문', '2026-10-28T01:00:00Z', 'https://a.example/1'),
  item('가나다전지 유럽 배터리사와 양극재 공급 계약 체결', '나일보', '2026-10-28T02:00:00Z', 'https://b.example/1'),
  item('가나다전지, 유럽 배터리사 양극재 공급 계약 체결', '다경제', '2026-10-28T03:00:00Z', 'https://c.example/1'),
  item('가나다전지 3분기 영업이익 흑자 전환', '가신문', '2026-10-28T05:00:00Z', 'https://a.example/2'),
  item('가나다전지 공장 화재 진화', '라뉴스', '2026-10-28T20:00:00Z', 'https://d.example/1'),
  item('가나다전지 공장 화재 진화', '라뉴스', '2026-10-28T20:00:00Z', 'https://d.example/1'), // 같은 주소 두 번
  item('가나다전지 지난 브리핑 전 소식', '마신문', '2026-10-27T10:00:00Z', 'https://e.example/1'),
  item('가나다전지 수집 끝 뒤 소식', '바신문', '2026-10-28T21:20:00Z', 'https://f.example/1'), // 다음 브리핑 몫
];

function feed(list = FEED) {
  const urls = [];
  const fn = async ({ url }) => {
    urls.push(url);
    return list;
  };
  return { fn, urls };
}

test('관심 뉴스: 지난 브리핑 수집 끝~이번 수집 끝 사이, 같은 기사·같은 사건은 하나로, 여러 매체가 다룬 순', async () => {
  assert.equal(await fetchMailNews(brief, { env: {}, now: NOW }), null, '검색어가 없으면 없음');
  const f = feed();
  const r = await fetchMailNews(brief, { env: { MAIL_NEWS_KEYWORD: ` ${KW} ` }, now: NOW, getFeed: f.fn });
  assert.equal(r.keyword, KW);
  assert.equal(r.total, 3);
  assert.deepEqual(
    r.items.map((n) => [n.title, n.outlet, n.outlets]),
    [
      ['가나다전지, 유럽 배터리사 양극재 공급 계약 체결', '다경제', 3], // 3곳 보도 — 가장 최근 기사로
      ['가나다전지 공장 화재 진화', '라뉴스', 1], // 매체 수가 같으면 최근 순
      ['가나다전지 3분기 영업이익 흑자 전환', '가신문', 1],
    ],
  );
  assert.equal(r.items[1].published, '2026-10-28T20:00:00.000Z');
  // 검색 기간은 지난 브리핑 이후를 덮게(Google 뉴스 when:일수)
  assert.equal(new URL(f.urls[0]).searchParams.get('q'), `${KW} when:2d`);
  const two = await fetchMailNews(brief, { env: { MAIL_NEWS_KEYWORD: KW }, now: NOW, getFeed: f.fn, limit: 2 });
  assert.equal(two.items.length, 2);
  assert.equal(two.total, 3);
});

test('관심 뉴스: 옛 브리핑은 하루 전부터, 가져오기 실패는 안내만(검색 주소는 남기지 않음)', async () => {
  const old = sampleBrief({ date: '2026-10-29', window: { hours: 30, from: '2026-10-27T15:05:00Z', to: '2026-10-28T21:05:00Z' } });
  const r = await fetchMailNews(old, { env: { MAIL_NEWS_KEYWORD: KW }, now: NOW, getFeed: feed().fn });
  assert.equal(r.total, 3, '10-28 06:05 KST 이후');
  const failed = await fetchMailNews(brief, {
    env: { MAIL_NEWS_KEYWORD: KW },
    now: NOW,
    getFeed: async ({ url }) => {
      throw new Error(`HTTP 503 ${url}`);
    },
  });
  assert.deepEqual(failed, { keyword: KW, items: [], total: 0, error: '기사를 가져오지 못했습니다' });
});

test('메일 본문: 관심 뉴스는 신규 고위험 취약점 다음, 꼬리말 앞(맨 아래)에', async () => {
  const extraNews = await fetchMailNews(brief, { env: { MAIL_NEWS_KEYWORD: KW }, now: NOW, getFeed: feed().fn, limit: 2 });
  const html = renderEmailHtml(brief, { siteUrl: 'https://u.github.io/sec-brief', extraNews });
  const at = (s) => html.indexOf(s);
  assert.ok(at('신규 고위험 취약점') > 0 && at(`${KW} 관련 뉴스`) > at('신규 고위험 취약점'), '고위험 다음');
  assert.ok(at(`${KW} 관련 뉴스`) < at('자동 발송'), '꼬리말 앞');
  assert.match(html, /다경제 외 2곳 · 10\.28 12:00/);
  assert.match(html, /그 밖의 1건은 <a href="https:\/\/news\.google\.com\/search\?q=/);
  assert.ok(!renderEmailHtml(brief, {}).includes('관련 뉴스'), '검색어가 없으면 칸도 없음');
  assert.match(renderEmailHtml(brief, { extraNews: { keyword: KW, items: [], total: 0 } }), /새 기사가 없습니다/);
  assert.match(renderEmailHtml(brief, { extraNews: { keyword: KW, items: [], total: 0, error: '기사를 가져오지 못했습니다' } }), /기사를 가져오지 못했습니다/);
});

test('발송: 브리핑 메일에만 붙고(글자 본문 포함) 연결 확인 메일에는 없다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sb-mailnews-'));
  const cfg = { dataDir: dir, site: { url: 'https://u.github.io/sec-brief', title: '일일 보안 브리핑' } };
  const env = { SMTP_HOST: 'smtp.example.com', SMTP_USER: 'u', SMTP_PASS: 'p', MAIL_TO: 'me@example.org', MAIL_NEWS_KEYWORD: KW };
  const sent = [];
  const transportOverride = {
    sendMail: async (m) => {
      sent.push(m);
      return { accepted: ['me@example.org'], rejected: [] };
    },
  };
  const f = feed();
  await sendBriefMail(cfg, brief, { env, transportOverride, feedOverride: f.fn, log: () => {} });
  assert.ok(sent[0].html.includes(`${KW} 관련 뉴스`));
  assert.match(sent[0].text, new RegExp(`## ${KW} 관련 뉴스\\n\\n- 가나다전지, 유럽 배터리사 양극재 공급 계약 체결 \\(다경제 외 2곳\\) https://c\\.example/1`));
  await sendBriefMail(cfg, null, { env, test: true, transportOverride, feedOverride: f.fn, log: () => {} });
  assert.ok(!sent[1].html.includes('관련 뉴스'));
  assert.equal(f.urls.length, 1, '연결 확인 때는 찾지 않음');
  rmSync(dir, { recursive: true, force: true });
});
