// 웹 이력의 스타일·스크립트 (외부 글꼴·라이브러리 없이 한 파일씩)

export const SITE_CSS = `:root {
  color-scheme: light dark;
  --bg: #f3f4f6; --surface: #ffffff; --surface-2: #f6f7f9; --ink: #111827; --ink-2: #1f2937;
  --muted: #5b6573; --faint: #7b8593; --rule: #e1e5ea;
  --accent: #0b6b88; --accent-soft: #e2f0f4;
  --hot: #b42318; --hot-soft: #fdecea; --warn: #8f5400; --warn-soft: #fff3db; --note: #3a55ad; --note-soft: #e8edfb;
  --sans: "Pretendard Variable", Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", system-ui, -apple-system, sans-serif;
  --mono: ui-monospace, "SF Mono", Menlo, Consolas, "D2Coding", monospace;
  --radius: 10px;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0d1117; --surface: #151b23; --surface-2: #1b222c; --ink: #e6edf3; --ink-2: #d0d7de;
    --muted: #9aa5b1; --faint: #7d8896; --rule: #29313c;
    --accent: #56b8d6; --accent-soft: #12303a;
    --hot: #ff8a80; --hot-soft: #3b1d1b; --warn: #f0b75a; --warn-soft: #3a2c12; --note: #9db1ff; --note-soft: #1e2747;
  }
}
:root[data-theme="dark"] {
  --bg: #0d1117; --surface: #151b23; --surface-2: #1b222c; --ink: #e6edf3; --ink-2: #d0d7de;
  --muted: #9aa5b1; --faint: #7d8896; --rule: #29313c;
  --accent: #56b8d6; --accent-soft: #12303a;
  --hot: #ff8a80; --hot-soft: #3b1d1b; --warn: #f0b75a; --warn-soft: #3a2c12; --note: #9db1ff; --note-soft: #1e2747;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.65 var(--sans);
  word-break: keep-all; overflow-wrap: anywhere; -webkit-font-smoothing: antialiased;
}
a { color: var(--accent); text-underline-offset: 2px; }
a:focus-visible, button:focus-visible, summary:focus-visible, input:focus-visible, select:focus-visible {
  outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px;
}
.skip { position: absolute; left: -999px; }
.skip:focus { left: 8px; top: 8px; background: var(--surface); padding: 8px 12px; z-index: 100; }

.top {
  position: sticky; top: 0; z-index: 10; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px;
  padding: 10px 16px; background: var(--surface); border-bottom: 1px solid var(--rule);
}
.brand { display: inline-flex; align-items: center; gap: 8px; font-weight: 700; color: var(--ink); text-decoration: none; letter-spacing: -0.01em; }
.mark { width: 12px; height: 12px; border-radius: 3px; background: var(--accent); box-shadow: 4px 4px 0 var(--hot-soft); }
.nav { display: flex; gap: 2px; overflow-x: auto; order: 3; width: 100%; scrollbar-width: none; }
.nav a { flex: 0 0 auto; padding: 5px 11px; border-radius: 999px; color: var(--muted); text-decoration: none; font-size: 14.5px; }
.nav a:hover { color: var(--ink); background: var(--surface-2); }
.nav a[aria-current="page"] { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.theme { margin-left: auto; font: inherit; width: 34px; height: 34px; border-radius: 50%; border: 1px solid var(--rule); background: var(--surface); color: var(--muted); cursor: pointer; }
@media (min-width: 760px) {
  .nav { order: 0; width: auto; }
}

.layout { max-width: 1180px; margin: 0 auto; padding: 16px; display: grid; gap: 20px; grid-template-columns: minmax(0, 1fr); }
@media (min-width: 1080px) { .layout { grid-template-columns: minmax(0, 1fr) 260px; padding: 24px; } }
.brief-main { min-width: 0; }
.brief { background: var(--surface); border: 1px solid var(--rule); border-radius: var(--radius); padding: 20px 16px 24px; }
@media (min-width: 720px) { .brief { padding: 30px 36px 34px; } }

.daynav { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin: 0 0 12px; font-size: 14px; }
.brief + .daynav { margin: 12px 0 0; }
.daynav a { text-decoration: none; padding: 6px 12px; border-radius: 8px; background: var(--surface); border: 1px solid var(--rule); color: var(--ink); white-space: nowrap; }
.daynav .all { color: var(--muted); }
.daynav span { min-width: 1px; }

.kicker { margin: 0; font-size: 12px; letter-spacing: 0.14em; color: var(--accent); font-weight: 700; }
.brief-head h1 { font-size: 23px; line-height: 1.35; margin: 4px 0 2px; letter-spacing: -0.015em; }
.meta { margin: 0; color: var(--muted); font-size: 13.5px; }
.counts { list-style: none; padding: 0; margin: 16px 0 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
@media (min-width: 560px) { .counts { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
.counts li { display: flex; flex-direction: column; padding: 10px 12px; border-radius: 8px; background: var(--surface-2); border: 1px solid var(--rule); }
.counts b { font-size: 22px; line-height: 1.2; font-variant-numeric: tabular-nums; }
.counts span { font-size: 12.5px; color: var(--muted); }
.counts li.hot b { color: var(--hot); }

.alert { margin: 16px 0 0; padding: 12px 14px; border-radius: 8px; background: var(--warn-soft); border: 1px solid var(--warn); }
.alert b { color: var(--warn); margin-right: 6px; }
.alert a { color: var(--ink); font-weight: 600; }
.overview { margin: 16px 0 0; padding: 14px 16px; border-radius: 8px; background: var(--accent-soft); font-size: 15.5px; }
.overview p { margin: 0; }

.sec { margin-top: 26px; }
.sec h2 { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 10px; margin: 0 0 12px; padding-top: 18px; border-top: 1px solid var(--rule); font-size: 18px; letter-spacing: -0.01em; }
.sec h2 small { font-size: 13px; color: var(--muted); font-weight: 500; }
.empty { color: var(--muted); font-size: 14px; margin: 0; }

.vuln { margin: 0 0 12px; padding: 12px 14px; border: 1px solid var(--rule); border-left-width: 4px; border-radius: 8px; background: var(--surface); scroll-margin-top: 70px; }
.vuln.exploited { border-left-color: var(--hot); }
.vuln.critical { border-left-color: var(--warn); }
.vuln:target, .news-item:target { box-shadow: 0 0 0 3px var(--accent-soft); }
.vuln-top { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
.cve { font-family: var(--mono); font-size: 13px; font-weight: 600; color: var(--ink-2); }
.cve small { font-family: var(--sans); color: var(--muted); font-weight: 500; }
.badges { display: flex; flex-wrap: wrap; gap: 4px; }
.badge { font-size: 11.5px; line-height: 1.6; padding: 1px 8px; border-radius: 999px; background: var(--surface-2); color: var(--muted); border: 1px solid var(--rule); white-space: nowrap; }
.badge.hot { background: var(--hot-soft); color: var(--hot); border-color: transparent; }
.badge.note { background: var(--note-soft); color: var(--note); border-color: transparent; }
.vuln h3 { margin: 6px 0 8px; font-size: 16.5px; line-height: 1.45; }
.facts { margin: 0; display: grid; gap: 3px; }
.facts div { display: grid; grid-template-columns: 2.6em minmax(0, 1fr); gap: 8px; }
.facts dt { color: var(--muted); font-size: 13.5px; font-weight: 600; padding-top: 1px; }
.facts dd { margin: 0; font-size: 14.5px; }
.links { margin: 8px 0 0; font-size: 13.5px; }
.sep { color: var(--faint); margin: 0 6px; }
details { margin-top: 6px; }
details summary { cursor: pointer; color: var(--muted); font-size: 13.5px; }
details ul { margin: 6px 0 0; padding-left: 18px; font-size: 13.5px; }
.ids ul { columns: 2 200px; }
.orig p { margin: 4px 0 0; color: var(--muted); font-size: 13.5px; }
.more li { margin: 3px 0; }
.more .num { display: inline-block; min-width: 2.4em; font-weight: 600; color: var(--warn); }

.adv { list-style: none; margin: 0; padding: 0; }
.adv li { padding: 8px 0; border-bottom: 1px dashed var(--rule); }
.adv li:last-child { border-bottom: 0; }
.adv li.is-alert a { color: var(--warn); font-weight: 700; }
.by { color: var(--faint); font-size: 12.5px; }

.news { list-style: none; margin: 0; padding: 0; counter-reset: n; }
.news-item { position: relative; padding: 12px 0 12px 34px; border-bottom: 1px solid var(--rule); counter-increment: n; scroll-margin-top: 70px; }
.news-item:last-child { border-bottom: 0; }
.news-item::before { content: counter(n); position: absolute; left: 0; top: 14px; width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; background: var(--surface-2); border: 1px solid var(--rule); color: var(--muted); font-size: 12px; font-weight: 700; }
.news-title { font-size: 16px; font-weight: 650; color: var(--ink); text-decoration: none; line-height: 1.45; }
.news-title:hover { color: var(--accent); text-decoration: underline; }
.orig-title { margin: 2px 0 0; color: var(--faint); font-size: 13px; }
.news-item .by { margin: 4px 0 0; }
.sum { margin: 6px 0 0; font-size: 14.5px; color: var(--ink-2); }
.sum.snip { color: var(--muted); }

.brief-foot { margin-top: 26px; padding-top: 14px; border-top: 1px solid var(--rule); font-size: 13px; color: var(--muted); }
.sources table { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 12.5px; }
.sources th, .sources td { padding: 4px 6px; border-bottom: 1px solid var(--rule); text-align: left; }
.sources tr.bad td { color: var(--hot); }
.raw { margin: 10px 0 0; }
.num { text-align: right; font-variant-numeric: tabular-nums; }

.recent { align-self: start; background: var(--surface); border: 1px solid var(--rule); border-radius: var(--radius); padding: 14px; }
@media (min-width: 1080px) { .recent { position: sticky; top: 72px; max-height: calc(100vh - 90px); overflow: auto; } }
.recent h2 { margin: 0 0 8px; font-size: 13px; color: var(--muted); letter-spacing: 0.04em; }
.recent ul { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 2px; }
@media (min-width: 1080px) { .recent ul { grid-template-columns: 1fr; } }
.recent a { display: grid; padding: 6px 8px; border-radius: 6px; color: var(--ink); text-decoration: none; }
.recent a:hover { background: var(--surface-2); }
.recent a[aria-current="page"] { background: var(--accent-soft); }
.recent .d { font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; }
.recent .s { font-size: 12px; color: var(--muted); }
.recent .all { display: inline-block; margin-top: 8px; font-size: 13.5px; }

.wide { max-width: 1000px; margin: 0 auto; padding: 20px 16px 40px; }
.page-title { margin: 8px 0 16px; font-size: 24px; letter-spacing: -0.015em; }
.page-title small { font-size: 14px; color: var(--muted); font-weight: 500; }
.lead { margin: -6px 0 14px; color: var(--muted); font-size: 14.5px; }
.wide section h2 { font-size: 16px; margin: 22px 0 8px; }
.wide section h2 small { color: var(--muted); font-weight: 500; font-size: 13px; }
.archive { list-style: none; margin: 0; padding: 0; background: var(--surface); border: 1px solid var(--rule); border-radius: var(--radius); }
.archive a { display: grid; grid-template-columns: 6.6em minmax(0, 1fr); gap: 2px 12px; padding: 10px 14px; color: var(--ink); text-decoration: none; border-bottom: 1px solid var(--rule); }
.archive li:last-child a { border-bottom: 0; }
.archive a:hover { background: var(--surface-2); }
.archive .d { font-weight: 700; font-variant-numeric: tabular-nums; }
.archive .s { color: var(--muted); font-size: 13px; }
.archive .o { grid-column: 2; color: var(--ink-2); font-size: 13.5px; }
@media (max-width: 560px) { .archive a { grid-template-columns: 1fr; } .archive .o { grid-column: 1; } }

.filter { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0 0 8px; }
.filter label { font-weight: 600; font-size: 14px; }
.filter input, .filter select { font: inherit; padding: 9px 12px; border-radius: 8px; border: 1px solid var(--rule); background: var(--surface); color: var(--ink); }
.filter input { flex: 1 1 240px; min-width: 0; }
.result-count { margin: 4px 0 10px; color: var(--muted); font-size: 13px; }
.table-wrap { overflow-x: auto; background: var(--surface); border: 1px solid var(--rule); border-radius: var(--radius); }
table.cves { width: 100%; border-collapse: collapse; font-size: 14px; }
table.cves th, table.cves td { padding: 8px 10px; border-bottom: 1px solid var(--rule); text-align: left; vertical-align: top; }
table.cves th { background: var(--surface-2); color: var(--muted); font-size: 12.5px; font-weight: 600; }
td.cvecell { font-family: var(--mono); font-size: 13px; white-space: nowrap; }
td.date { white-space: nowrap; font-variant-numeric: tabular-nums; color: var(--muted); font-size: 13px; }
td.num { white-space: nowrap; }
@media (max-width: 640px) {
  table.cves thead { display: none; }
  table.cves, table.cves tbody { display: block; }
  table.cves tr { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 2px 10px; padding: 10px 12px; border-bottom: 1px solid var(--rule); }
  table.cves td { display: block; padding: 0; border: 0; }
  table.cves td.date { grid-column: 1; grid-row: 1; }
  table.cves td.cvecell { grid-column: 2; grid-row: 1; }
  table.cves td.num { grid-column: 3; grid-row: 1; font-weight: 600; }
  table.cves td.desc { grid-column: 1 / -1; grid-row: 2; }
}
.kind { display: inline-block; font-size: 11px; padding: 0 7px; border-radius: 999px; background: var(--surface-2); color: var(--muted); border: 1px solid var(--rule); margin-right: 4px; }
.kind.k-kev { background: var(--hot-soft); color: var(--hot); border-color: transparent; }
.kind.k-crit { background: var(--warn-soft); color: var(--warn); border-color: transparent; }
.results { list-style: none; margin: 0; padding: 0; }
.results li { margin: 0 0 8px; padding: 10px 12px; background: var(--surface); border: 1px solid var(--rule); border-radius: 8px; }
.results .meta-line { color: var(--muted); font-size: 12.5px; }
.results mark { background: var(--warn-soft); color: inherit; padding: 0 1px; }
.btn { font: inherit; padding: 8px 16px; border-radius: 8px; border: 1px solid var(--rule); background: var(--surface); color: var(--ink); cursor: pointer; }

.legacy { white-space: pre-wrap; word-break: break-word; margin-top: 18px; }
.legacy .blank { height: 0.8rem; }
.legacy .doc-title { font-size: 19px; font-weight: 700; }
.legacy .h { font-weight: 700; margin-top: 8px; }
.legacy .section { margin-top: 8px; padding-top: 12px; border-top: 1px solid var(--rule); color: var(--accent); font-weight: 700; }
.legacy .item { margin-top: 4px; font-weight: 600; }
.legacy .detail { color: var(--muted); padding-left: 1em; }
.legacy .url { font-family: var(--mono); font-size: 12.5px; word-break: break-all; }

.site-foot { max-width: 1180px; margin: 0 auto; padding: 8px 16px 32px; color: var(--faint); font-size: 12.5px; }
@media print {
  .top, .recent, .daynav, .site-foot, .theme { display: none !important; }
  .brief { border: 0; padding: 0; }
  details > *:not(summary) { display: block; }
}
`;

export const SITE_JS = `(function () {
  'use strict';
  var root = document.documentElement;
  var btn = document.querySelector('[data-theme-toggle]');
  if (btn) {
    btn.addEventListener('click', function () {
      var dark = root.dataset.theme ? root.dataset.theme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
      var next = dark ? 'light' : 'dark';
      root.dataset.theme = next;
      try { localStorage.setItem('sb-theme', next); } catch (e) {}
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function terms(v) { return String(v || '').toLowerCase().split(/\\s+/).filter(Boolean); }
  function hasAll(hay, ts) {
    hay = hay.toLowerCase();
    for (var i = 0; i < ts.length; i++) if (hay.indexOf(ts[i]) < 0) return false;
    return true;
  }
  function mark(text, ts) {
    var out = esc(text);
    ts.forEach(function (t) {
      if (t.length < 2) return;
      var re = new RegExp('(' + esc(t).replace(/[.*+?^$()|[\\]\\\\{}]/g, '\\\\$&') + ')', 'gi');
      out = out.replace(re, '<mark>$1</mark>');
    });
    return out;
  }
  function param(name) {
    var m = new RegExp('[?&]' + name + '=([^&]*)').exec(location.search);
    return m ? decodeURIComponent(m[1].replace(/\\+/g, ' ')) : '';
  }
  function getJson(url, ok, fail) {
    fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(ok).catch(function (e) { fail(String(e && e.message || e)); });
  }

  // 취약점 색인
  var rowsEl = document.getElementById('rows');
  if (rowsEl) {
    var q = document.getElementById('q');
    var kind = document.getElementById('kind');
    var count = document.getElementById('count');
    var more = document.getElementById('more');
    var KIND = { kev: '악용', crit: '고위험', more: '목록', legacy: '지난 형식' };
    var data = [];
    var limit = 200;
    var render = function () {
      var ts = terms(q.value);
      var k = kind.value;
      var list = data.filter(function (r) {
        return (!k || r.k === k) && hasAll(r.id + ' ' + r.t + ' ' + r.d, ts);
      });
      count.textContent = list.length + '건' + (list.length > limit ? ' 중 ' + limit + '건 표시' : '');
      rowsEl.innerHTML = list.slice(0, limit).map(function (r) {
        return '<tr><td class="date">' + esc(r.d) + '</td><td class="cvecell"><a href="b/' + esc(r.d) + '.html#' +
          encodeURIComponent(r.a || r.id) + '">' + esc(r.id) + '</a></td><td class="desc"><span class="kind k-' + esc(r.k) + '">' +
          esc(KIND[r.k] || r.k) + '</span>' + mark(r.t, ts) + '</td><td class="num">' +
          (r.s == null ? '' : Number(r.s).toFixed(1)) + '</td></tr>';
      }).join('');
      more.hidden = list.length <= limit;
    };
    q.value = param('q');
    q.addEventListener('input', function () { limit = 200; render(); });
    kind.addEventListener('change', function () { limit = 200; render(); });
    more.addEventListener('click', function () { limit += 200; render(); });
    count.textContent = '불러오는 중…';
    getJson('cves.json', function (d) { data = d; render(); }, function (e) { count.textContent = '목록을 불러오지 못했습니다: ' + e; });
  }

  // 검색
  var sres = document.getElementById('sresults');
  if (sres) {
    var sq = document.getElementById('sq');
    var scount = document.getElementById('scount');
    var sdata = null;
    var srender = function () {
      if (!sdata) return;
      var ts = terms(sq.value);
      if (!ts.length) { scount.textContent = '브리핑 ' + sdata.length + '개 항목에서 찾습니다.'; sres.innerHTML = ''; return; }
      var list = sdata.filter(function (r) { return hasAll(r.t + ' ' + r.x + ' ' + r.k + ' ' + r.d, ts); });
      scount.textContent = list.length + '건' + (list.length > 150 ? ' 중 150건 표시' : '');
      sres.innerHTML = list.slice(0, 150).map(function (r) {
        var href = /^(https?:\\/\\/|b\\/)/.test(r.u) ? r.u : '#';
        return '<li><div class="meta-line">' + esc(r.d) + ' · ' + esc(r.k) + '</div><a href="' + esc(href) + '">' + mark(r.t, ts) + '</a></li>';
      }).join('');
      try { history.replaceState(null, '', '?q=' + encodeURIComponent(sq.value)); } catch (e) {}
    };
    sq.value = param('q');
    sq.addEventListener('input', srender);
    scount.textContent = '불러오는 중…';
    getJson('search.json', function (d) { sdata = d; srender(); }, function (e) { scount.textContent = '검색 자료를 불러오지 못했습니다: ' + e; });
  }
})();
`;
