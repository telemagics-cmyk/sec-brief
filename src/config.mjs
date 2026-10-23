// 설정 읽기: 코드의 기본값 위에 config.json 을 덮고, 환경 변수(비밀값·주소)를 더한다.
// 비밀값(API 키·토큰)은 설정 객체에 담지 않는다 — 필요한 모듈이 secret() 으로 직접 읽는다.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const GOOGLE_NEWS_KR =
  'https://news.google.com/rss/search?q=' +
  encodeURIComponent('해킹 OR 랜섬웨어 OR "개인정보 유출" OR 디도스 OR 악성코드 OR 사이버공격 OR 정보유출 when:1d') +
  '&hl=ko&gl=KR&ceid=KR:ko';

export const DEFAULTS = {
  site: {
    title: '일일 보안 브리핑',
    // 비워 두면 GitHub Actions 가 Pages 주소를 넣어 준다(SITE_URL). 직접 쓰면 그 값을 쓴다.
    url: '',
    recent_days: 45,
  },
  window_hours: 30,
  vulns: {
    cvss_min: 9.0,
    kev_days: 3,
    exploited_limit: 10,
    critical_limit: 5,
    // 관심 제품·벤더: 고위험 취약점 순위에 가점. 기관에서 쓰는 제품을 넣으세요.
    watch: [
      'Microsoft', 'Windows', 'Exchange', 'SharePoint', 'Cisco', 'Fortinet', 'FortiOS', 'FortiGate',
      'Ivanti', 'Citrix', 'NetScaler', 'VMware', 'Palo Alto', 'PAN-OS', 'Juniper', 'F5', 'BIG-IP',
      'SonicWall', 'Check Point', 'Atlassian', 'Confluence', 'Jira', 'GitLab', 'Jenkins', 'Oracle',
      'WebLogic', 'SAP', 'Apache', 'Tomcat', 'Struts', 'nginx', 'OpenSSL', 'OpenSSH', 'PHP', 'Node.js',
      'Kubernetes', 'Docker', 'Chrome', 'Firefox', 'Apple', 'iOS', 'Android', 'Samsung', 'Adobe',
      'Veeam', 'Zimbra', 'MOVEit', 'Arista', 'HPE', 'Aruba', 'Dell', 'Synology', 'QNAP', 'Zyxel',
      'ipTIME', 'Hancom', '한컴', 'AhnLab', '안랩', '이스트소프트', 'Okta', 'Splunk', 'Elastic',
    ],
  },
  news: {
    domestic_limit: 5,
    international_limit: 5,
    feeds: [
      { id: 'boannews', name: '보안뉴스', url: 'https://www.boannews.com/rss/allArticle.xml', lang: 'ko', kind: 'security' },
      { id: 'dailysecu', name: '데일리시큐', url: 'https://www.dailysecu.com/rss/allArticle.xml', lang: 'ko', kind: 'security' },
      { id: 'datanet', name: '데이터넷', url: 'https://www.datanet.co.kr/rss/allArticle.xml', lang: 'ko', kind: 'general' },
      { id: 'zdnetkr', name: '지디넷코리아', url: 'https://feeds.feedburner.com/zdkorea', lang: 'ko', kind: 'general' },
      { id: 'gnews-kr', name: 'Google 뉴스', url: GOOGLE_NEWS_KR, lang: 'ko', kind: 'aggregator' },
      { id: 'bleepingcomputer', name: 'BleepingComputer', url: 'https://www.bleepingcomputer.com/feed/', lang: 'en', kind: 'general' },
      { id: 'thehackernews', name: 'The Hacker News', url: 'https://feeds.feedburner.com/TheHackersNews', lang: 'en', kind: 'security' },
      { id: 'securityweek', name: 'SecurityWeek', url: 'https://www.securityweek.com/feed/', lang: 'en', kind: 'security' },
      { id: 'therecord', name: 'The Record', url: 'https://therecord.media/feed', lang: 'en', kind: 'security' },
      { id: 'darkreading', name: 'Dark Reading', url: 'https://www.darkreading.com/rss.xml', lang: 'en', kind: 'security' },
      { id: 'krebs', name: 'Krebs on Security', url: 'https://krebsonsecurity.com/feed/', lang: 'en', kind: 'security' },
    ],
    // 네이버 뉴스 검색(선택): NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 이 있을 때만 쓴다.
    naver_queries: ['해킹 랜섬웨어 침해사고', '개인정보 유출 보안', '공공기관 사이버공격'],
  },
  advisories: {
    days: 2,
    limit: 10,
    feeds: [
      { id: 'kisa-notice', name: 'KISA 보안공지', url: 'https://www.boho.or.kr/kr/rss.do?bbsId=B0000133' },
      { id: 'kisa-vuln', name: 'KISA 취약점 정보', url: 'https://www.boho.or.kr/kr/rss.do?bbsId=B0000302' },
      { id: 'kisa-alert', name: 'KISA 경보단계', url: 'https://www.boho.or.kr/kr/rss.do?bbsId=B0000342' },
    ],
  },
  summarizer: {
    // auto: ANTHROPIC_API_KEY 가 있으면 Claude 로 한국어 요약, 없으면 규칙 기반 문안
    engine: 'auto',
    model: 'claude-opus-5-5',
    effort: 'medium',
    news_candidates: 40,
  },
  kakao: {
    // list: 주요 3건 카드 + 버튼 2개 / text: 200자 요약 글
    template: 'list',
  },
};

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function deepMerge(base, over) {
  if (!isPlainObject(base) || !isPlainObject(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (k.startsWith('_')) continue; // "_설명" 같은 주석 키
    out[k] = isPlainObject(v) && isPlainObject(base[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}

/** .env (KEY=VALUE) 를 읽어 아직 없는 환경 변수만 채운다. 로컬 실행용. */
export function loadDotEnv(path, env = process.env) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trimStart().startsWith('#')) continue;
    let value = m[2];
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    if (env[m[1]] === undefined || env[m[1]] === '') env[m[1]] = value;
  }
}

export function secret(name, env = process.env) {
  const v = env[name];
  return typeof v === 'string' && v.trim() ? v.trim() : '';
}

export function loadConfig({ root = ROOT, env = process.env } = {}) {
  loadDotEnv(join(root, '.env'), env);
  const path = join(root, 'config.json');
  let user = {};
  if (existsSync(path)) {
    try {
      user = JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));
    } catch (err) {
      throw new Error(`config.json 을 읽지 못했습니다: ${err.message}`);
    }
  }
  const cfg = deepMerge(DEFAULTS, user);
  cfg.root = root;
  cfg.dataDir = env.SEC_BRIEF_DATA_DIR || join(root, 'data');
  cfg.siteDir = env.SEC_BRIEF_SITE_DIR || join(root, '_site');
  cfg.site.url = String(env.SITE_URL || cfg.site.url || '').trim().replace(/\/+$/, '');
  return cfg;
}
