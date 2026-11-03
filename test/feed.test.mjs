// 기계가 읽는 취약점 목록(feed): NVD 의 영향 제품·버전 구간 뽑기, 브리핑 → feed, 사이트에 feed/latest.json · 날짜별 파일,
// 메일의 '우리 자산 영향' 단추(Secret ASSET_URL 이 있을 때만, 링크만)
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { affectedOf, parseNvdCve } from '../src/sources/nvd.mjs';
import { mergeAffected } from '../src/vulns.mjs';
import { feedOf, FEED_FORMAT } from '../src/feed.mjs';
import { buildSite } from '../src/site.mjs';
import { saveBrief } from '../src/store.mjs';
import { DEFAULTS, deepMerge } from '../src/config.mjs';
import { assetLink, assetUrlOf, renderEmailHtml } from '../src/mail.mjs';
import { affectedFromRecord, fetchCnaAffected } from '../src/sources/cveorg.mjs';

test('CVE.org(제조사 기록): 영향 버전 구간·정확한 버전·"3.0.*" 꼴, 영향 없음 표시는 뺌, 실패한 번호는 건너뜀', async () => {
  const rec = { cveMetadata: { cveId: 'CVE-2026-118636' }, containers: { cna: { affected: [
    { vendor: 'Apache Software Foundation', product: 'Apache MINA', versions: [{ version: '3.0.0', lessThanOrEqual: '3.0.*', status: 'affected' }, { version: '2.2.0', lessThan: '2.2.5', status: 'affected' }, { version: '2.1.0', status: 'unaffected' }] },
    { vendor: 'Fortinet', product: 'FortiOS', versions: [{ version: '7.4.0', lessThanOrEqual: '7.4.8', status: 'affected' }, { version: '7.2.11', status: 'affected' }] },
    { vendor: 'n/a', product: 'n/a', versions: [{ version: 'n/a', status: 'affected' }] },
    { vendor: 'Acme', product: 'Widget', defaultStatus: 'affected', versions: [{ version: '9.0', status: 'unaffected' }] },
  ] } } };
  assert.deepEqual(affectedFromRecord(rec), [
    { vendor: 'Apache Software Foundation', product: 'Apache MINA', ranges: [{ si: '3.0.0', ee: '3.1' }, { si: '2.2.0', ee: '2.2.5' }] },
    { vendor: 'Fortinet', product: 'FortiOS', ranges: [{ si: '7.4.0', ei: '7.4.8' }, { exact: '7.2.11' }] },
    { vendor: 'Acme', product: 'Widget', ranges: [] },
  ]);
  const asked = [];
  const got = await fetchCnaAffected(['CVE-2026-1001', 'CVE-2026-1002', 'CVE-2026-1001', 'bad'], {
    get: async (url) => {
      asked.push(url);
      if (url.endsWith('1002')) throw new Error('timeout');
      return rec;
    },
  });
  assert.deepEqual(asked, ['https://cveawg.mitre.org/api/cve/CVE-2026-1001', 'https://cveawg.mitre.org/api/cve/CVE-2026-1002']);
  assert.deepEqual([...got.keys()], ['CVE-2026-1001']);
});

const CVE = {
  id: 'CVE-2026-20001',
  configurations: [{ nodes: [{ cpeMatch: [
    { vulnerable: true, criteria: 'cpe:2.3:a:apache:tomcat:*:*:*:*:*:*:*:*', versionStartIncluding: '9.0.0', versionEndExcluding: '9.0.98' },
    { vulnerable: true, criteria: 'cpe:2.3:a:apache:tomcat:*:*:*:*:*:*:*:*', versionStartIncluding: '10.1.0', versionEndExcluding: '10.1.34' },
    { vulnerable: true, criteria: 'cpe:2.3:a:apache:tomcat:11.0.0:milestone1:*:*:*:*:*:*' },
    { vulnerable: true, criteria: 'cpe:2.3:a:apache:tomcat:*:*:*:*:*:*:*:*', versionStartIncluding: '9.0.0', versionEndExcluding: '9.0.98' },
    { vulnerable: false, criteria: 'cpe:2.3:o:linux:linux_kernel:-:*:*:*:*:*:*:*' },
    { vulnerable: true, criteria: 'cpe:2.3:a:acme:web\\:portal:2.0:*:*:*:*:*:*:*' },
  ] }] }],
};

test('NVD: 취약한 CPE 를 제품마다 버전 구간으로(같은 구간은 한 번, 취약하지 않은 플랫폼은 뺌, 이스케이프 풀기)', () => {
  assert.deepEqual(affectedOf(CVE), [
    { vendor: 'apache', product: 'tomcat', ranges: [{ si: '9.0.0', ee: '9.0.98' }, { si: '10.1.0', ee: '10.1.34' }, { exact: '11.0.0-m1' }] },
    { vendor: 'acme', product: 'web:portal', ranges: [{ exact: '2.0' }] },
  ]);
  assert.deepEqual(affectedOf({ configurations: [] }), []);
  // update 칸: Ivanti 22.7:r2.3 → 22.7r2.3 (자산 대장의 22.7R2.3 과 맞게)
  assert.deepEqual(affectedOf({ configurations: [{ nodes: [{ cpeMatch: [{ vulnerable: true, criteria: 'cpe:2.3:a:ivanti:connect_secure:22.7:r2.3:*:*:*:*:*:*' }, { vulnerable: true, criteria: 'cpe:2.3:a:oracle:jdk:1.8.0:update_381:*:*:*:*:*:*' }] }] }] }).map((a) => a.ranges[0].exact), ['22.7r2.3', '1.8.0.381']);
  const many = { configurations: [{ nodes: [{ cpeMatch: Array.from({ length: 300 }, (_, i) => ({ vulnerable: true, criteria: `cpe:2.3:a:v${i % 20}:p:${i}:*:*:*:*:*:*:*` })) }] }] };
  const capped = affectedOf(many);
  assert.equal(capped.length, 10, '제품 10개까지');
  assert.ok(capped.every((a) => a.ranges.length <= 40));
  assert.deepEqual(parseNvdCve({ ...CVE, descriptions: [], metrics: {} }).affected, affectedOf(CVE));
  assert.deepEqual(mergeAffected([{ vendor: 'a', product: 'b', ranges: [{ ee: '1' }] }, { vendor: 'a', product: 'b', ranges: [{ ee: '1' }, { ee: '2' }] }]), [{ vendor: 'a', product: 'b', ranges: [{ ee: '1' }, { ee: '2' }] }]);
});

const BRIEF = {
  version: 1,
  date: '2026-11-03',
  generated_at: '2026-11-03T06:00:56+09:00',
  exploited: [{ id: 'CVE-2026-30001', vendor: 'Ivanti', product: 'Connect Secure', due: '2026-11-10', ransomware: true, cvss: { score: 9.1 }, epss: 0.5, nvd: 'https://nvd.nist.gov/vuln/detail/CVE-2026-30001', ko: { title: 'Ivanti Connect Secure 인증 우회' }, affected: [] }],
  exploited_more: [{ id: 'CVE-2026-30009', title: '그 밖의 KEV', vendor: 'Acme', product: 'Gateway', due: '2026-11-20', affected: [] }],
  critical: [
    { id: 'CVE-2026-30002', ids: ['CVE-2026-30002', 'CVE-2026-30003'], label: 'Apache HTTP Server', vendor: 'Apache', cvss: { score: 9.8 }, epss: 0.1, nvd: 'https://nvd.nist.gov/vuln/detail/CVE-2026-30002', ko: { title: 'Apache HTTP Server 원격 코드 실행 등 2건' }, affected: [{ vendor: 'apache', product: 'http server', ranges: [{ si: '2.4.0', ee: '2.4.63' }] }] },
    { id: 'CVE-2026-30005', ids: ['CVE-2026-30005'], label: 'Apache', vendor: 'Apache', cvss: { score: 9.1 }, ko: { title: 'Apache 취약점' } },
  ],
  critical_more: [
    { id: 'CVE-2026-30006', ids: ['CVE-2026-30006'], label: 'HPE 공지 hpesbhf04900', vendor: 'HPE', cvss: 9.8, title: 'HPE 공지 다수' },
    { id: 'CVE-2026-30007', ids: ['CVE-2026-30007'], label: 'Vvveb', cvss: 9.8, title: 'Vvveb 인증 부적절' },
  ],
  advisories: [],
  news: { domestic: [], international: [] },
  sources: [],
};

test('feed: 브리핑의 악용 확인·고위험·그 밖의 고위험을 한 목록으로, 제품 이름은 제조사뿐·공지 번호 꼴이면 비움', () => {
  const f = feedOf(BRIEF, { url: 'https://u.github.io/sec-brief/' });
  assert.equal(f.format, FEED_FORMAT);
  assert.equal(f.date, '2026-11-03');
  assert.equal(f.page, 'https://u.github.io/sec-brief/b/2026-11-03.html');
  assert.deepEqual(f.items.map((x) => [x.id, x.kind, x.product]), [
    ['CVE-2026-30001', 'kev', 'Connect Secure'],
    ['CVE-2026-30009', 'kev', 'Gateway'],
    ['CVE-2026-30002', 'crit', 'Apache HTTP Server'],
    ['CVE-2026-30005', 'crit', ''],
    ['CVE-2026-30006', 'more', ''],
    ['CVE-2026-30007', 'more', 'Vvveb'],
  ]);
  const kev = f.items[0];
  assert.equal(kev.kev, true);
  assert.equal(kev.due, '2026-11-10');
  assert.equal(kev.ransomware, true);
  assert.equal(kev.cvss, 9.1);
  assert.deepEqual(f.items[2].ids, ['CVE-2026-30002', 'CVE-2026-30003']);
  assert.deepEqual(f.items[2].affected[0].ranges, [{ si: '2.4.0', ee: '2.4.63' }]);
  assert.equal(f.items[4].cvss, 9.8);
  assert.equal(f.items[4].nvd, 'https://nvd.nist.gov/vuln/detail/CVE-2026-30006');
  assert.equal(feedOf(BRIEF, {}).page, '');
});

test('사이트: feed/날짜.json 과 최신 브리핑의 feed/latest.json 을 만든다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sb-feed-'));
  try {
    const cfg = deepMerge(DEFAULTS, {});
    cfg.dataDir = join(dir, 'data');
    cfg.siteDir = join(dir, '_site');
    cfg.site.url = 'https://u.github.io/sec-brief';
    saveBrief(cfg.dataDir, { ...BRIEF, date: '2026-11-02', generated_at: '2026-11-02T06:00:00+09:00' }, '# 11-02');
    saveBrief(cfg.dataDir, BRIEF, '# 11-03');
    buildSite(cfg, { log: () => {} });
    const latest = JSON.parse(readFileSync(join(cfg.siteDir, 'feed', 'latest.json'), 'utf8'));
    assert.equal(latest.date, '2026-11-03');
    assert.equal(JSON.parse(readFileSync(join(cfg.siteDir, 'feed', '2026-11-02.json'), 'utf8')).date, '2026-11-02');
    assert.equal(latest.items.length, 6);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('메일: Secret ASSET_URL 이 있으면 취약점마다 우리 자산 영향 단추(사내 프로그램 화면 링크만), 없으면 그대로', () => {
  assert.equal(assetUrlOf({}), '');
  assert.equal(assetUrlOf({ ASSET_URL: ' ' }), '');
  assert.equal(assetUrlOf({ ASSET_URL: 'javascript:alert(1)' }), '');
  assert.equal(assetUrlOf({ ASSET_URL: '자산서버' }), '');
  assert.equal(assetUrlOf({ ASSET_URL: 'https://asset-pc:4800/' }), 'https://asset-pc:4800');
  assert.equal(assetLink('https://asset-pc:4800', '2026-11-03', 'CVE-2026-30001'), 'https://asset-pc:4800/#/vuln?brief=2026-11-03&cve=CVE-2026-30001');
  const without = renderEmailHtml(BRIEF, { siteUrl: 'https://u.github.io/sec-brief' });
  assert.doesNotMatch(without, /우리 자산 영향/);
  const withLink = renderEmailHtml(BRIEF, { siteUrl: 'https://u.github.io/sec-brief', assetUrl: 'https://asset-pc:4800' });
  for (const id of ['CVE-2026-30001', 'CVE-2026-30002', 'CVE-2026-30005']) assert.match(withLink, new RegExp(`https://asset-pc:4800/#/vuln\\?brief=2026-11-03&amp;cve=${id}`), id);
  assert.match(withLink, /우리 자산 영향 한눈에 보기/);
  assert.match(withLink, /https:\/\/asset-pc:4800\/#\/vuln\?brief=2026-11-03"/);
  assert.ok(Buffer.byteLength(withLink) < 90 * 1024);
});
