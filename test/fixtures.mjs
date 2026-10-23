// 시험용 브리핑 자료 (node --test 대상 아님: 파일 이름이 *.test.mjs 가 아님)
export function sampleBrief(over = {}) {
  return {
    version: 2,
    date: '2026-10-23',
    generated_at: '2026-10-23T06:41:00+09:00',
    engine: 'rules',
    overview: '',
    cvss_min: 9,
    critical_total: 69,
    exploited: [
      {
        id: 'CVE-2026-96656', section: 'exploited', vendor: 'Plex', product: 'Media Server', name: 'n', dateAdded: '2026-10-20', due: '2026-11-10',
        ransomware: false, description: 'd', cwes: [], cvss: { score: 8.6, version: '3.1', vector: '' }, ssvc: null, epss: 0.008, epssPct: 0.7,
        links: ['https://plex.example/adv'], nvd: 'https://nvd.nist.gov/vuln/detail/CVE-2026-96656',
        ko: { title: 'Plex Media Server 파일 이름·경로 외부 제어 취약점', target: 'Plex Media Server', impact: '실제 공격에 악용됨', action: '즉시 패치' },
      },
    ],
    exploited_more: [{ id: 'CVE-2026-1', title: 'x' }, { id: 'CVE-2026-2', title: 'y' }],
    critical: [
      {
        id: 'CVE-2026-110264', ids: ['CVE-2026-110264'], section: 'critical', label: 'GitLab CE/EE', vendor: 'GitLab', cna: 'cve@gitlab.com', status: 'Received',
        published: '', description: 'An issue has been discovered in GitLab CE/EE', descriptions: [], cwes: ['CWE-190'],
        cvss: { score: 10, version: '3.1', vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H' }, ssvc: null, epss: 0.005,
        links: [], nvd: 'https://nvd.nist.gov/vuln/detail/CVE-2026-110264', flags: { kisa: 'GitLab 제품 보안 업데이트 권고', watch: 'GitLab', news: false }, score: 15,
        ko: { title: 'GitLab CE/EE 정수 오버플로', target: 'GitLab CE/EE 18.11.13 미만', impact: '원격에서 인증 없이', action: '패치' },
      },
    ],
    critical_more: [{ id: 'CVE-2026-9', ids: ['CVE-2026-9'], label: 'Incus', cvss: 9.9, title: 'Incus 경로 조작' }],
    advisories: [
      { id: 'a-1', source: 'KISA 경보단계', title: "사이버위기 경보 단계 '관심' → '주의' 상향 조정", url: 'https://www.boho.or.kr/a', date: '2026-10-22', alert: true },
      { id: 'a-2', source: 'KISA 보안공지', title: 'Laravel 제품 보안 업데이트 권고', url: 'https://www.boho.or.kr/b', date: '2026-10-23' },
      { id: 'a-3', source: 'KISA 보안공지', title: 'Oracle 제품 보안 업데이트 권고', url: 'https://www.boho.or.kr/c', date: '2026-10-23' },
    ],
    news: {
      domestic: [
        { id: 'n-aaaa1111', region: 'domestic', lang: 'ko', title: '놀유니버스, 시스템 취약점 뚫려 임직원 개인정보 유출 “비정상 접근 차단”', url: 'https://news.example/1', source: '보안뉴스', published: '2026-10-22T06:00:00Z', snippet: '요약', outlets: ['보안뉴스', '연합뉴스TV', '매일일보'], related: [], cves: [], score: 24 },
      ],
      international: [
        { id: 'n-bbbb2222', region: 'international', lang: 'en', title: 'Arista Warns of Critical VeloCloud SQL Injection Zero-Day Exploited in Attacks', url: 'https://news.example/2', source: 'The Hacker News', published: '2026-10-22T19:00:00Z', snippet: 's', outlets: ['The Hacker News', 'BleepingComputer'], related: [], cves: [], score: 19 },
      ],
    },
    sources: [{ id: 'kev', name: 'CISA KEV', ok: true, count: 6 }, { id: 'nvd', name: 'NVD', ok: false, count: 0, error: '시간 초과' }],
    summarizer: { engine: 'rules' },
    ...over,
  };
}
