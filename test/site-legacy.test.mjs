import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ruleOverview } from '../src/brief.mjs';
import { importLegacy, stripArchiveFooter } from '../src/legacy.mjs';
import { buildSite } from '../src/site.mjs';
import { loadBrief, recentHistory, saveBrief } from '../src/store.mjs';
import { sampleBrief } from './fixtures.mjs';

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'sb-site-'));
  return {
    dir,
    cfg: { dataDir: join(dir, 'data'), siteDir: join(dir, '_site'), site: { title: '일일 보안 브리핑', url: 'https://u.github.io/sec-brief', recent_days: 45 } },
  };
}

const OLD = `[2026-09-02 사이버 보안 일일 브리핑]

[CVE취약점]
1. CVE-2026-1234 (CVSS 9.8점)
- 대상: Example Server 1.0 미만
- 영향: 원격·비인증 공격 가능.
- 조치: 벤더 보안공지 확인 후 패치 적용 — https://vendor.example/adv

[뉴스]
1. 공공기관 해킹 시도 급증
https://news.example/a
참고: "https://quoted.example/x"

지난 브리핑 모아보기
https://claude.ai/code/artifact/abc123
`;

test('이전 도구 파일 옮기기: 아카이브 링크 꼬리 제거, CVE·링크 추출, 새 브리핑은 덮지 않음', () => {
  const { dir, cfg } = workspace();
  const src = join(dir, 'old', 'out');
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, 'daily-brief-20260902.md'), OLD);
  writeFileSync(join(src, 'daily-brief-20261023.md'), OLD);
  writeFileSync(join(src, 'notes.md'), '날짜 없는 파일');
  saveBrief(cfg.dataDir, sampleBrief());
  const r = importLegacy(cfg, join(dir, 'old'), { log: () => {} });
  assert.deepEqual(r.imported, ['2026-09-02']);
  assert.equal(r.skipped.length, 1);
  const b = loadBrief(cfg.dataDir, '2026-09-02');
  assert.equal(b.legacy, true);
  assert.deepEqual(b.cves, ['CVE-2026-1234']);
  assert.ok(!b.text.includes('claude.ai'));
  assert.ok(!b.text.includes('지난 브리핑 모아보기'));
  assert.equal(stripArchiveFooter('a\n\n지난 브리핑 모아보기\nhttps://claude.ai/code/artifact/x\n\n'), 'a');
  assert.equal(loadBrief(cfg.dataDir, '2026-10-23').version, 2, '새 형식 브리핑은 그대로');
  rmSync(dir, { recursive: true, force: true });
});

test('웹 페이지: 날짜별 주소·목록·색인·검색·RSS, 이스케이프, 상대 경로', () => {
  const { dir, cfg } = workspace();
  const b = sampleBrief();
  b.news.domestic[0].title = '<script>alert(1)</script> 해킹';
  b.news.domestic[0].url = 'javascript:alert(1)';
  b.overview = ruleOverview(b);
  saveBrief(cfg.dataDir, b);
  saveBrief(cfg.dataDir, { ...sampleBrief({ date: '2026-10-22', generated_at: '2026-10-22T06:40:00+09:00' }), overview: '어제' });
  mkdirSync(join(dir, 'old'));
  writeFileSync(join(dir, 'old', 'daily-brief-20260902.md'), OLD);
  importLegacy(cfg, join(dir, 'old'), { log: () => {} });
  const r = buildSite(cfg, { log: () => {} });
  assert.equal(r.briefs, 3);
  for (const f of ['index.html', 'archive.html', 'cves.html', 'cves.json', 'search.html', 'search.json', 'feed.xml', '404.html', 'b/2026-10-23.html', 'b/2026-10-23.json', 'b/2026-09-02.html', 'assets/site.css', 'assets/site.js']) {
    assert.ok(existsSync(join(cfg.siteDir, f)), f);
  }
  const day = readFileSync(join(cfg.siteDir, 'b', '2026-10-23.html'), 'utf8');
  assert.ok(!day.includes('<script>alert(1)</script>'), '기사 제목은 이스케이프');
  assert.ok(day.includes('&lt;script&gt;alert(1)&lt;/script&gt; 해킹'));
  assert.ok(!/href="javascript:/i.test(day), 'javascript: 주소는 링크로 만들지 않음');
  assert.ok(day.includes('href="../assets/site.css"'), '하위 폴더 페이지는 상대 경로');
  assert.ok(day.includes('href="2026-10-22.html" rel="prev"'), '이전 날짜로 이동');
  assert.ok(day.includes('id="CVE-2026-110264"'), '카카오 버튼이 가리킬 앵커');
  assert.ok(day.includes('id="kisa"'));
  assert.ok(day.includes('class="alert"'), '경보 강조');
  // 섹션·건수 칸 순서: 국내 뉴스 → 해외 뉴스 → KISA 공지 → 악용 확인 → 신규 고위험
  const order = ['id="news-domestic"', 'id="news-international"', 'id="kisa"', 'id="exploited"', 'id="critical"'].map((s) => day.indexOf(s));
  assert.ok(order.every((i) => i > 0) && order.every((i, k) => k === 0 || i > order[k - 1]), `섹션 순서 ${order}`);
  const tiles = [...day.matchAll(/<li[^>]*><a href="#([\w-]+)"><b>/g)].map((m) => m[1]);
  assert.deepEqual(tiles, ['news-domestic', 'news-international', 'kisa', 'exploited', 'critical']);
  const index = readFileSync(join(cfg.siteDir, 'index.html'), 'utf8');
  assert.ok(index.includes('href="assets/site.css"'));
  assert.ok(index.includes('2026년 10월 23일 (금)'), '첫 화면은 최신 브리핑');
  const legacy = readFileSync(join(cfg.siteDir, 'b', '2026-09-02.html'), 'utf8');
  assert.ok(legacy.includes('지난 형식 브리핑'));
  assert.ok(legacy.includes('<a href="https://vendor.example/adv"'));
  assert.ok(legacy.includes('<a href="https://quoted.example/x" rel="noopener noreferrer">https://quoted.example/x</a>&quot;'), '따옴표는 주소에 넣지 않음');
  const js = readFileSync(join(cfg.siteDir, 'assets', 'site.js'), 'utf8');
  assert.ok(js.includes("/^(https?:\\/\\/|b\\/)/.test(r.u)"), '검색 결과 링크 검사');
  const cves = JSON.parse(readFileSync(join(cfg.siteDir, 'cves.json'), 'utf8'));
  for (let i = 1; i < cves.length; i++) assert.ok(cves[i - 1].d >= cves[i].d, '처음 실린 날 기준 최신순');
  assert.ok(cves.some((c) => c.id === 'CVE-2026-1234' && c.d === '2026-09-02'));
  assert.equal(cves.filter((c) => c.id === 'CVE-2026-96656').length, 1, '여러 날 실려도 한 번(처음 실린 날)');
  assert.equal(cves.find((c) => c.id === 'CVE-2026-96656').d, '2026-10-22');
  const feed = readFileSync(join(cfg.siteDir, 'feed.xml'), 'utf8');
  assert.ok(feed.includes('<link>https://u.github.io/sec-brief/b/2026-10-23.html</link>'));
  assert.ok(feed.includes('[경보]'));
  rmSync(dir, { recursive: true, force: true });
});

test('중복 방지 기록은 오늘 이전 브리핑에서 읽는다', () => {
  const { dir, cfg } = workspace();
  saveBrief(cfg.dataDir, sampleBrief({ date: '2026-10-22' }));
  saveBrief(cfg.dataDir, sampleBrief({ date: '2026-10-23' }));
  const h = recentHistory(cfg.dataDir, '2026-10-23');
  assert.ok(h.exploitedIds.has('CVE-2026-96656'));
  assert.ok(h.exploitedIds.has('CVE-2026-1'), '본문 밖 목록도 포함');
  assert.ok(h.criticalIds.has('CVE-2026-110264') && h.criticalIds.has('CVE-2026-9'));
  assert.ok(h.seenUrls.has('https://news.example/1'));
  assert.equal(h.recentNewsTitles.length, 2);
  const none = recentHistory(cfg.dataDir, '2026-10-22');
  assert.equal(none.exploitedIds.size, 0, '같은 날짜는 빼야 --force 로 다시 만들 때 겹치지 않는다');
  rmSync(dir, { recursive: true, force: true });
});

test('기사 제목 비교: 주말·연휴에 쉬어도 바로 앞 브리핑과는 비교한다(최근 2일 또는 최근 2회 중 긴 쪽)', () => {
  const { dir, cfg } = workspace();
  saveBrief(cfg.dataDir, sampleBrief({ date: '2026-10-23' })); // 금
  assert.equal(recentHistory(cfg.dataDir, '2026-10-26').recentNewsTitles.length, 2, '월요일: 금요일 브리핑 제목과 비교');
  saveBrief(cfg.dataDir, sampleBrief({ date: '2026-10-26' }));
  saveBrief(cfg.dataDir, sampleBrief({ date: '2026-10-27' }));
  assert.equal(recentHistory(cfg.dataDir, '2026-10-28').recentNewsTitles.length, 4, '수요일: 월·화만(금요일은 빠짐)');
  rmSync(dir, { recursive: true, force: true });
});

test('웹 페이지: 주말·연휴 뒤 브리핑은 머리에 "지난 브리핑 이후"를 적는다', () => {
  const { dir, cfg } = workspace();
  saveBrief(cfg.dataDir, sampleBrief({ date: '2026-10-23' }));
  saveBrief(cfg.dataDir, sampleBrief({ date: '2026-10-26', window: { hours: 73, since_brief: '2026-10-23' } }));
  buildSite(cfg, { log: () => {} });
  assert.match(readFileSync(join(cfg.siteDir, 'b', '2026-10-26.html'), 'utf8'), /KST 생성 · 10\.23\(금\) 브리핑 이후 ·/);
  assert.ok(!readFileSync(join(cfg.siteDir, 'b', '2026-10-23.html'), 'utf8').includes('브리핑 이후'));
  rmSync(dir, { recursive: true, force: true });
});
