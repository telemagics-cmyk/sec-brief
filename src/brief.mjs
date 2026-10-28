// 브리핑 조립과 출력 형식: 저장용 Markdown, 카카오톡 메시지(리스트형·텍스트형 템플릿).
import { addDays, charLength, fmtPercent, shortDay, truncate, weekdayKo } from './util.mjs';

export const BRIEF_VERSION = 2;

/** 주말·연휴 뒤 브리핑이면 '10.30(금) 브리핑 이후' — 바로 전날 브리핑에 이어지면 빈 문자열 */
export function sinceNote(b) {
  const s = b.window?.since_brief;
  return s && s < addDays(b.date, -1) ? `${shortDay(s)} 브리핑 이후` : '';
}

export function briefUrl(siteUrl, date) {
  return siteUrl ? `${siteUrl}/b/${date}.html` : '';
}

export function allNews(brief) {
  return [...(brief.news?.domestic || []), ...(brief.news?.international || [])];
}

function names(list, n = 3) {
  const out = list.slice(0, n);
  return `${out.join(', ')}${list.length > n ? ' 등' : ''}`;
}

/**
 * 규칙 기반 오늘의 요약 (Claude 를 쓰지 않을 때). 조사(이/가, 와/과)가 틀리지 않게 '항목: 값' 꼴로 쓴다.
 * 경보 단계 변경은 페이지·메시지에서 따로 강조하므로 여기에는 넣지 않는다.
 */
export function ruleOverview(b) {
  // 순서: 주요 뉴스 → KISA 공지 → 취약점 (웹 페이지 섹션 순서와 같음)
  const parts = [];
  const news = [];
  const dn = b.news?.domestic?.[0];
  if (dn) news.push(`국내 '${truncate(dn.title_ko || dn.title, 30)}'${dn.outlets?.length > 1 ? `(${dn.outlets.length}개 매체)` : ''}`);
  const intl = b.news?.international?.[0];
  if (intl) news.push(`해외 '${truncate(intl.title_ko || intl.title, 34)}'${intl.outlets?.length > 1 ? `(${intl.outlets.length}개 매체)` : ''}`);
  if (news.length) parts.push(`주요 뉴스: ${news.join(', ')}.`);
  const adv = (b.advisories || []).filter((a) => !a.alert);
  if (adv.length) parts.push(`KISA 공지 ${adv.length}건.`);
  const ex = b.exploited || [];
  const exTotal = ex.length + (b.exploited_more?.length || 0);
  const cr = b.critical || [];
  const vulns = [];
  if (exTotal) {
    const rw = ex.filter((v) => v.ransomware).length;
    vulns.push(`실제 악용 ${exTotal}건(${names([...new Set(ex.map((v) => v.product || v.id))], 2)}${rw ? `, 랜섬웨어 악용 ${rw}건` : ''})`);
  }
  if (b.critical_total) vulns.push(`CVSS ${Number(b.cvss_min).toFixed(1)} 이상 ${b.critical_total}건`);
  const lost = failedVulnSources(b);
  if (vulns.length) parts.push(`새 취약점: ${vulns.join(' · ')}${lost ? ` (${lost} 수집 실패)` : ''}.`);
  else parts.push(lost ? `취약점 출처를 가져오지 못했습니다(${lost}).` : '새로 확인된 고위험 취약점은 없습니다.');
  if (cr.length) parts.push(`먼저 볼 취약점: ${names(cr.map((g) => g.label), 3)}.`);
  return parts.join(' ');
}

/** 사이버위기 경보 단계 변경 공지 (있으면) */
export function alertOf(b) {
  return (b.advisories || []).find((a) => a.alert) || null;
}

/** 'CISA KEV·NVD' 처럼 실패한 취약점 출처 이름 (없으면 빈 문자열) */
export function failedVulnSources(b) {
  const f = b.failed || {};
  return [f.kev && 'CISA KEV', f.nvd && 'NVD'].filter(Boolean).join('·');
}

/** 섹션이 비었을 때의 안내: 실패했으면 '가져오지 못함', 아니면 '없음' */
export function emptyNote(b, key) {
  const f = b.failed || {};
  const map = {
    exploited: [f.kev, 'CISA KEV 를 가져오지 못했습니다(아래 수집 상태 참고).', '새로 등재된 항목이 없습니다.'],
    critical: [f.nvd, 'NVD 를 가져오지 못했습니다(아래 수집 상태 참고).', '새로 공개된 고위험 취약점이 없습니다.'],
    kisa: [f.kisa, 'KISA 공지를 가져오지 못했습니다(아래 수집 상태 참고).', '새 공지가 없습니다.'],
    news: [f.news, '뉴스 출처를 가져오지 못했습니다(아래 수집 상태 참고).', '선별된 기사가 없습니다.'],
  };
  const [bad, failText, noneText] = map[key];
  return bad ? failText : noneText;
}

function vulnBadges(v) {
  const out = [];
  if (v.cvss) out.push(`CVSS ${v.cvss.score.toFixed(1)}`);
  if (v.epss) out.push(`EPSS ${fmtPercent(v.epss)}`);
  if (v.section === 'exploited') {
    out.push('KEV');
    if (v.ransomware) out.push('랜섬웨어 악용');
    if (v.due) out.push(`기한 ${v.due}`);
  }
  if (v.ssvc?.exploitation === 'active' && v.section !== 'exploited') out.push('악용 확인(SSVC)');
  else if (v.ssvc?.exploitation === 'poc') out.push('공개 PoC');
  if (v.flags?.kisa) out.push('KISA 권고');
  if (v.flags?.news) out.push('뉴스 보도');
  if (v.flags?.watch) out.push(`관심: ${v.flags.watch}`);
  return out;
}
export { vulnBadges };

function mdEscape(s) {
  return String(s ?? '').replace(/([\\`*_[\]<>|])/g, '\\$1');
}

function mdLink(text, url) {
  return url ? `[${mdEscape(text)}](${url})` : mdEscape(text);
}

/** 저장소에 남는 사람이 읽을 Markdown 전문 */
export function renderMarkdown(b, { siteUrl = '' } = {}) {
  const L = [];
  L.push(`# ${b.date} (${weekdayKo(b.date)}) 보안 브리핑`, '');
  const alert = alertOf(b);
  if (alert) L.push(`**경보** ${mdLink(alert.title, alert.url)} (${mdEscape(alert.source)}, ${alert.date})`, '');
  L.push(`> ${mdEscape(b.overview)}`, '');
  const since = sinceNote(b);
  L.push(`생성 ${b.generated_at.replace('T', ' ').slice(0, 16)} KST${since ? ` · ${since}` : ''} · 요약 ${b.engine === 'rules' ? '규칙 기반' : b.engine}${siteUrl ? ` · ${mdLink('웹에서 보기', briefUrl(siteUrl, b.date))}` : ''}`, '');

  const vulnBlock = (v, i, header) => {
    L.push(`### ${i}. ${header}`);
    L.push(`- ${vulnBadges(v).join(' · ')}`);
    L.push(`- 대상: ${mdEscape(v.ko.target)}`);
    L.push(`- 영향: ${mdEscape(v.ko.impact)}`);
    L.push(`- 조치: ${mdEscape(v.ko.action)}`);
    const refs = [...(v.links || []).map((u, k) => mdLink(k === 0 ? '벤더 공지' : `참고 ${k}`, u)), mdLink('NVD', v.nvd)];
    L.push(`- 참고: ${refs.join(' · ')}`, '');
  };

  // 순서: 국내 뉴스 → 해외 뉴스 → KISA 공지 → 악용 확인 취약점 → 신규 고위험 취약점 (웹 페이지와 같음)
  for (const [key, title] of [['domestic', '국내 보안 뉴스'], ['international', '해외 보안 뉴스']]) {
    const list = b.news?.[key] || [];
    L.push(`## ${title} (${list.length}건)`, '');
    if (!list.length) L.push(emptyNote(b, 'news'), '');
    list.forEach((n, i) => {
      const extra = n.outlets.length > 1 ? ` 외 ${n.outlets.length - 1}곳` : '';
      L.push(`${i + 1}. ${mdLink(n.title_ko || n.title, n.url)} — ${mdEscape(n.source)}${extra}`);
      if (n.title_ko && n.title_ko !== n.title) L.push(`   - 원제: ${mdEscape(n.title)}`);
      if (n.summary_ko) L.push(`   - ${mdEscape(n.summary_ko)}`);
      for (const r of n.related || []) L.push(`   - 함께 보도: ${mdLink(r.title, r.url)} (${mdEscape(r.source)})`);
    });
    L.push('');
  }

  L.push(`## KISA 공지 (${(b.advisories || []).length}건)`, '');
  if (!(b.advisories || []).length) L.push(emptyNote(b, 'kisa'));
  for (const a of b.advisories || []) L.push(`- ${mdLink(a.title, a.url)} (${a.source}, ${a.date})`);
  L.push('');

  const ex = b.exploited || [];
  L.push(`## 악용 확인 취약점 (CISA KEV 신규 ${b.failed?.kev ? '수집 실패' : `${ex.length + (b.exploited_more?.length || 0)}건`})`, '');
  if (!ex.length) L.push(emptyNote(b, 'exploited'), '');
  ex.forEach((v, i) => vulnBlock(v, i + 1, `${v.id} — ${mdEscape(v.ko.title)}`));
  if (b.exploited_more?.length) L.push(`그 밖에: ${b.exploited_more.map((v) => v.id).join(', ')}`, '');

  const cr = b.critical || [];
  L.push(`## 신규 고위험 취약점 (CVSS ${Number(b.cvss_min).toFixed(1)} 이상 ${b.critical_total ?? '수집 실패'}${b.critical_total === null ? '' : `건 중 주요 ${cr.length}묶음`})`, '');
  if (!cr.length) L.push(emptyNote(b, 'critical'), '');
  cr.forEach((g, i) => vulnBlock(g, i + 1, `${g.ids.length > 1 ? `${g.id} 외 ${g.ids.length - 1}건` : g.id} — ${mdEscape(g.ko.title)}`));
  if (b.critical_more?.length) {
    L.push('<details><summary>그 밖의 고위험 취약점</summary>', '');
    for (const g of b.critical_more) L.push(`- ${g.ids.join(', ')} (CVSS ${g.cvss.toFixed(1)}) ${mdEscape(g.label)}`);
    L.push('', '</details>', '');
  }

  L.push('---', '');
  const bad = (b.sources || []).filter((s) => !s.ok);
  L.push(`수집: ${(b.sources || []).filter((s) => s.ok).length}/${(b.sources || []).length}곳 정상${bad.length ? ` · 실패: ${bad.map((s) => `${s.name}(${mdEscape(s.error)})`).join(', ')}` : ''}`);
  return `${L.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

// ------------------------------------------------------------------ 카카오톡

function linkObj(url) {
  return url ? { web_url: url, mobile_web_url: url } : { web_url: '', mobile_web_url: '' };
}

const KAKAO_TITLE = 40;
const KAKAO_DESC = 40;

/** '[악용] 긴 제목… 외 5건' — 잘라도 앞말·뒷말은 남긴다 */
function fit(prefix, main, suffix = '', max = KAKAO_TITLE) {
  return `${prefix}${truncate(main, Math.max(6, max - charLength(prefix) - charLength(suffix)))}${suffix}`;
}

function advisoryShort(title) {
  return title.replace(/\s*(제품\s*)?보안\s*업데이트\s*권고\s*$/, '').trim();
}

function newsDesc(n) {
  return truncate(n.summary_ko || `${n.source}${n.outlets.length > 1 ? ` 외 ${n.outlets.length - 1}곳 보도` : ''}`, KAKAO_DESC);
}

/**
 * 카드 순서: 경보 → 국내 1위 → 해외 1위 → 악용 취약점(없으면 고위험) → KISA 공지.
 * 리스트형은 카드가 최대 3장이라 앞에서부터 3장을 쓴다(경보가 있는 날은 취약점 카드가 빠진다).
 */
function kakaoItems(b, dayUrl) {
  const items = [];
  const anchor = (id) => (dayUrl ? `${dayUrl}#${encodeURIComponent(id)}` : '');
  const ex = b.exploited || [];
  const cr = b.critical || [];
  const alert = alertOf(b);
  if (alert) {
    items.push({ title: fit('[경보] ', alert.title), description: truncate(`${alert.source} · ${alert.date}`, KAKAO_DESC), url: anchor('kisa') });
  }
  const dn = b.news?.domestic?.[0];
  if (dn) items.push({ title: fit('[국내] ', dn.title_ko || dn.title), description: newsDesc(dn), url: anchor(dn.id) });
  const intl = b.news?.international?.[0];
  if (intl) items.push({ title: fit('[해외] ', intl.title_ko || intl.title), description: newsDesc(intl), url: anchor(intl.id) });
  if (ex.length) {
    const v = ex[0];
    const more = ex.length + (b.exploited_more?.length || 0) - 1;
    items.push({
      title: fit('[악용] ', v.ko.title, more > 0 ? ` 외 ${more}건` : ''),
      description: truncate(`${v.id} · CISA KEV${v.ransomware ? ' · 랜섬웨어' : ''}${v.cvss ? ` · CVSS ${v.cvss.score.toFixed(1)}` : ''}`, KAKAO_DESC),
      url: anchor(v.id),
    });
  } else if (cr.length) {
    const g = cr[0];
    items.push({
      title: fit('[고위험] ', g.ko.title, cr.length > 1 ? ` 외 ${cr.length - 1}묶음` : ''),
      description: truncate(`${g.id} · CVSS ${g.cvss.score.toFixed(1)}${g.flags?.kisa ? ' · KISA 권고' : ''}`, KAKAO_DESC),
      url: anchor(g.id),
    });
  }
  const adv = (b.advisories || []).filter((a) => !a.alert);
  if (items.length < 3 && adv.length) {
    items.push({
      title: fit('[KISA] ', advisoryShort(adv[0].title), adv.length > 1 ? ` 외 ${adv.length - 1}건` : ' 권고'),
      description: truncate(adv.slice(1, 5).map((a) => advisoryShort(a.title)).join('·') || adv[0].source, KAKAO_DESC),
      url: anchor('kisa'),
    });
  }
  if (items.length < 3 && ex.length && cr.length) {
    const g = cr[0];
    items.push({ title: fit('[고위험] ', g.ko.title), description: truncate(`${g.id} · CVSS ${g.cvss.score.toFixed(1)}`, KAKAO_DESC), url: anchor(g.id) });
  }
  return items.slice(0, 3);
}

export function kakaoHeader(b) {
  const n = (b.exploited?.length || 0) + (b.exploited_more?.length || 0);
  // 웹 페이지와 같은 순서: 뉴스 → KISA → 악용 → 고위험
  const kisa = (b.advisories || []).length;
  const counts = [`뉴스 ${allNews(b).length}`, kisa ? `KISA ${kisa}` : '', n ? `악용 ${n}` : '', b.critical?.length && b.critical_total ? `고위험 ${b.critical_total}` : ''].filter(Boolean).join('·');
  const lost = failedVulnSources(b);
  return `${shortDay(b.date)} 보안 브리핑 | ${counts}${lost ? ` (${lost} 수집 실패)` : ''}`;
}

/** 200자 안의 텍스트형 메시지 본문 */
export function kakaoText(b, limit = 200) {
  // 카드와 같은 순서: 경보 → 국내 → 해외 → 취약점 → KISA
  const lines = [`[${shortDay(b.date)} 보안 브리핑]`];
  const alert = alertOf(b);
  if (alert) lines.push(`■ 경보: ${truncate(alert.title, 30)}`);
  const dn = b.news?.domestic?.[0];
  if (dn) lines.push(`■ 국내: ${truncate(dn.title_ko || dn.title, 30)}`);
  const intl = b.news?.international?.[0];
  if (intl) lines.push(`■ 해외: ${truncate(intl.title_ko || intl.title, 30)}`);
  const ex = b.exploited || [];
  const total = ex.length + (b.exploited_more?.length || 0);
  if (total) lines.push(`■ 악용 ${total}: ${truncate([...new Set(ex.map((v) => v.product || v.id))].join(', '), 30)}`);
  if (b.critical?.length) lines.push(`■ 고위험 ${b.critical_total}: ${truncate(b.critical.map((g) => g.label).join(', '), 30)}`);
  const adv = (b.advisories || []).filter((a) => !a.alert);
  if (adv.length) lines.push(`■ KISA ${adv.length}: ${truncate(adv.map((a) => advisoryShort(a.title)).join('·'), 30)}`);
  let text = '';
  for (const line of lines) {
    const next = text ? `${text}\n${line}` : line;
    if (charLength(next) > limit) break;
    text = next;
  }
  return text;
}

/**
 * 카카오톡 기본 템플릿(template_object)
 * - list: 머리글 + 주요 2~3건 + 버튼 2개 (주요 건이 2건 미만이면 text 로 바꾼다)
 * - text: 200자 글 + 버튼
 */
export function buildKakaoTemplate(b, { siteUrl = '', template = 'list' } = {}) {
  const dayUrl = briefUrl(siteUrl, b.date);
  const homeUrl = siteUrl ? `${siteUrl}/archive.html` : '';
  const buttons = siteUrl
    ? [
        { title: '오늘 브리핑 전체', link: linkObj(dayUrl) },
        { title: '지난 브리핑', link: linkObj(homeUrl) },
      ]
    : undefined;
  const items = kakaoItems(b, dayUrl);
  // 리스트형은 항목마다 링크가 필요하다. 웹 이력 주소가 없으면(로컬 실행 등) 텍스트형으로 보낸다.
  if (template === 'list' && items.length >= 2 && siteUrl) {
    return {
      object_type: 'list',
      header_title: truncate(kakaoHeader(b), 200),
      header_link: linkObj(dayUrl),
      contents: items.map((it) => ({ title: it.title, description: it.description, link: linkObj(it.url || dayUrl) })),
      ...(buttons ? { buttons } : {}),
    };
  }
  return {
    object_type: 'text',
    text: kakaoText(b),
    link: linkObj(dayUrl),
    ...(siteUrl ? { button_title: '브리핑 전체 보기' } : {}),
  };
}
