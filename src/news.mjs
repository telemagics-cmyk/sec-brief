// 뉴스 선별: 여러 언론사가 함께 다룬 사건을 한 묶음으로 모으고(TF-IDF 코사인 유사도),
// 보도 언론사 수·핵심어·공공 부문 관련성으로 점수를 매겨 국내/해외 상위 기사를 고른다.
import { canonicalUrl, findCveIds, shortHash, truncate } from './util.mjs';
import { COMMON_EN, NEWS_NOISE, NEWS_WEIGHTS, PUBLIC_SECTOR } from './vocab.mjs';

const STOP_EN = new Set(
  ('the and for with from that this into over after new its are has have was were will can may could says said ' +
    'report reports via amid about more than what how why who your you our their they his her out off not but all ' +
    'any now use used using also just one two three first last year week day today here there under against while ' +
    'been being had does did get gets got make makes made take takes over its it\'s inc ltd corp').split(' '),
);

const JOSA = /(으로써|으로|에서|에게|까지|부터|이다|했다|한다|된다|됐다|하는|하고|라고|이라|으며|에도|에는|과의|와의|이나|[은는이가을를의에도와과로만])$/u;

// 보안 기사라면 어디에나 나오는 말의 두 글자 조각: 사건을 가르는 데 쓸모가 없어 유사도 계산에서 뺀다
const STOP_KO = new Set(
  ('개인 인정 정보 유출 해킹 보안 취약 약점 사이 이버 공격 랜섬 섬웨 웨어 악성 성코 코드 피해 확인 사건 사고 위험 경고 대응 ' +
    '기업 국내 세계 서비 비스 시스 스템 관련 발표 공개 추가 확대 규모 대규 우려 가능 발견 조사 결과 이용 사용 데이 이터 ' +
    '긴급 권고 업데 데이 이트 침해 탈취 고객 당국 정부 ' +
    // 숫자 단위: '1만명', '3억원' 처럼 다른 사건에도 흔하다
    '만명 천명 백명 만건 천건 억원 조원 만원 백만 천만 수백 수천 수만 이상 이하 추정').split(' '),
);

/** 제목 → 특징어 묶음 (영문 단어·CVE 번호·한글 두 글자 조각) */
export function features(title) {
  const t = String(title ?? '')
    .normalize('NFKC')
    .replace(/\[[^\]]{1,12}\]|【[^】]{1,12}】/g, ' ')
    .toLowerCase();
  const tf = new Map();
  const add = (k, w = 1) => tf.set(k, (tf.get(k) || 0) + w);
  for (const id of findCveIds(t)) add(id.toLowerCase(), 3);
  for (const w of t.match(/[a-z0-9][a-z0-9.+-]*[a-z0-9]/g) || []) {
    if (w.length < 3 || STOP_EN.has(w) || /^\d+$/.test(w) || /^cve-/.test(w)) continue;
    add(w.replace(/(\.|-)$/, ''));
  }
  for (const raw of t.match(/[가-힣]+/g) || []) {
    const w = raw.length > 2 ? raw.replace(JOSA, '') : raw;
    if (w.length < 2) continue;
    for (let i = 0; i + 1 < w.length; i++) {
      const bg = w.slice(i, i + 2);
      if (!STOP_KO.has(bg)) add(bg);
    }
  }
  return tf;
}

/** 같은 매체의 같은 제목(직접 피드 + Google 뉴스로 두 번 들어온 기사)은 하나로 */
function dedupeSameStory(items) {
  const seen = new Map();
  const out = [];
  for (const it of items) {
    const key = `${it.outlet}|${String(it.title).replace(/\s+/g, '')}`;
    const prev = seen.get(key);
    if (prev) {
      // 직접 피드 쪽(원문 주소)을 남긴다
      if ((KIND_RANK[it.kind] ?? 2) < (KIND_RANK[prev.kind] ?? 2)) out[out.indexOf(prev)] = it;
      continue;
    }
    seen.set(key, it);
    out.push(it);
  }
  return out;
}

function vectorize(items) {
  const df = new Map();
  for (const it of items) for (const k of it._tf.keys()) df.set(k, (df.get(k) || 0) + 1);
  const n = items.length;
  for (const it of items) {
    const v = new Map();
    let norm = 0;
    for (const [k, tf] of it._tf) {
      const w = tf * (Math.log((n + 1) / ((df.get(k) || 0) + 1)) + 1);
      v.set(k, w);
      norm += w * w;
    }
    it._vec = v;
    it._norm = Math.sqrt(norm) || 1;
  }
  return df;
}

/**
 * 드문 영어 낱말(그날 3건 이하에만 나오는 다섯 글자 이상): 같은 사건 판정의 실마리.
 * 그중 'LiteLLM'·'ConnectWise'·'VeloCloud'·'Storm-0940'·'CISA' 처럼 대소문자가 섞이거나 숫자가 붙은
 * 고유명사는 strong 으로 따로 모은다.
 */
function anchorsOf(it, df) {
  const weak = new Set();
  const strong = new Set();
  const words = String(it.title).match(/[A-Za-z][A-Za-z0-9.+-]*[A-Za-z0-9]/g) || [];
  const proper = new Set(words.filter((w) => /[a-z][A-Z]|[A-Z]{2,}[a-z]|[A-Za-z]-?\d|^[A-Z]{3,}$/.test(w)).map((w) => w.toLowerCase()));
  // 대문자로 시작하는 낱말만(문장형 제목에서 'execution' 같은 일반 낱말은 소문자로 쓴다)
  const capitalized = new Set(words.filter((w) => /^[A-Z]/.test(w)).map((w) => w.toLowerCase()));
  for (const k of it._tf.keys()) {
    if ((df.get(k) || 0) > 3 || COMMON_EN.has(k)) continue;
    if (proper.has(k) && k.length >= 3) strong.add(k);
    else if (/^[a-z][a-z0-9.+-]{4,}$/.test(k) && capitalized.has(k)) weak.add(k);
  }
  return { weak, strong };
}

function shares(a, b) {
  for (const x of a) if (b.has(x)) return true;
  return false;
}

function cosine(a, b) {
  const [small, big] = a._vec.size <= b._vec.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [k, w] of small._vec) {
    const o = big._vec.get(k);
    if (o) dot += w * o;
  }
  return dot / (a._norm * b._norm);
}

export function keywordScore(text) {
  let s = 0;
  for (const [w, re] of NEWS_WEIGHTS) if (re.test(text)) s += w;
  return Math.min(s, 12);
}

export function isNoise(title) {
  return NEWS_NOISE.some((re) => re.test(title));
}

const KIND_RANK = { security: 0, general: 1, search: 2, aggregator: 3 };

function itemRank(it) {
  return (KIND_RANK[it.kind] ?? 2) * 10 + (it.priority ?? 5);
}

/**
 * 두 기사의 유사도(0~1): 같은 CVE 면 1, 아니면 제목 코사인 유사도에
 * 드문 고유명사(LiteLLM·ConnectWise 등)를 함께 쓰면 가산.
 */
function pairSimilarity(a, b, A, B, cvesA, cvesB) {
  if (cvesA.length && cvesA.some((c) => cvesB.includes(c))) return 1;
  const s = cosine(a, b);
  if (s >= 0.1 && shares(A.strong, B.strong)) return Math.max(s, 0.5);
  if (s >= 0.2 && (shares(A.weak, B.weak) || shares(A.strong, B.strong))) return Math.max(s, 0.45);
  return s;
}

/**
 * 묶음 만들기 — 평균 연결 계층 군집(UPGMA).
 * 두 묶음의 '모든 기사 쌍 평균 유사도'가 threshold 이상일 때만 합친다. 한 쌍만 비슷해도 이어 붙이는
 * 단일 연결은 '퇴직자 포함' 같은 표현을 공유한 다른 사건(놀유니버스·한전)을 사슬처럼 엮는다.
 * @param {object[]} items  {title, link, outlet, lang, kind, published, description}
 */
export function clusterItems(items, { threshold = 0.36 } = {}) {
  const n = items.length;
  for (const it of items) it._tf = features(it.title);
  const df = vectorize(items);
  const anchors = items.map((it) => anchorsOf(it, df));
  const cves = items.map((it) => findCveIds(it.title));
  // 묶음 사이 유사도 합(0 이 아닌 것만)
  const sums = new Map(items.map((_, i) => [i, new Map()]));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const s = pairSimilarity(items[i], items[j], anchors[i], anchors[j], cves[i], cves[j]);
      if (s > 0.05) {
        sums.get(i).set(j, s);
        sums.get(j).set(i, s);
      }
    }
  }
  const members = new Map(items.map((_, i) => [i, [i]]));
  for (;;) {
    let best = null;
    let bestAvg = threshold;
    for (const [a, m] of sums) {
      for (const [b, sum] of m) {
        if (a >= b) continue;
        const avg = sum / (members.get(a).length * members.get(b).length);
        if (avg >= bestAvg) {
          bestAvg = avg;
          best = [a, b];
        }
      }
    }
    if (!best) break;
    const [a, b] = best;
    // b 를 a 에 합친다
    const ma = sums.get(a);
    for (const [c, sum] of sums.get(b)) {
      if (c === a) continue;
      ma.set(c, (ma.get(c) || 0) + sum);
      const mc = sums.get(c);
      mc.set(a, (mc.get(a) || 0) + sum);
      mc.delete(b);
    }
    ma.delete(b);
    sums.delete(b);
    members.get(a).push(...members.get(b));
    members.delete(b);
  }
  return foldBySubject([...members.values()].map((idx) => idx.map((i) => items[i])));
}

// 주어로 쓰여도 사건을 가르지 못하는 말
const GENERIC_SUBJECT = new Set(
  ('국내 국외 해외 정부 당국 경찰 검찰 법원 국회 속보 단독 종합 美 北 中 日 韓 英 미국 중국 북한 일본 한국 러시아 세계 전세계 ' +
    '글로벌 기업 금융권 공공기관 해커 해커들 해킹 해킹조직 랜섬웨어 보안 사이버 개인정보 국정원 과기정통부 개인정보위 금융당국 ' +
    '금감원 금융위 KISA 전문가 업계 이용자 시민 정보 단독후속 AI IT SW ICT 사이버보안 보안업계 정보보호 인공지능 생성형 ' +
    '클라우드 디지털 빅테크 기업들 은행 은행권 카드사 통신사 대학 병원').split(' '),
);

/** 한국어 제목의 주어(첫 낱말): '[국감이슈] 한전 개인정보…' → '한전' */
export function subjectOf(title) {
  const t = String(title)
    .replace(/^(\s*(\[[^\]]{0,15}\]|【[^】]{0,15}】|<[^>]{0,15}>|\([^)]{0,10}\))\s*)+/, '')
    .replace(/^["'“‘’”]+/, '');
  const m = t.match(/^([가-힣A-Za-z0-9+&·]{2,12})(?=[,\s…·:"'“”‘’]|$)/);
  if (!m) return '';
  const w = m[1].replace(/(은|는|이|가|도|의|에서|에)$/, '');
  return w.length >= 2 && !GENERIC_SUBJECT.has(w) ? w : '';
}

/**
 * 2단계: 평균 연결은 특징어가 적은 짧은 제목('한전, 개인정보 유출 1만1000명 추가')을 따로 남기기 쉽다.
 * 한국어 기사 묶음의 대표 주어(절반 이상이 같은 주어로 시작)가 같으면 같은 사건으로 보고 합친다.
 */
function foldBySubject(groups) {
  const dominant = (g) => {
    const ko = g.filter((it) => it.lang === 'ko');
    if (!ko.length) return '';
    const count = new Map();
    for (const it of ko) {
      const s = subjectOf(it.title);
      if (s) count.set(s, (count.get(s) || 0) + 1);
    }
    const [best, n] = [...count.entries()].sort((a, b) => b[1] - a[1])[0] || ['', 0];
    return n * 2 >= ko.length ? best : '';
  };
  const home = new Map();
  const out = [];
  for (const g of [...groups].sort((a, b) => b.length - a.length)) {
    const s = dominant(g);
    if (s && home.has(s)) home.get(s).push(...g);
    else {
      out.push(g);
      if (s) home.set(s, g);
    }
  }
  return out;
}

function textOf(it) {
  return `${it.title} ${String(it.description || '').slice(0, 200)}`;
}

/** 묶음 하나 → 브리핑용 기사 객체와 점수 */
export function summarizeCluster(group, { now = new Date(), recentTitles = [] } = {}) {
  const sorted = [...group].sort((a, b) => itemRank(a) - itemRank(b) || (b.published?.getTime() ?? 0) - (a.published?.getTime() ?? 0));
  const rep = sorted.find((it) => !isNoise(it.title)) || sorted[0];
  const outlets = [...new Set(sorted.map((it) => it.outlet).filter(Boolean))];
  // 핵심어(최대 9) + 보도 매체 수(로그 비례, 최대 12): 이슈는 '얼마나 많은 매체가 다뤘나'가 더 중요하다
  const kw = Math.min(9, Math.max(...sorted.map((it) => keywordScore(it.title) + 0.5 * keywordScore(String(it.description || '').slice(0, 200)))));
  let score = kw;
  score += Math.min(12, 3.2 * Math.log2(outlets.length));
  if (rep.lang === 'ko' && sorted.some((it) => PUBLIC_SECTOR.test(it.title))) score += 1;
  const cves = [...new Set(sorted.flatMap((it) => findCveIds(textOf(it))))];
  if (cves.length) score += 1;
  const newest = Math.max(...sorted.map((it) => it.published?.getTime() ?? 0));
  if (newest && now.getTime() - newest < 12 * 3600 * 1000) score += 1;
  // 같은 보도자료를 여러 매체가 실은 홍보 기사는 '여러 매체 보도'로 점수가 부풀므로 묶음 단위로 감점
  const noiseRatio = sorted.filter((it) => isNoise(it.title)).length / sorted.length;
  if (isNoise(rep.title) || noiseRatio >= 0.34) score -= 6;
  // 최근 브리핑에서 이미 다룬 사건이면 감점(보도가 크게 늘어난 경우는 예외)
  const repeat = recentTitles.length ? recentSimilarity(rep.title, recentTitles) : 0;
  if (repeat >= 0.5 && outlets.length < 3) score -= 5;
  const related = sorted
    .filter((it) => it !== rep)
    .filter((it, i, arr) => arr.findIndex((o) => o.outlet === it.outlet) === i && it.outlet !== rep.outlet)
    .slice(0, 5)
    .map((it) => ({ title: it.title, url: it.link, source: it.outlet }));
  return {
    id: `n-${shortHash(canonicalUrl(rep.link), 8)}`,
    region: rep.lang === 'ko' ? 'domestic' : 'international',
    lang: rep.lang,
    title: rep.title,
    url: rep.link,
    source: rep.outlet,
    published: rep.published ? rep.published.toISOString() : '',
    // 문단을 이어 붙인 RSS 요약은 '…겪었다.놀유니버스는' 처럼 마침표 뒤가 붙어 있다
    snippet: truncate(rep.kind === 'aggregator' ? '' : String(rep.description || '').replace(/([.!?])(?=[가-힣A-Z"“‘'])/g, '$1 '), 220),
    outlets,
    related,
    cves,
    score: Math.round(score * 10) / 10,
  };
}

function recentSimilarity(title, recentTitles) {
  const probe = { _tf: features(title) };
  const others = recentTitles.map((t) => ({ _tf: features(t) }));
  vectorize([probe, ...others]);
  return Math.max(0, ...others.map((o) => cosine(probe, o)));
}

/**
 * 수집한 기사 → {domestic, international, candidates}
 * @param {object[]} items  피드에서 읽은 기사(outlet·lang·kind 를 붙인 것)
 * @param {{seenUrls:Set<string>, recentNewsTitles:string[]}} history
 */
export function selectNews(items, { now = new Date(), windowHours = 30, history, domesticLimit = 5, internationalLimit = 5, minScore = 4 } = {}) {
  const from = now.getTime() - windowHours * 3600 * 1000;
  const seen = history?.seenUrls ?? new Set();
  const fresh = [];
  const urlSeen = new Set();
  for (const it of items) {
    const t = it.published?.getTime();
    if (!t || t < from || t > now.getTime() + 3600 * 1000) continue;
    const key = canonicalUrl(it.link);
    if (seen.has(key) || urlSeen.has(key)) continue;
    // 일반 IT 매체·검색 결과는 보안 기사로 보이는 것만
    if (it.kind !== 'security' && keywordScore(it.title) < 3) continue;
    urlSeen.add(key);
    fresh.push(it);
  }
  const clusters = clusterItems(dedupeSameStory(fresh)).map((g) => summarizeCluster(g, { now, recentTitles: history?.recentNewsTitles ?? [] }));
  clusters.sort((a, b) => b.score - a.score || b.outlets.length - a.outlets.length);
  const eligible = clusters.filter((c) => c.score >= minScore);
  return {
    domestic: eligible.filter((c) => c.region === 'domestic').slice(0, domesticLimit),
    international: eligible.filter((c) => c.region === 'international').slice(0, internationalLimit),
    candidates: eligible,
    stats: { items: items.length, fresh: fresh.length, clusters: clusters.length, eligible: eligible.length },
  };
}
