import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildKakaoTemplate, kakaoText, renderMarkdown, ruleOverview } from '../src/brief.mjs';
import { applySummary, buildInput } from '../src/summarize.mjs';
import { charLength } from '../src/util.mjs';
import { sampleBrief } from './fixtures.mjs';

test('카카오 리스트형: 2~3건, 제목·설명 40자 이하, 앞말·뒷말 보존, 버튼 2개', () => {
  const b = sampleBrief();
  b.overview = ruleOverview(b);
  const t = buildKakaoTemplate(b, { siteUrl: 'https://u.github.io/sec-brief', template: 'list' });
  assert.equal(t.object_type, 'list');
  assert.ok(t.contents.length >= 2 && t.contents.length <= 3);
  assert.ok(charLength(t.header_title) <= 200);
  for (const c of t.contents) {
    assert.ok(charLength(c.title) <= 40, c.title);
    assert.ok(charLength(c.description) <= 40, c.description);
    assert.match(c.link.web_url, /^https:\/\/u\.github\.io\/sec-brief\/b\/2026-10-23\.html#/);
  }
  // 경보가 있는 날: 경보 → 국내 → 해외 (카드는 3장까지라 취약점 카드는 빠짐)
  assert.deepEqual(t.contents.map((c) => c.title.slice(0, 4)), ['[경보]', '[국내]', '[해외]']);
  assert.equal(t.buttons.length, 2);
  assert.equal(t.buttons[1].link.web_url, 'https://u.github.io/sec-brief/archive.html');
});

test('카카오 카드 순서: 경보가 없으면 국내 → 해외 → 악용, 해외는 한국어 제목이 있으면 그것을 쓴다', () => {
  const b = sampleBrief();
  b.advisories = b.advisories.filter((a) => !a.alert);
  b.news.international[0].title_ko = 'Arista VeloCloud 제로데이 공격 악용';
  const t = buildKakaoTemplate(b, { siteUrl: 'https://u.github.io/sec-brief', template: 'list' });
  assert.deepEqual(t.contents.map((c) => c.title.slice(0, 4)), ['[국내]', '[해외]', '[악용]']);
  assert.equal(t.contents[1].title, '[해외] Arista VeloCloud 제로데이 공격 악용');
  assert.match(t.contents[2].title, /^\[악용\] .* 외 2건$/);
  const text = kakaoText(b);
  const order = ['■ 국내', '■ 해외', '■ 악용', '■ 고위험', '■ KISA'].map((k) => text.indexOf(k)).filter((i) => i >= 0);
  assert.deepEqual(order, [...order].sort((x, y) => x - y), text);
});

test('카카오 텍스트형: 200자 이하, 주요 건이 2건 미만이면 텍스트형으로 바뀜', () => {
  const b = sampleBrief();
  const text = kakaoText(b);
  assert.ok(charLength(text) <= 200, String(charLength(text)));
  assert.match(text, /^\[10\.23\(금\) 보안 브리핑\]/);
  const empty = sampleBrief({ exploited: [], exploited_more: [], critical: [], advisories: [], news: { domestic: [], international: [] } });
  const t = buildKakaoTemplate(empty, { siteUrl: '', template: 'list' });
  assert.equal(t.object_type, 'text');
  assert.ok(t.link, '텍스트형도 link 객체는 있어야 한다');
});

test('규칙 기반 요약과 Markdown', () => {
  const b = sampleBrief();
  b.overview = ruleOverview(b);
  assert.match(b.overview, /새 취약점: 실제 악용 3건\(Media Server\) · CVSS 9\.0 이상 69건\./);
  assert.ok(!b.overview.includes('경보'), '경보는 따로 강조하므로 요약에 넣지 않는다');
  const md = renderMarkdown(b, { siteUrl: 'https://u.github.io/sec-brief' });
  assert.match(md, /^# 2026-10-23 \(금\) 보안 브리핑/);
  assert.match(md, /\*\*경보\*\* \[사이버위기 경보 단계/);
  assert.match(md, /## 악용 확인 취약점 \(CISA KEV 신규 3건\)/);
  assert.match(md, /수집: 1\/2곳 정상 · 실패: NVD\(시간 초과\)/);
  const heads = [...md.matchAll(/^## (\S+ ?\S*)/gm)].map((m) => m[1]);
  assert.deepEqual(heads, ['국내 보안', '해외 보안', 'KISA 공지', '악용 확인', '신규 고위험'], 'Markdown 섹션 순서');
  assert.ok(b.overview.indexOf('주요 뉴스') < b.overview.indexOf('새 취약점'), '요약도 뉴스부터');
});

function draftFrom(b) {
  return {
    date: b.date,
    exploited: b.exploited.map((v) => ({ ...v, ko: { ...v.ko } })),
    critical: b.critical.map((g) => ({ ...g, ko: { ...g.ko } })),
    advisories: b.advisories,
    news: { domestic: [...b.news.domestic], international: [...b.news.international] },
    newsCandidates: [...b.news.domestic, ...b.news.international],
    overview: '',
  };
}

test('Claude 응답 반영: 모르는 ID·지어낸 CVE 는 버리고 나머지는 반영', () => {
  const d = draftFrom(sampleBrief());
  const out = {
    overview: 'GitLab CE/EE 를 먼저 패치하세요.',
    news: [
      { id: 'n-bbbb2222', region: 'international', title_ko: 'Arista VeloCloud 제로데이 악용', summary_ko: 'SQL 삽입 취약점이 실제 공격에 쓰임.' },
      { id: 'n-zzzz', region: 'domestic', title_ko: '없는 기사', summary_ko: '-' },
      { id: 'n-aaaa1111', region: 'domestic', title_ko: '놀유니버스 임직원 정보 유출', summary_ko: 'CVE-2099-0001 악용 확인' },
    ],
    vulns: [
      { id: 'CVE-2026-110264', title_ko: 'GitLab 원격 코드 실행', target: 'GitLab CE/EE 18.11.13 미만', impact: '원격·비인증', action: '18.11.13 이상으로 업데이트' },
      { id: 'CVE-2026-96656', title_ko: 'Plex', target: 't', impact: 'CVE-2030-1111 연계', action: 'a' },
      { id: 'CVE-0000-0000', title_ko: 'x', target: 'x', impact: 'x', action: 'x' },
    ],
  };
  const r = applySummary(d, out, { domesticLimit: 5, internationalLimit: 5 });
  assert.equal(d.overview, 'GitLab CE/EE 를 먼저 패치하세요.');
  assert.deepEqual(d.news.international.map((n) => n.title_ko), ['Arista VeloCloud 제로데이 악용']);
  assert.equal(d.news.domestic[0].title_ko, '놀유니버스 임직원 정보 유출');
  assert.equal(d.news.domestic[0].summary_ko, undefined, '지어낸 CVE 가 든 요약은 버림');
  assert.equal(d.critical[0].ko.title, 'GitLab 원격 코드 실행');
  assert.equal(d.exploited[0].ko.title, 'Plex Media Server 파일 이름·경로 외부 제어 취약점', '지어낸 CVE 가 든 항목은 규칙 문안 유지');
  assert.ok(r.rejected.includes('news:n-zzzz') && r.rejected.includes('vuln:CVE-0000-0000') && r.rejected.includes('vuln:CVE-2026-96656'));
});

test('Claude 입력 자료: 기사·취약점만 담고 길이를 줄인다', () => {
  const d = draftFrom(sampleBrief());
  const input = buildInput(d, { newsCandidates: 1 });
  assert.equal(input.news.length, 1);
  assert.equal(input.vulns.length, 2);
  assert.deepEqual(Object.keys(input).sort(), ['date', 'kisa_advisories', 'news', 'vulns']);
});
