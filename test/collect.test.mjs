// 수집 전체 흐름: 전역 fetch 를 가짜로 바꿔 출처별 성공·실패를 흉내 낸다 (실제 네트워크 없음).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { collectBrief, collectWindow } from '../src/collect.mjs';
import { DEFAULTS, deepMerge } from '../src/config.mjs';
import { setBackoffScale } from '../src/http.mjs';
import { briefFile } from '../src/store.mjs';

setBackoffScale(0);

const NOW = new Date('2026-10-23T21:40:00Z'); // 10-24 06:40 KST
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const rss = (items) =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>${items
    .map((i) => `<item><title><![CDATA[${i.t}]]></title><link>${i.u}</link><pubDate>${i.d}</pubDate><description>${i.s || ''}</description></item>`)
    .join('')}</channel></rss>`;

const kst = (h) => {
  const d = new Date(NOW.getTime() - h * 3600 * 1000 + 9 * 3600 * 1000);
  return d.toISOString().slice(0, 19).replace('T', ' ');
};

function router({ nvdFails = false, allFail = false } = {}) {
  return async (url) => {
    const u = String(url);
    const reply = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
    if (allFail) throw new TypeError('fetch failed');
    if (u.includes('known_exploited_vulnerabilities')) {
      return reply({
        catalogVersion: '2026.10.23',
        vulnerabilities: [
          { cveID: 'CVE-2026-5555', vendorProject: 'Acme', product: 'Gateway', vulnerabilityName: 'Acme Gateway OS Command Injection Vulnerability', dateAdded: '2026-10-23', dueDate: '2026-11-13', knownRansomwareCampaignUse: 'Known', shortDescription: 'x', requiredAction: 'y', notes: 'https://acme.example/adv ; https://nvd.nist.gov/vuln/detail/CVE-2026-5555', cwes: ['CWE-78'] },
          { cveID: 'CVE-2020-0001', vendorProject: 'Old', product: 'Thing', vulnerabilityName: 'Old', dateAdded: '2022-01-01', dueDate: '', knownRansomwareCampaignUse: 'Unknown', shortDescription: '', requiredAction: '', notes: '', cwes: [] },
        ],
      });
    }
    if (u.startsWith('https://services.nvd.nist.gov/')) {
      if (nvdFails) return reply('Service Unavailable (maintenance)', 404);
      if (u.includes('hasKev')) return reply({ totalResults: 0, resultsPerPage: 0, vulnerabilities: [] });
      return reply({
        totalResults: 2,
        resultsPerPage: 2,
        vulnerabilities: [
          { cve: { id: 'CVE-2026-7777', published: '2026-10-23T10:00:00', vulnStatus: 'Received', sourceIdentifier: 'cve@gitlab.com', descriptions: [{ lang: 'en', value: 'An issue has been discovered in GitLab CE/EE affecting all versions before 18.11.13' }], metrics: { cvssMetricV31: [{ source: 'cve@gitlab.com', type: 'Secondary', cvssData: { version: '3.1', baseScore: 10, baseSeverity: 'CRITICAL', vectorString: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H' } }] }, references: [{ url: 'https://about.gitlab.com/releases/x', tags: [] }] } },
          { cve: { id: 'CVE-2026-7778', published: '2026-10-23T10:00:00', vulnStatus: 'Received', sourceIdentifier: 'x@y', descriptions: [{ lang: 'en', value: 'Low thing' }], metrics: { cvssMetricV31: [{ cvssData: { version: '3.1', baseScore: 5.0, vectorString: 'CVSS:3.1/AV:L' } }] }, references: [] } },
        ],
      });
    }
    if (u.startsWith('https://api.first.org/')) return reply({ data: [{ cve: 'CVE-2026-5555', epss: '0.91', percentile: '0.99' }] });
    if (u.includes('boho.or.kr')) {
      return reply(rss([{ t: 'GitLab 제품 보안 업데이트 권고', u: 'https://www.boho.or.kr/kr/bbs/view.do?nttId=1', d: '2026-10-23' }]));
    }
    if (u.includes('boannews')) {
      return reply(rss([
        { t: '○○공사 홈페이지 해킹으로 개인정보 유출', u: 'https://www.boannews.com/a1', d: kst(3), s: '공사 홈페이지가 해킹돼 개인정보가 유출됐다.다음 문장' },
        { t: '△△사 창립 20주년 기념행사 개최', u: 'https://www.boannews.com/a2', d: kst(4) },
      ]));
    }
    if (u.includes('dailysecu')) return reply(rss([{ t: '○○공사 해킹 개인정보 유출 확인', u: 'https://www.dailysecu.com/b1', d: kst(2) }]));
    if (/thehackersnews/i.test(u)) return reply(rss([{ t: 'Acme Gateway Zero-Day Exploited in Ransomware Attacks', u: 'https://thehackernews.com/c1', d: new Date(NOW - 5 * 3600e3).toUTCString() }]));
    return reply(rss([]));
  };
}

function cfgFor(dir) {
  const cfg = deepMerge(DEFAULTS, {});
  cfg.dataDir = join(dir, 'data');
  cfg.siteDir = join(dir, '_site');
  cfg.site.url = 'https://u.github.io/sec-brief';
  return cfg;
}

const env = { NVD_API_KEY: 'test-key' }; // 요청 간격을 짧게
const quiet = () => {};

test('수집: 출처가 정상이면 악용·고위험·KISA·뉴스가 채워지고 이력 파일이 생긴다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sb-collect-'));
  globalThis.fetch = router();
  const { brief } = await collectBrief(cfgFor(dir), { now: NOW, env, log: quiet });
  assert.equal(brief.date, '2026-10-24');
  assert.deepEqual(brief.exploited.map((v) => v.id), ['CVE-2026-5555']);
  assert.equal(brief.exploited[0].epss, 0.91);
  assert.equal(brief.exploited[0].ransomware, true);
  assert.equal(brief.critical_total, 1);
  assert.equal(brief.critical[0].flags.kisa, 'GitLab 제품 보안 업데이트 권고');
  assert.equal(brief.advisories.length, 1);
  assert.equal(brief.news.domestic[0].outlets.length, 2, '같은 사건 두 매체');
  assert.match(brief.news.domestic[0].snippet, /유출됐다\. 다음 문장/, '마침표 뒤 띄어쓰기');
  assert.ok(!JSON.stringify(brief.news).includes('창립'));
  assert.equal(brief.news.international[0].title, 'Acme Gateway Zero-Day Exploited in Ransomware Attacks');
  assert.deepEqual(brief.failed, { kev: false, nvd: false, kisa: false, news: false });
  const md = readFileSync(briefFile(join(dir, 'data'), '2026-10-24', 'md'), 'utf8');
  assert.match(md, /CVE-2026-5555/);
  rmSync(dir, { recursive: true, force: true });
});

test('수집: NVD 가 실패하면 "0건"이 아니라 "수집 실패"로 남긴다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sb-collect-'));
  globalThis.fetch = router({ nvdFails: true });
  const { brief } = await collectBrief(cfgFor(dir), { now: NOW, env, log: quiet });
  assert.equal(brief.failed.nvd, true);
  assert.equal(brief.critical_total, null);
  assert.equal(brief.exploited.length, 1, 'KEV 는 정상');
  assert.ok(brief.sources.some((s) => s.id === 'nvd' && !s.ok && /HTTP 404/.test(s.error)));
  assert.match(brief.overview, /NVD 수집 실패/);
  const md = readFileSync(briefFile(join(dir, 'data'), '2026-10-24', 'md'), 'utf8');
  assert.match(md, /CVSS 9\.0 이상 수집 실패/);
  assert.match(md, /NVD 를 가져오지 못했습니다/);
  rmSync(dir, { recursive: true, force: true });
});

test('수집: 모든 출처가 실패하면 브리핑을 만들지 않고 오류', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sb-collect-'));
  globalThis.fetch = router({ allFail: true });
  const cfg = cfgFor(dir);
  await assert.rejects(collectBrief(cfg, { now: NOW, env, log: quiet }), /모두 실패/);
  rmSync(dir, { recursive: true, force: true });
});

test('수집: 다음 날에는 이미 실은 CVE·기사·공지를 빼고, 같은 날 다시 실행은 건너뛴다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sb-collect-'));
  globalThis.fetch = router();
  const cfg = cfgFor(dir);
  await collectBrief(cfg, { now: NOW, env, log: quiet });
  const again = await collectBrief(cfg, { now: NOW, env, log: quiet });
  assert.equal(again.skipped, true);
  const next = await collectBrief(cfg, { now: new Date(NOW.getTime() + 24 * 3600e3), env, log: quiet });
  assert.equal(next.brief.date, '2026-10-25');
  assert.equal(next.brief.exploited.length, 0, '어제 실은 KEV 는 제외');
  assert.equal(next.brief.critical.length, 0, '어제 실은 CVE 는 제외');
  assert.equal(next.brief.advisories.length, 0, '어제 실은 공지는 제외');
  rmSync(dir, { recursive: true, force: true });
});

test('수집 기간: 평소엔 설정값, 주말·연휴를 쉬고 온 날은 지난 브리핑 이후 전부(최대 10일)', () => {
  const cfg = deepMerge(DEFAULTS, {});
  const at = (iso) => new Date(iso);
  // 어제 브리핑에 이어지면 평소대로
  let w = collectWindow(cfg, { now: at('2026-10-28T21:05:00Z'), date: '2026-10-29', prev: { date: '2026-10-28', window: { to: '2026-10-27T21:04:00Z' } } });
  assert.deepEqual(w, { hours: 30, kevSince: '2026-10-26', advisoryDays: 2, sinceBrief: '2026-10-28' });
  // 금요일 06:05 브리핑 → 월요일 06:05: 72시간 + 1시간 겹침, KEV·KISA 도 금요일부터
  w = collectWindow(cfg, { now: at('2026-11-01T21:05:00Z'), date: '2026-11-02', prev: { date: '2026-10-30', window: { to: '2026-10-29T21:05:00Z' } } });
  assert.deepEqual(w, { hours: 73, kevSince: '2026-10-30', advisoryDays: 4, sinceBrief: '2026-10-30' });
  // 오래 멈췄다 돌아오면 10일까지만
  w = collectWindow(cfg, { now: at('2026-11-30T21:05:00Z'), date: '2026-12-01', prev: { date: '2026-11-01', generated_at: '2026-11-01T06:04:00+09:00' } });
  assert.deepEqual(w, { hours: 240, kevSince: '2026-11-21', advisoryDays: 11, sinceBrief: '2026-11-01' });
  // 첫 브리핑·시각이 없는 옛 브리핑
  assert.deepEqual(collectWindow(cfg, { now: at('2026-10-28T21:05:00Z'), date: '2026-10-29' }), { hours: 30, kevSince: '2026-10-26', advisoryDays: 2, sinceBrief: '' });
  assert.equal(collectWindow(cfg, { now: at('2026-10-28T21:05:00Z'), date: '2026-10-29', prev: { date: '2026-10-28', legacy: true } }).hours, 30);
});

test('수집: 닷새 쉬고 온 날은 NVD·기사를 지난 브리핑 이후부터 모으고 브리핑에 그 기간을 남긴다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sb-collect-'));
  const urls = [];
  const inner = router();
  globalThis.fetch = (url, opts) => {
    urls.push(String(url));
    return inner(url, opts);
  };
  const cfg = cfgFor(dir);
  await collectBrief(cfg, { now: NOW, env, log: quiet }); // 10-24 06:40 KST
  urls.length = 0;
  const later = new Date(NOW.getTime() + 5 * 24 * 3600e3); // 10-29 06:40 KST
  const { brief } = await collectBrief(cfg, { now: later, env, log: quiet });
  assert.equal(brief.date, '2026-10-29');
  assert.equal(brief.window.hours, 121);
  assert.equal(brief.window.since_brief, '2026-10-24');
  const pub = new URL(urls.find((u) => u.includes('pubStartDate')));
  assert.equal(pub.searchParams.get('pubStartDate'), new Date(later.getTime() - 121 * 3600e3).toISOString());
  const kev = new URL(urls.find((u) => u.includes('kevStartDate')));
  assert.equal(kev.searchParams.get('kevStartDate'), '2026-10-24T00:00:00.000Z', 'KEV 등재도 지난 브리핑 날부터');
  rmSync(dir, { recursive: true, force: true });
});
