import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clusterItems, selectNews } from '../src/news.mjs';
import { impactText, kevTitleKo, productFromDescription, selectCritical, selectExploited } from '../src/vulns.mjs';

const NOW = new Date('2026-10-23T06:30:00Z');
const at = (h) => new Date(NOW.getTime() - h * 3600 * 1000);
const item = (title, outlet, extra = {}) => ({
  title,
  link: `https://news.example/${encodeURIComponent(outlet)}/${encodeURIComponent(title).slice(0, 40)}`,
  outlet,
  lang: /[가-힣]/.test(title) ? 'ko' : 'en',
  kind: 'security',
  published: at(3),
  description: '',
  ...extra,
});

test('같은 사건은 매체가 달라도 한 묶음, 흔한 낱말만 겹치면 따로', () => {
  const items = [
    item('놀유니버스, 시스템 취약점 뚫려 임직원 개인정보 유출', '보안뉴스'),
    item('놀유니버스 임직원 개인정보 유출…"비정상 접근 차단"', '연합뉴스TV'),
    item('놀유니버스, 해킹으로 임직원 정보 유출 확인', '매일일보'),
    item('연세대 포털 해킹으로 개인정보 유출…학번·연락처 포함', '서울신문'),
    item('LiteLLM release pipeline hacked to distribute info-stealer malware', 'BleepingComputer'),
    item('LiteLLM Suspects GitHub Token Leak Behind Malicious Package Release', 'The Hacker News'),
    item('Capcom confirms data breach affecting 11.7 million accounts', 'BleepingComputer'),
  ];
  const groups = clusterItems(items).map((g) => g.map((i) => i.outlet).sort().join('+'));
  assert.ok(groups.includes('매일일보+보안뉴스+연합뉴스TV'), groups.join(' | '));
  assert.ok(groups.includes('서울신문'), '연세대 기사는 따로');
  assert.ok(groups.includes('BleepingComputer+The Hacker News'), 'LiteLLM 은 드문 고유명사로 묶임');
  assert.ok(groups.some((g) => g === 'BleepingComputer'), 'Capcom 은 따로');
});

test('표현만 비슷한 다른 사건(한전·놀유니버스·롯데케미칼·학회)은 따로, 같은 주어(한전)는 한 묶음', () => {
  const items = [
    item('한전, 개인정보 유출 1만1천명 추가 확인…퇴직자·협력사 직원도', '연합뉴스TV'),
    item('한전, 개인정보 유출 1만1천명 추가…퇴직자·협력사 직원 포함', '연합뉴스'),
    item('한전 개인정보 유출 규모 퇴직자·협력사 직원 포함 3만5천 명', '중앙뉴스'),
    item('[국감이슈] 한전 개인정보 유출 3만5528명으로 확대…퇴직자·협력사 직원도 포함', '인더스트리뉴스'),
    item('한전, 개인정보 유출 1만1000명 추가 “조사 과정서 발견”', '국제신문'),
    item('한전 개인정보 유출 3만5528명으로 확대···1만명 추가 확인', '서울파이낸스'),
    item('놀유니버스, 해킹에 임직원 정보 유출…8년 전 퇴직자도 포함', '매일일보'),
    item('놀유니버스, 외부 공격에 개인정보 유출…이용자·임직원 등 피해', 'EBN'),
    item('손명수 의원, 롯데케미칼 퇴직자 5,022명 정보 유출 지적…일부 통지도 누락', '데일리시큐'),
    item('국내 학회·협회도 해킹 피해…개인정보 유출 규모 3만~5만명 추정', '매일일보'),
    item('[PHP 파장] 금융권, PHP 취약점 긴급 보안권고... “금융사 웹 API 즉각 점검해야”', '보안뉴스'),
    item('위드네트웍스, 서비스·SBOM·API 연계한 ‘취약점 조합 상관분석’ 제시', '데일리시큐'),
  ];
  const groups = clusterItems(items).map((g) => g.map((i) => i.outlet).sort().join('+'));
  assert.ok(groups.includes('국제신문+서울파이낸스+연합뉴스+연합뉴스TV+인더스트리뉴스+중앙뉴스'), groups.join(' | '));
  assert.ok(groups.includes('EBN+매일일보'), '놀유니버스 두 건');
  assert.ok(groups.includes('데일리시큐') && groups.filter((g) => g === '데일리시큐').length === 2, '롯데케미칼·위드네트웍스는 각자');
  assert.ok(groups.includes('매일일보'), '학회 기사는 따로');
  assert.ok(groups.includes('보안뉴스'), 'API 만 겹치는 기사는 묶지 않음');
});

test('제목 주어 뽑기', async () => {
  const { subjectOf } = await import('../src/news.mjs');
  assert.equal(subjectOf('[국감이슈] 한전 개인정보 유출 확대'), '한전');
  assert.equal(subjectOf('서울중수청, 금융기관 AI 해킹 사건 수사 않기로'), '서울중수청');
  assert.equal(subjectOf('[속보] 정부, 사이버위기 경보 상향'), '', '일반 주어는 쓰지 않음');
  assert.equal(subjectOf('“북한 인터넷 마비, 디도스 공격 때문”'), '', '북한은 일반 주어');
  assert.equal(subjectOf('LGU+ 홍범식 "해킹 은폐 사실로 확인되면"'), 'LGU+');
});

test('일반 낱말(code execution)만 겹치는 다른 사건은 묶지 않고, 같은 회사 이름(Railway)은 묶는다', () => {
  const items = [
    item('Node.js Brotli Decoder Bug Could Allow Remote Code Execution in All Supported Versions', 'The Hacker News'),
    item('GitLab warns of new max severity code execution vulnerability', 'BleepingComputer'),
    item('Railway Says Intruder May Have Accessed Customer Secrets, Urges Credential Rotation', 'The Hacker News'),
    item('Railway warns devs to rotate secrets after potential breach', 'BleepingComputer'),
    item('Capcom confirms data breach affecting 11.7 million accounts', 'BleepingComputer'),
  ];
  const groups = clusterItems(items).map((g) => g.map((i) => i.title.split(' ')[0]).sort().join('+'));
  assert.ok(groups.includes('Node.js'), groups.join(' | '));
  assert.ok(groups.includes('GitLab'), groups.join(' | '));
  assert.ok(groups.includes('Railway+Railway'), groups.join(' | '));
});

test('선별: 여러 매체 보도가 위로, 홍보·행사·모음 기사는 빠짐, 이미 다룬 주소는 제외', () => {
  const items = [
    item('놀유니버스, 시스템 취약점 뚫려 임직원 개인정보 유출', '보안뉴스'),
    item('놀유니버스 임직원 개인정보 유출…"비정상 접근 차단"', '연합뉴스TV'),
    item('쿠도커뮤니케이션 창립 26주년 기념행사 개최', '데일리시큐'),
    item('랜섬웨어 대응 세미나 개최', '보안뉴스'),
    item('ThreatsDay: AI Secrets Leak, Signal Flaw + 21 More', 'The Hacker News'),
    item('Arista Warns of Critical VeloCloud SQL Injection Zero-Day Exploited in Attacks', 'The Hacker News'),
    item('오래된 해킹 사고 기사', '보안뉴스', { published: at(50) }),
    item('이미 실린 랜섬웨어 기사', '보안뉴스', { link: 'https://news.example/seen' }),
  ];
  const history = { seenUrls: new Set(['https://news.example/seen']), recentNewsTitles: [] };
  const r = selectNews(items, { now: NOW, windowHours: 30, history });
  const titles = [...r.domestic, ...r.international].map((n) => n.title);
  assert.equal(r.domestic[0].outlets.length, 2);
  assert.match(r.domestic[0].title, /놀유니버스/);
  assert.ok(titles.some((t) => /VeloCloud/.test(t)));
  for (const bad of ['창립', '세미나', 'ThreatsDay', '오래된', '이미 실린']) assert.ok(!titles.some((t) => t.includes(bad)), bad);
});

test('일반 IT 매체는 보안 기사만', () => {
  const items = [
    item('삼성 갤럭시핏 4, 3개 색상으로 나온다', '지디넷코리아', { kind: 'general' }),
    item('국내 학회 해킹 피해…개인정보 유출 3만명 추정', '지디넷코리아', { kind: 'general' }),
  ];
  const r = selectNews(items, { now: NOW, windowHours: 30, history: { seenUrls: new Set(), recentNewsTitles: [] } });
  assert.deepEqual(r.domestic.map((n) => n.title), ['국내 학회 해킹 피해…개인정보 유출 3만명 추정']);
});

test('제품 이름 추출(NVD 설명)', () => {
  const cases = [
    ['An issue has been discovered in GitLab CE/EE affecting all versions from 7.0 before 18.11.13', 'GitLab CE/EE'],
    ['VeloCloud Orchestrator (VCO) on-prem has a security issue', 'VeloCloud Orchestrator'],
    ['Wasmtime 39.0.0 before 48.0.4 contains a stack buffer overflow', 'Wasmtime'],
    ['The system control service on affected Kiloview E3 NDI encoder firmware fails', 'Kiloview E3 NDI'],
    ['Improper authentication in AAD App Proxy allows an unauthorized attacker', 'AAD App Proxy'],
    ['Authentication Bypass by Spoofing vulnerability in Brainstorm Force SureCart surecart allows Authentication Abuse.', 'Brainstorm Force SureCart'],
    ['No description provided', ''],
  ];
  for (const [d, want] of cases) assert.equal(productFromDescription(d), want, d);
});

test('KEV 제목 한국어화', () => {
  assert.equal(
    kevTitleKo({ vendor: 'Plex', product: 'Media Server', name: 'Plex Media Server External Control of File Name or Path Vulnerability' }),
    'Plex Media Server 파일 이름·경로 외부 제어 취약점',
  );
  assert.equal(
    kevTitleKo({ vendor: 'Microsoft', product: 'Windows', name: 'Microsoft Windows Some Unusual Weird Thing Vulnerability', cwes: ['CWE-416'] }),
    'Microsoft Windows 해제 후 사용(UAF) 취약점',
  );
});

test('영향 설명', () => {
  assert.equal(
    impactText({ vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' }),
    '원격에서 인증 없이 사용자 개입 없이 공격 가능 — 시스템 장악 우려',
  );
  assert.match(impactText({ vector: 'CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:H/VI:N/VA:N/SC:N/SI:N/SA:N' }), /중요 정보 노출 우려/);
});

const nvd = (id, score, extra = {}) => ({
  id,
  published: '2026-10-22T10:00:00',
  status: 'Received',
  cna: 'security@example.org',
  description: 'Example product before 1.2 allows remote code execution.',
  cvss: { score, version: '3.1', vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' },
  ssvc: null,
  cwes: [],
  refs: [],
  cpe: null,
  kev: null,
  ...extra,
});

test('고위험: 같은 공지 주소의 CVE 는 한 묶음, 벤더당 2묶음까지, 오래된 번호는 뒤로', () => {
  const hpeRef = [{ url: 'https://support.hpe.com/hpesc/public/docDisplay?docId=hpesbnw05162en_us&docLocale=en_US', tags: [] }];
  const rows = [
    ...Array.from({ length: 5 }, (_, i) => nvd(`CVE-2026-7984${i}`, 10, { cna: 'security-alert@hpe.com', description: 'No description provided', refs: hpeRef })),
    nvd('CVE-2026-1', 9.8, { cna: 'secure@microsoft.com', description: 'Missing authentication in Exchange Server allows', refs: [{ url: 'https://msrc.microsoft.com/a', tags: [] }] }),
    nvd('CVE-2026-2', 9.8, { cna: 'secure@microsoft.com', description: 'Use after free in Windows Kernel allows', refs: [{ url: 'https://msrc.microsoft.com/b', tags: [] }] }),
    nvd('CVE-2026-3', 9.8, { cna: 'secure@microsoft.com', description: 'Improper authentication in SharePoint Server allows', refs: [{ url: 'https://msrc.microsoft.com/c', tags: [] }] }),
    nvd('CVE-2021-48014', 9.8, { cna: 'disclosure@vulncheck.com', description: 'FineReport 9.0 contains a path traversal vulnerability' }),
    nvd('CVE-2026-4', 8.0),
  ];
  const r = selectCritical({ nvdRows: rows, watch: ['HPE', 'Microsoft'], today: '2026-10-23', limit: 5 });
  assert.equal(r.total, 9, '9.0 이상만');
  const hpe = r.shown.find((g) => g.vendor === 'HPE');
  assert.equal(hpe.ids.length, 5);
  assert.match(hpe.ko.title, /HPE 공지 hpesbnw05162/);
  assert.equal(r.shown.filter((g) => g.vendor === 'Microsoft').length, 2, '벤더당 2묶음');
  assert.ok(r.shown.findIndex((g) => g.id === 'CVE-2021-48014') === -1 || r.shown.at(-1).id === 'CVE-2021-48014');
});

test('고위험: 관심 제품·KISA 권고는 제품 이름으로만 맞춘다(설명 속 PHP 로 Joomla 를 잡지 않음)', () => {
  const rows = [
    nvd('CVE-2026-102785', 10, { cna: 'security@joomla.org', description: 'An unrestricted file upload in Joomla allows uploading PHP files.' }),
    nvd('CVE-2026-110264', 10, { cna: 'cve@gitlab.com', description: 'An issue has been discovered in GitLab CE/EE affecting all versions before 18.11.13' }),
  ];
  const advisories = [
    { title: 'PHP 보안취약점(PHP2Shell) 관련 기업 보안 대응 수칙', url: 'https://www.boho.or.kr/1' },
    { title: 'GitLab 제품 보안 업데이트 권고', url: 'https://www.boho.or.kr/2' },
  ];
  const r = selectCritical({ nvdRows: rows, advisories, watch: ['PHP', 'GitLab'], today: '2026-10-23' });
  const joomla = r.shown.find((g) => g.id === 'CVE-2026-102785');
  const gitlab = r.shown.find((g) => g.id === 'CVE-2026-110264');
  assert.equal(joomla.flags.kisa, '');
  assert.equal(joomla.flags.watch, '');
  assert.match(gitlab.flags.kisa, /GitLab/);
  assert.equal(gitlab.flags.watch, 'GitLab');
  assert.equal(r.shown[0].id, 'CVE-2026-110264');
});

test('악용 확인: 이미 다룬 CVE 는 빼고, 최근 등재 순', () => {
  const kevItems = [
    { id: 'CVE-1', vendor: 'A', product: 'Alpha', name: 'A Alpha SQL Injection Vulnerability', dateAdded: '2026-10-21', due: '2026-11-11', ransomware: 'Known', description: 'x', cwes: ['CWE-89'], vendorLinks: [] },
    { id: 'CVE-2', vendor: 'B', product: 'Beta', name: 'B Beta Path Traversal Vulnerability', dateAdded: '2026-10-22', due: '2026-11-12', ransomware: 'Unknown', description: 'y', cwes: [], vendorLinks: ['https://b.example/adv'] },
    { id: 'CVE-3', vendor: 'C', product: 'Gamma', name: 'C Gamma Vulnerability', dateAdded: '2026-10-22', due: '', ransomware: 'Unknown', description: 'z', cwes: [], vendorLinks: [] },
  ];
  const r = selectExploited({ kevItems, seenIds: new Set(['CVE-3']) });
  assert.deepEqual(r.shown.map((v) => v.id), ['CVE-2', 'CVE-1']);
  assert.equal(r.shown[1].ransomware, true);
  assert.equal(r.shown[0].ko.title, 'B Beta 경로 조작 취약점');
  assert.deepEqual(r.shown[0].links, ['https://b.example/adv']);
});
