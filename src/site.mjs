// data/briefs → _site/ 정적 웹 이력 (GitHub Pages 에 그대로 올린다)
//   index.html            최신 브리핑
//   b/YYYY-MM-DD.html     날짜별 고정 주소 (카카오톡 버튼이 여기로 연결)
//   b/YYYY-MM-DD.json     원본 데이터
//   archive.html          지난 브리핑 목록
//   cves.html             지금까지 실린 취약점 색인 (cves.json 을 읽어 그림)
//   search.html           전체 검색 (search.json)
//   feed.xml              RSS
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { alertOf, allNews, emptyNote, vulnBadges } from './brief.mjs';
import { SITE_CSS, SITE_JS } from './site-assets.mjs';
import { loadAllBriefs } from './store.mjs';
import { escapeHtml as h, fmtPercent, kstStamp, safeUrl, shortDay, truncate, weekdayKo } from './util.mjs';

function longDate(ymd) {
  return `${Number(ymd.slice(0, 4))}년 ${Number(ymd.slice(5, 7))}월 ${Number(ymd.slice(8, 10))}일 (${weekdayKo(ymd)})`;
}

function engineLabel(engine) {
  if (!engine || engine === 'rules') return '규칙 기반 요약';
  return `Claude 요약 (${engine})`;
}

function a(url, text, cls = '') {
  const href = safeUrl(url);
  const c = cls ? ` class="${cls}"` : '';
  return href ? `<a${c} href="${h(href)}" rel="noopener noreferrer">${text}</a>` : `<span${c}>${text}</span>`;
}

function newsTime(iso) {
  if (!iso) return '';
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? '' : kstStamp(t).slice(5).replace('-', '.');
}

function counts(b) {
  if (b.legacy) return `CVE ${b.cves?.length || 0}건${b.links?.length ? ` · 링크 ${b.links.length}개` : ''}`;
  const ex = (b.exploited?.length || 0) + (b.exploited_more?.length || 0);
  return [ex ? `악용 ${ex}` : '', `고위험 ${b.critical_total ?? '–'}`, `KISA ${b.advisories?.length || 0}`, `뉴스 ${allNews(b).length}`]
    .filter(Boolean)
    .join(' · ');
}

function page({ base, title, desc = '', body, current = '', site }) {
  const nav = [
    ['index', 'index.html', '최신'],
    ['archive', 'archive.html', '지난 브리핑'],
    ['cves', 'cves.html', '취약점 색인'],
    ['search', 'search.html', '검색'],
  ]
    .map(([key, href, label]) => `<a href="${base}${href}"${current === key ? ' aria-current="page"' : ''}>${label}</a>`)
    .join('');
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${h(title)}</title>
<meta name="description" content="${h(desc)}">
<meta property="og:title" content="${h(title)}">
<meta property="og:description" content="${h(desc)}">
<meta name="robots" content="noindex">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect x='3' y='3' width='11' height='11' rx='2' fill='%23fdecea'/%3E%3Crect x='1' y='1' width='11' height='11' rx='2' fill='%230b6b88'/%3E%3C/svg%3E">
<link rel="stylesheet" href="${base}assets/site.css">
<link rel="alternate" type="application/rss+xml" title="${h(site.title)}" href="${base}feed.xml">
<script>try{var t=localStorage.getItem('sb-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;}catch(e){}</script>
</head>
<body>
<a class="skip" href="#main">본문으로 건너뛰기</a>
<header class="top">
  <a class="brand" href="${base}index.html"><span class="mark" aria-hidden="true"></span>${h(site.title)}</a>
  <nav class="nav" aria-label="사이트">${nav}</nav>
  <button class="theme" type="button" data-theme-toggle aria-label="밝게·어둡게 전환" title="밝게·어둡게 전환"><span aria-hidden="true">◐</span></button>
</header>
${body}
<footer class="site-foot">
  <p>${h(site.title)} · 매일 아침 자동 생성 · 출처: CISA KEV, NVD, FIRST EPSS, KISA 보호나라, 국내외 보안 언론 RSS</p>
</footer>
<script src="${base}assets/site.js" defer></script>
</body>
</html>
`;
}

// ------------------------------------------------------------------ 브리핑 본문

function vulnCard(v, { cls }) {
  const badges = vulnBadges(v)
    .map((t) => `<span class="badge${/KEV|악용|랜섬/.test(t) ? ' hot' : /KISA|뉴스|관심/.test(t) ? ' note' : ''}">${h(t)}</span>`)
    .join('');
  const ids = v.ids && v.ids.length > 1 ? v.ids : null;
  const links = [...(v.links || []).map((u, i) => a(u, i === 0 ? '벤더 공지' : `참고 ${i}`)), a(v.nvd, 'NVD')].join('<span class="sep">·</span>');
  const extra = ids
    ? `<details class="ids"><summary>같은 공지의 CVE ${ids.length}건</summary><ul>${ids
        .map((id) => `<li>${a(`https://nvd.nist.gov/vuln/detail/${id}`, h(id))}</li>`)
        .join('')}</ul></details>`
    : '';
  const desc = v.description ? `<details class="orig"><summary>원문 설명</summary><p lang="en">${h(truncate(v.description, 900))}</p></details>` : '';
  return `<article class="vuln ${cls}" id="${h(v.id)}">
  <div class="vuln-top"><span class="cve">${h(v.id)}${ids ? ` <small>외 ${ids.length - 1}건</small>` : ''}</span><span class="badges">${badges}</span></div>
  <h3>${h(v.ko?.title || v.id)}</h3>
  <dl class="facts">
    <div><dt>대상</dt><dd>${h(v.ko?.target || '-')}</dd></div>
    <div><dt>영향</dt><dd>${h(v.ko?.impact || '-')}</dd></div>
    <div><dt>조치</dt><dd>${h(v.ko?.action || '-')}</dd></div>
  </dl>
  <p class="links">${links}</p>
  ${extra}${desc}
</article>`;
}

function newsItem(n) {
  const others = n.outlets.length > 1 ? ` 외 ${n.outlets.length - 1}곳` : '';
  const title = n.title_ko || n.title;
  const orig = n.title_ko && n.title_ko !== n.title ? `<p class="orig-title" lang="${n.lang === 'en' ? 'en' : 'ko'}">${h(n.title)}</p>` : '';
  const summary = n.summary_ko ? `<p class="sum">${h(n.summary_ko)}</p>` : n.snippet ? `<p class="sum snip">${h(truncate(n.snippet, 120))}</p>` : '';
  const related = (n.related || []).length
    ? `<details class="rel"><summary>함께 보도 ${n.related.length}건${n.outlets.length - 1 > n.related.length ? ` (전체 ${n.outlets.length}개 매체)` : ''}</summary><ul>${n.related
        .map((r) => `<li>${a(r.url, h(r.title))} <span class="by">${h(r.source)}</span></li>`)
        .join('')}</ul></details>`
    : '';
  return `<li class="news-item" id="${h(n.id)}">
  ${a(n.url, h(title), 'news-title')}
  ${orig}
  <p class="by">${h(n.source)}${h(others)}${n.published ? ` · ${h(newsTime(n.published))}` : ''}${n.outlets.length >= 3 ? ' <span class="badge note">여러 매체 보도</span>' : ''}</p>
  ${summary}${related}
</li>`;
}

function sourcesBlock(b) {
  const list = b.sources || [];
  const ok = list.filter((s) => s.ok).length;
  const rows = list
    .map((s) => `<tr class="${s.ok ? 'ok' : 'bad'}"><td>${h(s.name)}</td><td>${s.ok ? '정상' : '실패'}</td><td class="num">${s.count ?? ''}</td><td>${h(s.error || '')}</td></tr>`)
    .join('');
  const sum = b.summarizer || {};
  const sumLine = sum.ok
    ? `요약: ${h(sum.engine)} (입력 ${sum.input_tokens ?? '?'} · 출력 ${sum.output_tokens ?? '?'} 토큰)`
    : sum.error
      ? `요약: 규칙 기반 (Claude 실패 — ${h(sum.error)})`
      : '요약: 규칙 기반';
  return `<details class="sources"><summary>수집 상태 ${ok}/${list.length} 정상${ok < list.length ? ' — 일부 실패' : ''}</summary>
  <table><thead><tr><th>출처</th><th>상태</th><th class="num">건수</th><th>비고</th></tr></thead><tbody>${rows}</tbody></table>
  <p>${sumLine}</p></details>`;
}

function briefBody(b) {
  const ex = b.exploited || [];
  const cr = b.critical || [];
  const adv = b.advisories || [];
  const alert = alertOf(b);
  const exTotal = ex.length + (b.exploited_more?.length || 0);
  const parts = [];
  parts.push(`<header class="brief-head">
  <p class="kicker">일일 보안 브리핑</p>
  <h1>${longDate(b.date)}</h1>
  <p class="meta">${h(b.generated_at?.slice(11, 16) || '')} KST 생성 · ${h(engineLabel(b.engine))}</p>
  <ul class="counts">
    <li class="${exTotal ? 'hot' : ''}"><b>${b.failed?.kev ? '–' : exTotal}</b><span>악용 확인</span></li>
    <li><b>${b.critical_total ?? '–'}</b><span>고위험 CVSS ${Number(b.cvss_min ?? 9).toFixed(1)}+</span></li>
    <li><b>${adv.length}</b><span>KISA 공지</span></li>
    <li><b>${allNews(b).length}</b><span>주요 뉴스</span></li>
  </ul>
</header>`);
  if (alert) parts.push(`<p class="alert" role="note"><b>경보</b> ${a(alert.url, h(alert.title))} <span class="by">${h(alert.source)} · ${h(alert.date)}</span></p>`);
  parts.push(`<section class="overview" aria-label="오늘의 요약"><p>${h(b.overview || '')}</p></section>`);

  parts.push(`<section id="exploited" class="sec"><h2>악용 확인 취약점 <small>CISA KEV 신규 ${b.failed?.kev ? '— 수집 실패' : `${exTotal}건`}</small></h2>`);
  parts.push(ex.length ? ex.map((v) => vulnCard(v, { cls: 'exploited' })).join('\n') : `<p class="empty">${h(emptyNote(b, 'exploited'))}</p>`);
  if (b.exploited_more?.length) {
    parts.push(`<details class="more"><summary>그 밖의 신규 등재 ${b.exploited_more.length}건</summary><ul>${b.exploited_more
      .map((v) => `<li>${a(`https://nvd.nist.gov/vuln/detail/${v.id}`, h(v.id))} ${h(v.title)}</li>`)
      .join('')}</ul></details>`);
  }
  parts.push('</section>');

  const crNote = b.critical_total === null || b.critical_total === undefined
    ? '— 수집 실패'
    : `${b.critical_total}건 중 주요 ${cr.length}묶음`;
  parts.push(`<section id="critical" class="sec"><h2>신규 고위험 취약점 <small>CVSS ${Number(b.cvss_min ?? 9).toFixed(1)} 이상 ${crNote}</small></h2>`);
  parts.push(cr.length ? cr.map((g) => vulnCard(g, { cls: 'critical' })).join('\n') : `<p class="empty">${h(emptyNote(b, 'critical'))}</p>`);
  if (b.critical_more?.length) {
    parts.push(`<details class="more"><summary>그 밖의 고위험 ${b.critical_more.length}묶음 (${b.critical_more.reduce((s, g) => s + (g.ids?.length || 1), 0)}건)</summary><ul>${b.critical_more
      .map((g) => `<li id="${h(g.id)}">${a(`https://nvd.nist.gov/vuln/detail/${g.id}`, h(g.id))}${g.ids?.length > 1 ? ` <small>외 ${g.ids.length - 1}건</small>` : ''} <span class="num">${Number(g.cvss).toFixed(1)}</span> ${h(g.title || g.label)}</li>`)
      .join('')}</ul></details>`);
  }
  parts.push('</section>');

  parts.push(`<section id="kisa" class="sec"><h2>KISA 공지 <small>보호나라·KrCERT</small></h2>`);
  parts.push(adv.length
    ? `<ul class="adv">${adv.map((x) => `<li class="${x.alert ? 'is-alert' : ''}">${a(x.url, h(x.title))} <span class="by">${h(x.source)} · ${h(x.date)}</span></li>`).join('')}</ul>`
    : `<p class="empty">${h(emptyNote(b, 'kisa'))}</p>`);
  parts.push('</section>');

  for (const [key, title, id] of [['domestic', '국내 보안 뉴스', 'news-domestic'], ['international', '해외 보안 뉴스', 'news-international']]) {
    const list = b.news?.[key] || [];
    parts.push(`<section id="${id}" class="sec"><h2>${title}</h2>`);
    parts.push(list.length ? `<ol class="news">${list.map(newsItem).join('\n')}</ol>` : `<p class="empty">${h(emptyNote(b, 'news'))}</p>`);
    parts.push('</section>');
  }
  parts.push(`<footer class="brief-foot">${sourcesBlock(b)}<p class="raw"><a href="${h(b.date)}.json">원본 데이터(JSON)</a></p></footer>`);
  return parts.join('\n');
}

// 옛 형식(sec-brief-local 의 out/daily-brief-*.md) 브리핑: 줄 구조만 살려 그대로 보여 준다.
function legacyBody(b) {
  const lines = String(b.text || '').replace(/\r\n/g, '\n').split('\n');
  let first = true;
  const out = lines.map((raw) => {
    const s = raw.trim();
    if (!s) return '<div class="blank"></div>';
    let cls = 'line';
    let shown = raw;
    if (first) {
      cls = 'doc-title';
      shown = raw.replace(/^#+\s*/, '');
      first = false;
    } else if (/^#{1,3}\s/.test(raw)) {
      cls = 'h';
      shown = raw.replace(/^#+\s*/, '');
    } else if (/^\[.+\]$/.test(s)) cls = 'section';
    else if (/^\d+\.\s/.test(s)) cls = 'item';
    else if (/^https?:\/\//.test(s)) cls = 'url';
    else if (/^[-*]\s/.test(s) || /^\s/.test(raw)) {
      cls = 'detail';
      shown = s;
    }
    // 이스케이프한 글에서 주소를 찾으므로 &quot; &#39; &lt; &gt; 앞에서 끊는다
    const linked = h(shown).replace(/https?:\/\/(?:(?!&(?:quot|#39|lt|gt);)[^\s<>()"'])+/g, (u) => {
      const href = safeUrl(u.replace(/&amp;/g, '&'));
      return href ? `<a href="${h(href)}" rel="noopener noreferrer">${u}</a>` : u;
    });
    return `<div class="${cls}">${linked}</div>`;
  });
  return `<header class="brief-head"><p class="kicker">지난 형식 브리핑</p><h1>${longDate(b.date)}</h1><p class="meta">이전 도구에서 옮겨 온 기록입니다.</p></header>
<div class="legacy">${out.join('')}</div>`;
}

function dayNav(b, prev, next) {
  return `<nav class="daynav" aria-label="날짜 이동">
  ${prev ? `<a class="prev" href="${prev.date}.html" rel="prev">← ${shortDay(prev.date)}</a>` : '<span class="prev"></span>'}
  <a class="all" href="../archive.html">전체 목록</a>
  ${next ? `<a class="next" href="${next.date}.html" rel="next">${shortDay(next.date)} →</a>` : '<span class="next"></span>'}
</nav>`;
}

function recentAside(briefs, base, currentDate, days) {
  const items = briefs.slice(0, days).map((b) => {
    const cur = b.date === currentDate ? ' aria-current="page"' : '';
    return `<li><a href="${base}b/${b.date}.html"${cur}><span class="d">${shortDay(b.date)}</span><span class="s">${h(counts(b))}</span></a></li>`;
  });
  return `<aside class="recent" aria-label="최근 브리핑"><h2>최근 브리핑</h2><ul>${items.join('')}</ul><a class="all" href="${base}archive.html">전체 목록 →</a></aside>`;
}

function briefPage(b, { prev, next, briefs, site, base, current }) {
  const inner = b.legacy ? legacyBody(b) : briefBody(b);
  const nav = base === '../' ? dayNav(b, prev, next) : '';
  const body = `<div class="layout">
<main id="main" class="brief-main">${nav}<article class="brief">${inner}</article>${nav}</main>
${recentAside(briefs, base, b.date, site.recent_days)}
</div>`;
  const desc = b.legacy ? `${b.date} 보안 브리핑 (지난 형식)` : truncate(b.overview || '', 150);
  return page({ base, title: `${b.date} (${weekdayKo(b.date)}) ${site.title}`, desc, body, current, site });
}

// ------------------------------------------------------------------ 목록·색인·검색

function archivePage(briefs, site) {
  const byMonth = new Map();
  for (const b of briefs) {
    const key = b.date.slice(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(b);
  }
  const sections = [...byMonth.entries()].map(([month, list]) => {
    const items = list.map(
      (b) => `<li><a href="b/${b.date}.html"><span class="d">${shortDay(b.date)}</span><span class="s">${h(counts(b))}</span><span class="o">${h(truncate(b.legacy ? (b.title || '') : b.overview || '', 110))}</span></a></li>`,
    );
    return `<section><h2>${Number(month.slice(0, 4))}년 ${Number(month.slice(5, 7))}월 <small>${list.length}회</small></h2><ul class="archive">${items.join('')}</ul></section>`;
  });
  const body = `<main id="main" class="wide"><h1 class="page-title">지난 브리핑 <small>총 ${briefs.length}회</small></h1>${sections.join('\n') || '<p class="empty">아직 브리핑이 없습니다.</p>'}</main>`;
  return page({ base: '', title: `지난 브리핑 · ${site.title}`, desc: '날짜별 보안 브리핑 목록', body, current: 'archive', site });
}

function cveIndex(briefs) {
  const rows = [];
  const seen = new Set();
  // 오래된 것부터 훑어 '처음 실린 날'을 남긴다
  for (const b of [...briefs].reverse()) {
    if (b.legacy) {
      for (const id of b.cves || []) {
        if (seen.has(id)) continue;
        seen.add(id);
        rows.push({ id, d: b.date, k: 'legacy', t: '', s: null, a: id });
      }
      continue;
    }
    const push = (id, k, t, s, anchor) => {
      if (seen.has(id)) return;
      seen.add(id);
      rows.push({ id, d: b.date, k, t, s, a: anchor });
    };
    for (const v of b.exploited || []) push(v.id, 'kev', v.ko?.title || '', v.cvss?.score ?? null, v.id);
    for (const v of b.exploited_more || []) push(v.id, 'kev', v.title || '', null, 'exploited');
    for (const g of b.critical || []) for (const id of g.ids || [g.id]) push(id, 'crit', g.ko?.title || g.label || '', g.cvss?.score ?? null, g.id);
    for (const g of b.critical_more || []) for (const id of g.ids || [g.id]) push(id, 'more', g.title || g.label || '', g.cvss ?? null, g.id);
  }
  // 최신 날짜가 위로. 같은 날 안에서는 악용 → 고위험 → 목록 순서를 유지한다(정렬은 안정적).
  return rows.sort((x, y) => y.d.localeCompare(x.d));
}

function cvesPage(total, site) {
  const body = `<main id="main" class="wide">
<h1 class="page-title">취약점 색인 <small>지금까지 브리핑에 실린 CVE ${total}건</small></h1>
<p class="lead">CVE 번호·제품·유형으로 찾을 수 있습니다. ‘악용’은 CISA KEV 신규 등재, ‘고위험’은 본문에 실린 묶음, ‘목록’은 그 밖의 고위험 목록입니다.</p>
<div class="filter"><label for="q">찾기</label><input id="q" type="search" placeholder="예: CVE-2026-1234, Fortinet, 원격 코드" autocomplete="off"><select id="kind" aria-label="구분"><option value="">전체</option><option value="kev">악용(KEV)</option><option value="crit">고위험</option><option value="more">목록</option><option value="legacy">지난 형식</option></select></div>
<p class="result-count" id="count" aria-live="polite"></p>
<div class="table-wrap"><table class="cves"><thead><tr><th>처음 실린 날</th><th>CVE</th><th>내용</th><th class="num">CVSS</th></tr></thead><tbody id="rows"></tbody></table></div>
<p><button type="button" id="more" class="btn" hidden>더 보기</button></p>
<noscript><p>이 표는 자바스크립트로 그립니다. 원본은 <a href="cves.json">cves.json</a> 입니다.</p></noscript>
</main>`;
  return page({ base: '', title: `취약점 색인 · ${site.title}`, desc: '브리핑에 실린 CVE 전체 목록', body, current: 'cves', site });
}

function searchIndex(briefs) {
  const out = [];
  for (const b of briefs) {
    if (b.legacy) {
      out.push({ d: b.date, k: '지난 형식', t: b.title || `${b.date} 브리핑`, u: `b/${b.date}.html`, x: `${(b.cves || []).join(' ')} ${truncate(b.text || '', 2000)}` });
      continue;
    }
    out.push({ d: b.date, k: '요약', t: truncate(b.overview || '', 160), u: `b/${b.date}.html`, x: '' });
    for (const v of b.exploited || []) out.push({ d: b.date, k: '악용', t: `${v.id} ${v.ko?.title || ''}`, u: `b/${b.date}.html#${v.id}`, x: `${v.vendor} ${v.product} ${v.name}` });
    for (const g of b.critical || []) out.push({ d: b.date, k: '고위험', t: `${g.id} ${g.ko?.title || ''}`, u: `b/${b.date}.html#${g.id}`, x: `${(g.ids || []).join(' ')} ${g.label}` });
    for (const g of b.critical_more || []) out.push({ d: b.date, k: '고위험 목록', t: `${g.id} ${g.title || g.label}`, u: `b/${b.date}.html#${g.id}`, x: (g.ids || []).join(' ') });
    for (const x of b.advisories || []) out.push({ d: b.date, k: 'KISA', t: x.title, u: x.url, x: x.source });
    for (const n of allNews(b)) out.push({ d: b.date, k: n.region === 'domestic' ? '국내 뉴스' : '해외 뉴스', t: n.title_ko || n.title, u: `b/${b.date}.html#${n.id}`, x: `${n.title} ${n.summary_ko || ''} ${n.outlets.join(' ')}` });
  }
  return out;
}

function searchPage(site) {
  const body = `<main id="main" class="wide">
<h1 class="page-title">검색</h1>
<div class="filter"><label for="sq">찾기</label><input id="sq" type="search" placeholder="낱말 여러 개는 띄어 쓰면 모두 포함된 것만" autocomplete="off" autofocus></div>
<p class="result-count" id="scount" aria-live="polite"></p>
<ol class="results" id="sresults"></ol>
<noscript><p>검색은 자바스크립트가 필요합니다. <a href="archive.html">지난 브리핑 목록</a>을 이용하세요.</p></noscript>
</main>`;
  return page({ base: '', title: `검색 · ${site.title}`, desc: '지난 브리핑 전체 검색', body, current: 'search', site });
}

function rss(briefs, site) {
  const base = site.url || '';
  const items = briefs.slice(0, 30).map((b) => {
    const link = base ? `${base}/b/${b.date}.html` : `b/${b.date}.html`;
    const when = new Date(b.generated_at || `${b.date}T07:00:00+09:00`);
    const alert = b.legacy ? null : alertOf(b);
    const desc = b.legacy ? counts(b) : `${alert ? `[경보] ${alert.title} — ` : ''}${b.overview || ''}`;
    return `<item><title>${h(`${b.date} (${weekdayKo(b.date)}) 보안 브리핑`)}</title><link>${h(link)}</link><guid isPermaLink="${base ? 'true' : 'false'}">${h(link)}</guid><pubDate>${(Number.isNaN(when.getTime()) ? new Date() : when).toUTCString()}</pubDate><description>${h(desc)}</description></item>`;
  });
  return `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel><title>${h(site.title)}</title><link>${h(base ? `${base}/` : '')}</link><description>매일 아침 보안 뉴스·주요 취약점 브리핑</description><language>ko</language>
${items.join('\n')}
</channel></rss>
`;
}

function notFound(site) {
  const body = `<main id="main" class="wide"><h1 class="page-title">페이지를 찾지 못했습니다</h1><p><a href="index.html">최신 브리핑</a>이나 <a href="archive.html">지난 브리핑 목록</a>으로 가 보세요. 오늘 브리핑이 막 만들어졌다면 1~2분 뒤 다시 열어 보세요.</p></main>`;
  return page({ base: '', title: `찾을 수 없음 · ${site.title}`, body, site });
}

/** @returns {{pages:number, briefs:number, out:string}} */
export function buildSite(cfg, { log = console.log } = {}) {
  const out = cfg.siteDir;
  const site = { ...cfg.site };
  const briefs = loadAllBriefs(cfg.dataDir);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, 'b'), { recursive: true });
  mkdirSync(join(out, 'assets'), { recursive: true });
  writeFileSync(join(out, 'assets', 'site.css'), SITE_CSS);
  writeFileSync(join(out, 'assets', 'site.js'), SITE_JS);
  writeFileSync(join(out, '.nojekyll'), '');

  let pages = 0;
  briefs.forEach((b, i) => {
    const html = briefPage(b, { prev: briefs[i + 1], next: briefs[i - 1], briefs, site, base: '../', current: '' });
    writeFileSync(join(out, 'b', `${b.date}.html`), html);
    writeFileSync(join(out, 'b', `${b.date}.json`), `${JSON.stringify(b, null, 2)}\n`);
    pages++;
  });
  if (briefs.length) {
    writeFileSync(join(out, 'index.html'), briefPage(briefs[0], { prev: briefs[1], next: null, briefs, site, base: '', current: 'index' }));
  } else {
    const body = `<main id="main" class="wide"><h1 class="page-title">아직 브리핑이 없습니다</h1><p>첫 브리핑이 만들어지면 이곳에 나타납니다.</p></main>`;
    writeFileSync(join(out, 'index.html'), page({ base: '', title: site.title, body, current: 'index', site }));
  }
  const cves = cveIndex(briefs);
  writeFileSync(join(out, 'archive.html'), archivePage(briefs, site));
  writeFileSync(join(out, 'cves.html'), cvesPage(cves.length, site));
  writeFileSync(join(out, 'cves.json'), JSON.stringify(cves));
  writeFileSync(join(out, 'search.html'), searchPage(site));
  writeFileSync(join(out, 'search.json'), JSON.stringify(searchIndex(briefs)));
  writeFileSync(join(out, 'feed.xml'), rss(briefs, site));
  writeFileSync(join(out, '404.html'), notFound(site));
  pages += 6;
  log(`웹 페이지 생성: ${out} (브리핑 ${briefs.length}회, 페이지 ${pages}개)`);
  return { pages, briefs: briefs.length, out };
}
