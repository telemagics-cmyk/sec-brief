// 메일 발송(선택): 브리핑을 HTML 메일로 보낸다. 보내는 길은 둘 중 하나.
// 둘 다 있으면 Outlook 으로 보내고, Outlook 이 실패한 날(무료 계정 정지 등)은 SMTP 로 보낸다.
//   Outlook.com(개인 Microsoft 계정): OUTLOOK_CLIENT_ID, OUTLOOK_REFRESH_TOKEN — Graph 메일 API (outlook.mjs)
//   SMTP(Gmail 앱 비밀번호 등)     : SMTP_HOST, SMTP_PORT(기본 465), SMTP_USER, SMTP_PASS, MAIL_FROM(선택)
//   받는 주소: MAIL_TO(쉼표로 여러 개). Outlook 은 비우면 보내는 계정 자신에게.
// 공개 저장소이므로 주소·계정·토큰은 저장소가 아니라 비밀값(환경 변수)으로만 받고, Actions 기록에서는 가린다.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { alertOf, badgeKind, briefUrl, emptyNote, origTitleOf, renderMarkdown, sinceNote, sortedBadges } from './brief.mjs';
import { secret } from './config.mjs';
import { getAccount, mask, obtainAccessToken, outlookConfigured, sendGraphMail } from './outlook.mjs';
import { writeAtomic } from './store.mjs';
import { fetchMailNews, mailNewsSearchUrl } from './mail-news.mjs';
import { escapeHtml as h, kstIso, kstStamp, publicError, safeUrl, shortDay, truncate, weekdayKo } from './util.mjs';

const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

/**
 * 비밀값에서 메일 설정을 읽는다. 보낼 길(Outlook, 또는 SMTP+받는 주소)이 없으면 null(메일 끔).
 * Outlook 과 SMTP 가 다 있으면 Outlook 으로 보내고 SMTP(smtp)는 예비로 둔다.
 */
export function mailSettings(env = process.env) {
  const to = secret('MAIL_TO', env).split(/[,;\s]+/).filter(Boolean);
  const bad = to.filter((a) => !EMAIL_RE.test(a));
  if (bad.length) throw new Error(`MAIL_TO 에 메일 주소가 아닌 값이 있습니다(${bad.length}개). 쉼표로 구분해 넣으세요.`);
  const smtp = smtpSettings(to, env);
  return outlookConfigured(env) ? { kind: 'outlook', to, smtp } : smtp;
}

function smtpSettings(to, env) {
  const host = secret('SMTP_HOST', env);
  if (!host || !to.length) return null;
  const port = Number(secret('SMTP_PORT', env) || 465);
  // 465 는 처음부터 TLS(SSL), 그 밖(587 등)은 STARTTLS 를 반드시 쓴다. none 은 시험용.
  const security = secret('SMTP_SECURITY', env) || (port === 465 ? 'ssl' : 'starttls');
  const user = secret('SMTP_USER', env);
  // Gmail 앱 비밀번호는 'abcd efgh ijkl mnop' 처럼 띄어 보여 준다 → 그대로 붙여 넣어도 되게 공백을 뺀다
  const raw = secret('SMTP_PASS', env);
  const pass = /^[a-z]{4}( [a-z]{4}){3}$/i.test(raw) ? raw.replace(/ /g, '') : raw;
  return { kind: 'smtp', host, port, security, user, pass, from: secret('MAIL_FROM', env) || user, to };
}

export function mailConfigured(env = process.env) {
  try {
    return Boolean(mailSettings(env));
  } catch {
    return true; // 설정은 있는데 값이 잘못됨 → 발송 단계에서 이유를 보여 준다
  }
}

/** 메일 제목은 날짜까지만(건수는 본문 위쪽 칸에). 경보 단계가 바뀐 날만 맨 앞에 [경보]. */
export function mailSubject(b, title = '일일 보안 브리핑') {
  return `${alertOf(b) ? '[경보] ' : ''}[${title}] ${shortDay(b.date)}`;
}

// ------------------------------------------------------------------ HTML 본문 (메일 프로그램용)
// Outlook(Windows) 은 Word 로 그려 div 의 폭·여백·둥근 모서리를 무시하므로 뼈대는 표로 짜고, 배경색은 bgcolor 로도 준다.
// 스타일은 인라인이 기본이고, <style> 에는 어두운 화면용 덮어쓰기와 Outlook 글꼴 지정만 둔다
// (지원하지 않는 메일 앱은 무시하고 인라인 색 그대로 보인다).

const FONT = "'Malgun Gothic','맑은 고딕','Apple SD Gothic Neo','Noto Sans KR',Arial,sans-serif";
const MONO = "Consolas,'Courier New',monospace";
const C = {
  page: '#eef1f5', card: '#ffffff', soft: '#f6f8fa', rule: '#e3e7ec',
  ink: '#111827', ink2: '#2b3442', muted: '#5b6573', faint: '#667085',
  band: '#0b3c4f', bandInk: '#ffffff', bandSub: '#b9d6e0',
  accent: '#0b6b88', accentSoft: '#e3f1f5',
  hot: '#b42318', hotSoft: '#fdecea', warn: '#9a5300', warnSoft: '#fff4e0', warnLine: '#f0c98a', note: '#3a55ad', noteSoft: '#e8edfb',
};
const TBL = 'role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"';

// 폭: 받는 사람 대부분이 1920×1080 화면의 웹메일로 읽는다(읽기 창 약 1,000~1,500px). 최대 MAIL_W 까지 넓히되
// 한 단 그대로 넓히면 한 줄이 약 62자로 길어져 읽기 힘들어서, 국내|해외 뉴스만 넓을 때 두 단(한 줄 약 29자)으로 놓는다.
// Outlook(Windows) 은 MSO_W 한 단 그대로: 그 Word 그리기 방식은 max-width 를 고정 폭처럼 써서(창이 좁아도 줄지 않음 — Word 로
// 그려 확인) 960 이면 좁은 읽기 창·125% 배율에서 가로로 밀린다 → MSO 표와 함께 MSO_CSS 의 .mailw 로 Outlook 에서만 MSO_W.
const MAIL_W = 960;
const MSO_W = 680;
// 두 단 전환은 화면이 아니라 '들어갈 칸의 폭' 기준: 웹메일의 @media 는 브라우저 창 폭으로 판정돼 좁은 읽기 창에서 깨진다.
// width = (COL_BREAK − 칸 폭) × 1000 이 칸이 넓으면 음수(→ min-width, 두 단), 좁으면 큰 값(→ max-width 100%, 한 단).
// calc 의 곱셈·괄호를 지우는 메일 앱이 있어 미리 풀어 쓰고, calc 를 모르는 곳(Outlook 웹 등)은 앞의 width:100% 로 한 단.
// 두 칸은 왼쪽·오른쪽 끝에 붙이고(float) 남는 폭(100 − 2×COL_PCT %)이 가운데 간격이 된다. 칸 안에 간격용 여백을 두지 않으므로
// 한 단으로 쌓였을 때 어느 칸도 좁아지지 않고, 두 단일 때 양 끝이 다른 구역과 맞는다. float 을 모르는 Outlook(Windows) 은
// div 를 그대로 쌓는다(한 단). float 만 지우는 곳이 있다면 inline-block 으로 나란히 붙는다(사이에 빈칸이 끼어도 합이 100% 를
// 넘지 않음 — 글자 크기 0 으로 빈칸을 지우는 방법은 숨김 글 신호라 쓰지 않음).
const COL_BREAK = 840; // 칸 폭(px)이 이보다 넓으면 두 단
const COL_PCT = 48.7; // 한 칸의 폭(%) → 가운데 간격 2.6%(약 22~24px)
const colStyle = (side) => `float:${side};display:inline-block;vertical-align:top;width:100%;min-width:${COL_PCT}%;max-width:100%;width:calc(${COL_BREAK * 1000}px - 100000%);`;

// 어두운 화면을 지원하는 메일 앱(Apple Mail·Outlook iOS/Mac 등)에서만 쓰이는 덮어쓰기
const DARK_CSS = `:root { color-scheme: light dark; supported-color-schemes: light dark; }
@media (prefers-color-scheme: dark) {
  .bg { background: #0d1117 !important; }
  .card { background: #151b23 !important; border-color: #29313c !important; }
  .vcard { background: #151b23 !important; border-top-color: #29313c !important; border-right-color: #29313c !important; border-bottom-color: #29313c !important; }
  .soft { background: #1b222c !important; border-color: #29313c !important; }
  .ov { background: #12303a !important; }
  .warnbox { background: #3a2c12 !important; border-color: #6b4a14 !important; }
  .line { border-color: #29313c !important; }
  .ink { color: #e6edf3 !important; }
  .ink2 { color: #d0d7de !important; }
  .muted, .faint { color: #9aa5b1 !important; }
  .acc { color: #56b8d6 !important; }
  .hot { color: #ff8a80 !important; }
  .warn { color: #f0b75a !important; }
  .p-hot { background: #3b1d1b !important; color: #ff8a80 !important; }
  .p-warn { background: #3a2c12 !important; color: #f0b75a !important; }
  .p-note { background: #1e2747 !important; color: #9db1ff !important; }
  .p-acc { background: #12303a !important; color: #56b8d6 !important; }
  .p-neu { background: #1b222c !important; color: #9aa5b1 !important; }
}`;
// Outlook(Windows) 은 표 안 글자에 글꼴을 물려주지 않아 따로 정한다
// 한글과 숫자·영문 사이에 Word 가 저절로 띄우는 간격('2026 년')도 끈다
const MSO_CSS = `<!--[if mso]><style>table,td,p,a,span,h1,h2,div{font-family:'Malgun Gothic',Arial,sans-serif !important;text-autospace:none;}.mailw{max-width:${MSO_W}px !important;}</style><![endif]-->`;
// Outlook(Windows) 은 글자 단위 요소의 안쪽 여백을 무시하므로, 표시·단추 안에 Outlook 에서만 보이는 빈칸을 둔다
const MSO_PAD = '<!--[if mso]>&nbsp;<![endif]-->';

function a(url, text, style = '', cls = 'acc') {
  const href = safeUrl(url);
  return href ? `<a href="${h(href)}" class="${cls}" style="color:${C.accent};${style}">${text}</a>` : text;
}

/** 'MM.DD HH:mm' (한국 시간) */
function when(iso) {
  const t = Date.parse(iso || '');
  return Number.isNaN(t) ? '' : kstStamp(new Date(t)).slice(5).replace('-', '.');
}

const PILL = { hot: [C.hot, C.hotSoft], warn: [C.warn, C.warnSoft], note: [C.note, C.noteSoft], acc: [C.accent, C.accentSoft], neu: [C.muted, C.soft] };

function pill(text, kind = 'neu') {
  const [fg, bg] = PILL[kind];
  return `<span class="p-${kind}" style="display:inline-block;margin:0 2px 4px 0;padding:0 8px;border-radius:10px;background:${bg};color:${fg};font-size:12px;line-height:20px;font-weight:bold;white-space:nowrap;">${MSO_PAD}${h(text)}${MSO_PAD}</span>`;
}

function button(url, text) {
  const href = safeUrl(url);
  return href
    ? `<a href="${h(href)}" class="acc" style="display:inline-block;margin:0 2px 0 0;padding:3px 10px;border:1px solid ${C.rule};border-radius:6px;color:${C.accent};font-size:12.5px;line-height:18px;font-weight:bold;text-decoration:none;">${MSO_PAD}${h(text)}${MSO_PAD}</a>`
    : '';
}

function sectionHead(title, { color = C.accent, count = null, sub = '' } = {}) {
  const n = count === null || count === undefined
    ? ''
    : ` <span class="p-neu" style="display:inline-block;margin-left:4px;padding:0 8px;border-radius:10px;background:${C.soft};color:${C.muted};font-size:12.5px;line-height:20px;font-weight:bold;vertical-align:2px;">${h(count)}</span>`;
  return `<tr><td style="padding:30px 0 10px;">
<table ${TBL}><tr><td style="border-left:4px solid ${color};padding:1px 0 1px 10px;">
<h2 class="ink" style="margin:0;font-size:18px;line-height:25px;color:${C.ink};">${h(title)}${n}</h2>
${sub ? `<p class="faint" style="margin:2px 0 0;font-size:12.5px;line-height:18px;color:${C.faint};">${h(sub)}</p>` : ''}
</td></tr></table></td></tr>`;
}

function noteRow(text) {
  return `<tr><td class="muted" style="padding:2px 0 4px;font-size:14px;line-height:21px;color:${C.muted};">${h(text)}</td></tr>`;
}

function moreRow(html) {
  return `<tr><td class="muted" style="padding:2px 0 4px;font-size:13px;line-height:20px;color:${C.muted};">${html}</td></tr>`;
}

/** 번호 붙은 기사 한 줄(브리핑 뉴스·관심 키워드 뉴스 공통) */
function newsItem(i, { url, title, orig = '', meta = '', summary = '' }) {
  return `<tr><td class="line" style="padding:${i ? 12 : 2}px 0 12px;${i ? `border-top:1px solid ${C.rule};` : ''}">
<table ${TBL}><tr>
<td class="acc" valign="top" width="26" style="width:26px;font-size:15px;line-height:24px;font-weight:bold;color:${C.accent};">${i + 1}</td>
<td valign="top">
<p style="margin:0;font-size:16px;line-height:24px;font-weight:bold;">${a(url, h(title), `color:${C.ink};text-decoration:none;`, 'ink')}</p>
${orig ? `<p class="faint" style="margin:2px 0 0;font-size:12.5px;line-height:18px;color:${C.faint};">${h(orig)}</p>` : ''}
${meta ? `<p class="faint" style="margin:3px 0 0;font-size:12.5px;line-height:18px;color:${C.faint};">${h(meta)}</p>` : ''}
${summary ? `<p class="ink2" style="margin:6px 0 0;font-size:14.5px;line-height:23px;color:${C.ink2};">${h(summary)}</p>` : ''}
</td></tr></table></td></tr>`;
}

function newsRows(list, b) {
  if (!list.length) return noteRow(emptyNote(b, 'news'));
  return list
    .map((n, i) => {
      const others = n.outlets?.length > 1 ? ` 외 ${n.outlets.length - 1}곳` : '';
      const at = when(n.published);
      return newsItem(i, {
        url: n.url,
        title: n.title_ko || n.title,
        orig: origTitleOf(n),
        meta: `${n.source || ''}${others}${at ? ` · ${at}` : ''}`,
        summary: n.summary_ko || truncate(n.snippet || '', 120),
      });
    })
    .join('');
}

/**
 * 두 단 묶음: 칸이 넓으면 나란히, 좁으면(좁은 읽기 창·휴대폰·calc 를 모르는 메일 앱) 위아래로 — 순서는 그대로.
 * Outlook(Windows) 은 div 를 블록으로 쌓아 한 단이 된다. 두 div 사이에 빈칸·줄바꿈을 두지 않는다.
 * @param {string} left  표 행(<tr>…)들
 * @param {string} right 표 행(<tr>…)들
 */
function twoColumns(left, right) {
  const col = (side, rows) => `<div class="col" style="${colStyle(side)}"><table ${TBL}>${rows}</table></div>`;
  return `<tr><td style="padding:0;">${col('left', left)}${col('right', right)}</td></tr>`;
}

/**
 * 취약점 카드 배치: 넓으면 두 장씩 나란히(길이가 절반 가까이 줄어 훑어보기 쉽다), 좁으면 한 줄에 한 장 — 순서는 그대로.
 * 홀수면 첫 장(가장 중요한 것)을 한 줄 전체에 놓고 나머지를 둘씩 묶는다.
 * @param {string[]} cards vulnCard 가 만든 표 행들
 */
function cardGrid(cards) {
  const out = [];
  let i = 0;
  if (cards.length % 2) out.push(cards[i++]);
  for (; i < cards.length; i += 2) out.push(twoColumns(cards[i], cards[i + 1]));
  return out.join('');
}

/** KISA 공지: 6건 이상이면 넓은 칸에서 두 단(반씩) — 쌓였을 때도 줄이 이어지게 그때는 첫 줄 위에도 선을 둔다 */
function kisaList(adv, b) {
  if (!adv.length) return noteRow(emptyNote(b, 'kisa'));
  if (adv.length < 6) return kisaRows(adv);
  const half = Math.ceil(adv.length / 2);
  return twoColumns(kisaRows(adv.slice(0, half), true), kisaRows(adv.slice(half), true));
}

function kisaRows(adv, topRule = false) {
  return adv
    .map((x, i) => {
      // 출처가 보안공지면 표시를 생략하고, 취약점 정보·경보단계만 작은 표시로
      const kind = String(x.source || '').replace(/^KISA\s*/, '');
      const tag = kind && kind !== '보안공지' ? ` ${pill(kind, 'note')}` : '';
      const style = x.alert ? `color:${C.warn};font-weight:bold;text-decoration:none;` : `color:${C.ink2};text-decoration:none;`;
      const day = /^\d{4}-\d{2}-\d{2}$/.test(x.date || '') ? `${x.date.slice(5, 7)}.${x.date.slice(8, 10)}` : x.date || '';
      return `<tr><td class="line" style="padding:8px 0;${i || topRule ? `border-top:1px solid ${C.rule};` : ''}">
<table ${TBL}><tr>
<td valign="top" style="font-size:14.5px;line-height:22px;">${a(x.url, h(x.title), style, x.alert ? 'warn' : 'ink2')}${tag}${day ? ` <span class="faint" style="font-size:12.5px;color:${C.faint};white-space:nowrap;">· ${h(day)}</span>` : ''}</td>
</tr></table></td></tr>`;
    })
    .join('');
}

/**
 * (선택) Secret ASSET_URL: 사내 정보자산 관리 프로그램의 주소(예: https://자산서버:4800). 있으면 취약점마다 '우리 자산 영향' 단추가
 * 그 프로그램의 취약점 영향 자산 화면(#/vuln?brief=날짜&cve=번호)을 연다. 자산 정보는 메일·저장소에 들어가지 않는다
 * (그 프로그램이 이 사이트의 feed 를 가져가 자기 자산과 비교한다). 주소가 아니면 무시한다.
 */
export function assetUrlOf(env = process.env) {
  const raw = secret('ASSET_URL', env);
  if (!raw) return '';
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return '';
  }
}
export function assetLink(base, date, id = '') {
  if (!base) return '';
  return `${base}/#/vuln?${new URLSearchParams({ brief: date, ...(id ? { cve: id } : {}) })}`;
}

function vulnCard(v, color, assetHref = '') {
  const ids = v.ids && v.ids.length > 1 ? ` 외 ${v.ids.length - 1}건` : '';
  const row = (k, val, strong = false) => `<tr>
<td class="faint" valign="top" width="38" style="width:38px;padding:3px 10px 3px 0;font-size:13px;line-height:21px;color:${C.faint};white-space:nowrap;">${k}</td>
<td class="${strong ? 'ink' : 'ink2'}" valign="top" style="padding:3px 0;font-size:14.5px;line-height:21px;color:${strong ? C.ink : C.ink2};${strong ? 'font-weight:bold;' : ''}">${h(val || '-')}</td></tr>`;
  // 표시·단추 사이의 빈칸은 Outlook 에서 서로 붙지 않게 하는 몫
  const links = [...(v.links || []).slice(0, 1).map((u) => button(u, '벤더 공지')), button(v.nvd, 'NVD'), button(assetHref, '우리 자산 영향')].filter(Boolean).join(' ');
  return `<tr><td style="padding:0 0 12px;">
<table ${TBL} class="vcard" style="border:1px solid ${C.rule};border-left:4px solid ${color};border-radius:8px;background:${C.card};"><tr><td style="padding:12px 14px;">
<div>${sortedBadges(v).map((t) => pill(t, badgeKind(t))).join(' ')}</div>
<p class="ink" style="margin:2px 0 0;font-size:16px;line-height:24px;font-weight:bold;color:${C.ink};">${h(v.ko?.title || v.id)}</p>
<p class="faint" style="margin:2px 0 0;font-family:${MONO};font-size:12.5px;line-height:18px;color:${C.faint};">${h(v.id)}${h(ids)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;">${row('대상', v.ko?.target)}${row('영향', v.ko?.impact)}${row('조치', v.ko?.action, true)}</table>
${links ? `<p style="margin:10px 0 0;">${links}</p>` : ''}
</td></tr></table></td></tr>`;
}

/** 글자 메일(SMTP 의 text 부분)에 붙는 같은 내용 */
function keywordNewsText(extra) {
  if (!extra) return '';
  const lines = extra.items.map((n) => `- ${n.title} (${n.outlet}${n.outlets > 1 ? ` 외 ${n.outlets - 1}곳` : ''}) ${n.url}`);
  return `\n\n## ${extra.keyword} 관련 뉴스\n\n${extra.error || (lines.length ? lines.join('\n') : '새 기사가 없습니다.')}\n`;
}

/** (선택) 메일에만 붙는 '○○ 관련 뉴스' (src/mail-news.mjs) */
function keywordNews(extra) {
  const rows = [sectionHead(`${extra.keyword} 관련 뉴스`, { sub: 'Google 뉴스 · 지난 브리핑 이후' })];
  if (extra.error) rows.push(noteRow(extra.error));
  else if (!extra.items.length) rows.push(noteRow('새 기사가 없습니다.'));
  else {
    rows.push(...extra.items.map((n, i) => newsItem(i, { url: n.url, title: n.title, meta: `${n.outlet}${n.outlets > 1 ? ` 외 ${n.outlets - 1}곳` : ''} · ${when(n.published)}` })));
    if (extra.total > extra.items.length) {
      rows.push(moreRow(`그 밖의 ${extra.total - extra.items.length}건은 ${a(mailNewsSearchUrl(extra.keyword), 'Google 뉴스')}에서 볼 수 있습니다.`));
    }
  }
  return rows.join('');
}

/**
 * 요약을 문장으로 나눈다(마침표·물음표·느낌표 뒤 빈칸). 영문 약어('U.S. ')·숫자('2026. 11.') 뒤는 나누지 않는다 —
 * 잘못 나누는 것보다 두 문장이 한 줄에 남는 편이 낫다.
 */
export function sentences(text) {
  return String(text || '').split(/(?<=[^A-Za-z0-9\s.][.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}

/**
 * '오늘의 요약' 상자: 바쁜 사람이 첫 화면에서 결론을 읽게 문장마다 한 줄, 첫 문장(요약 규칙상 가장 시급한 조치)은 굵게.
 * 문장이 하나면 그대로 한 문단.
 */
function overviewBox(text) {
  const lines = sentences(text);
  const size = 'font-size:15.5px;line-height:25px;';
  const body = lines.length > 1
    ? `<table ${TBL}>${lines
        .map((s, i) => `<tr>
<td class="acc" valign="top" width="16" style="width:16px;${size}color:${C.accent};">•</td>
<td class="${i ? 'ink2' : 'ink'}" valign="top" style="padding:0 0 ${i === lines.length - 1 ? 0 : 3}px;${size}color:${i ? C.ink2 : C.ink};${i ? '' : 'font-weight:bold;'}">${h(s)}</td></tr>`)
        .join('')}</table>`
    : `<p class="ink" style="margin:0;${size}color:${C.ink};">${h(text)}</p>`;
  return `<table ${TBL}><tr><td class="ov" bgcolor="${C.accentSoft}" style="background:${C.accentSoft};border-left:4px solid ${C.accent};border-radius:0 8px 8px 0;padding:13px 16px 14px;">
<p class="acc" style="margin:0 0 5px;font-size:12.5px;line-height:18px;font-weight:bold;color:${C.accent};">오늘의 요약</p>
${body}
</td></tr></table>`;
}

/** 웹 페이지와 같은 순서: 국내 뉴스 → 해외 뉴스 → KISA 공지 → 악용 확인 → 신규 고위험 (→ 메일에만 관심 키워드 뉴스) */
export function renderEmailHtml(b, { siteUrl = '', title = '일일 보안 브리핑', extraNews = null, assetUrl = '' } = {}) {
  const assetHref = (id) => assetLink(assetUrl, b.date, id);
  const dayUrl = briefUrl(siteUrl, b.date);
  const anchor = (id) => (dayUrl ? `${dayUrl}#${id}` : '');
  const ex = b.exploited || [];
  const cr = b.critical || [];
  const adv = b.advisories || [];
  const dom = b.news?.domestic || [];
  const intl = b.news?.international || [];
  const alert = alertOf(b);
  const exTotal = ex.length + (b.exploited_more?.length || 0);
  const since = sinceNote(b);
  const date = `${Number(b.date.slice(0, 4))}년 ${Number(b.date.slice(5, 7))}월 ${Number(b.date.slice(8, 10))}일 (${weekdayKo(b.date)})`;

  // 글자 사이를 벌리면(letter-spacing) 영문 약어가 'G OC' 처럼 떨어져 보여 간격은 두지 않는다
  const header = `<p style="margin:0;font-size:13px;line-height:18px;font-weight:bold;color:${C.bandSub};">${h(title)}</p>
<h1 style="margin:6px 0 4px;font-size:24px;line-height:32px;color:${C.bandInk};">${date}</h1>
<p style="margin:0;font-size:13px;line-height:20px;color:${C.bandSub};">${h(b.generated_at?.slice(11, 16) || '')} KST 생성${since ? ` · ${h(since)}` : ''}${dayUrl ? ` · <a href="${h(dayUrl)}" style="color:${C.bandInk};text-decoration:underline;">웹에서 보기</a>` : ''}</p>`;

  // 건수 띠: 머리 띠에 바로 붙는 한 줄(상자 다섯 개보다 가볍게 — 첫 화면은 요약에 내준다). 휴대폰에서도 한 줄에 들어가게
  // 이름은 짧게. 대부분의 날 같은 숫자인 칸은 차분하게 두고, 새로 악용이 확인된 날·경보가 바뀐 날만 그 칸에 색을 넣는다.
  const stats = [
    ['news-domestic', dom.length, '국내 뉴스', ''],
    ['news-international', intl.length, '해외 뉴스', ''],
    ['kisa', adv.length, 'KISA 공지', alert ? 'warn' : ''],
    ['exploited', b.failed?.kev ? '–' : exTotal, '악용 확인', exTotal ? 'hot' : ''],
    ['critical', b.critical_total ?? '–', '고위험', ''],
  ];
  const statCells = stats
    .map(([id, n, label, hi], i) => {
      const bg = hi ? PILL[hi][1] : '';
      return `<td class="line${hi ? ` p-${hi}` : ''}" width="20%" align="center" valign="top"${bg ? ` bgcolor="${bg}"` : ''} style="width:20%;padding:9px 2px 8px;text-align:center;${bg ? `background:${bg};` : ''}${i ? `border-left:1px solid ${C.rule};` : ''}">
${a(anchor(id), `<span class="${hi || 'ink'}" style="font-size:21px;line-height:25px;font-weight:bold;color:${hi ? PILL[hi][0] : C.ink};">${h(n)}</span><br><span class="tile-label muted" style="font-size:12px;line-height:17px;color:${C.muted};white-space:nowrap;">${h(label)}</span>`, 'text-decoration:none;', '')}
</td>`;
    })
    .join('');

  // 첫 화면: 경보(있는 날) → 오늘의 요약
  const rows = [];
  const lead = (html) => rows.push(`<tr><td style="padding:${rows.length ? 12 : 0}px 0 0;">${html}</td></tr>`);
  if (alert) {
    lead(`<table ${TBL}><tr><td class="warnbox" bgcolor="${C.warnSoft}" style="background:${C.warnSoft};border:1px solid ${C.warnLine};border-radius:8px;padding:10px 12px;font-size:14.5px;line-height:22px;">
${pill('사이버위기 경보', 'warn')} ${a(alert.url, h(alert.title), `color:${C.ink};font-weight:bold;text-decoration:none;`, 'ink')}<span class="faint" style="font-size:12.5px;color:${C.faint};"> · ${h(alert.source)} · ${h(alert.date)}</span>
</td></tr></table>`);
  }
  if (b.overview) lead(overviewBox(b.overview));

  // 넓은 읽기 창에서는 국내|해외를 나란히(첫 화면에 두 목록의 1위가 함께 보이게), 좁으면 국내 → 해외
  rows.push(twoColumns(sectionHead('국내 보안 뉴스', { count: dom.length }) + newsRows(dom, b), sectionHead('해외 보안 뉴스', { count: intl.length }) + newsRows(intl, b)));
  rows.push(sectionHead('KISA 공지', { color: C.note, count: adv.length, sub: '보호나라·KrCERT' }), kisaList(adv, b));

  rows.push(sectionHead('악용 확인 취약점', { color: C.hot, count: b.failed?.kev ? null : exTotal, sub: b.failed?.kev ? 'CISA KEV — 수집 실패' : 'CISA KEV 신규 등재' }));
  if (assetUrl && (ex.length || cr.length)) rows.push(moreRow(`${a(assetHref(), '우리 자산 영향 한눈에 보기')} — 오늘 브리핑의 취약점을 자산 대장과 비교합니다(사내망에서 열림)`));
  rows.push(ex.length ? cardGrid(ex.map((v) => vulnCard(v, C.hot, assetHref(v.id)))) : noteRow(emptyNote(b, 'exploited')));
  if (b.exploited_more?.length) rows.push(moreRow(`그 밖의 신규 등재 ${b.exploited_more.length}건: ${h(b.exploited_more.map((v) => v.id).join(', '))}`));

  const crSub = b.critical_total === null || b.critical_total === undefined ? '— 수집 실패' : `CVSS ${Number(b.cvss_min ?? 9).toFixed(1)} 이상 ${b.critical_total}건 중 주요 ${cr.length}묶음`;
  rows.push(sectionHead('신규 고위험 취약점', { color: C.warn, sub: crSub }));
  rows.push(cr.length ? cardGrid(cr.map((g) => vulnCard(g, C.warn, assetHref(g.id)))) : noteRow(emptyNote(b, 'critical')));
  if (b.critical_more?.length) rows.push(moreRow(`그 밖의 고위험 ${b.critical_more.length}묶음은 ${dayUrl ? a(anchor('critical'), '웹 페이지') : '웹 페이지'}에서 볼 수 있습니다.`));
  // 카드의 표시(KEV·CVSS·EPSS)를 처음 보는 사람을 위한 한 줄 풀이
  if (ex.length || cr.length) {
    rows.push(`<tr><td class="faint" style="padding:8px 0 0;font-size:12.5px;line-height:19px;color:${C.faint};">KEV: 미국 사이버보안청(CISA)이 실제 공격에 쓰인 것을 확인한 취약점 · CVSS: 심각도 점수(10점 만점) · EPSS: 30일 안에 공격에 쓰일 확률(추정)</td></tr>`);
  }
  if (extraNews) rows.push(keywordNews(extraNews));

  const ok = (b.sources || []).filter((s) => s.ok).length;
  const foot = `수집 ${ok}/${(b.sources || []).length}곳 정상${dayUrl ? ` · ${a(dayUrl, '웹에서 보기')}` : ''}${siteUrl ? ` · ${a(`${siteUrl}/archive.html`, '지난 브리핑')}` : ''} · 자동 발송`;

  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<meta name="x-apple-disable-message-reformatting">
<title>${h(mailSubject(b, title))}</title>
<style>${DARK_CSS}</style>
${MSO_CSS}
</head>
<body class="bg" bgcolor="${C.page}" style="margin:0;padding:0;background:${C.page};">
<table ${TBL} class="bg" bgcolor="${C.page}" style="background:${C.page};"><tr><td align="center" style="padding:16px 8px 20px;">
<!--[if mso]><table role="presentation" width="${MSO_W}" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="mailw" style="max-width:${MAIL_W}px;width:100%;font-family:${FONT};color:${C.ink};word-break:keep-all;overflow-wrap:anywhere;">
<tr><td bgcolor="${C.band}" style="background:${C.band};border-radius:12px 12px 0 0;padding:20px 22px 18px;">
${header}
</td></tr>
<tr><td class="soft" bgcolor="${C.soft}" style="background:${C.soft};border:1px solid ${C.rule};border-top:0;padding:0;">
<table ${TBL}><tr>${statCells}</tr></table>
</td></tr>
<tr><td class="card" bgcolor="${C.card}" style="background:${C.card};border:1px solid ${C.rule};border-top:0;border-radius:0 0 12px 12px;padding:18px 18px 24px;">
<table ${TBL}>
${rows.join('\n')}
</table>
</td></tr>
<tr><td class="faint" align="center" style="padding:14px 10px 4px;font-size:12.5px;line-height:19px;color:${C.faint};text-align:center;">${foot}</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body></html>
`;
}

/**
 * 메일 제목·본문에 쓰는 이름. Secret MAIL_TITLE 이 있으면 그것(공개 저장소·웹에 남기지 않을 이름), 없으면 site.title.
 * 웹 페이지와 카카오톡은 site.title 그대로.
 */
export function mailTitle(cfg, env = process.env) {
  return secret('MAIL_TITLE', env) || cfg.site.title;
}

export function testMail(cfg, env = process.env) {
  const title = mailTitle(cfg, env);
  const url = cfg.site.url ? `${cfg.site.url}/` : '';
  const text = `[${title}] 메일 연결 확인입니다. 이 메일이 보이면 메일 발송 설정이 끝났습니다.${url ? `\n웹 이력: ${url}` : ''}`;
  return {
    subject: `[${title}] 메일 연결 확인`,
    text,
    html: `<p style="font-family:'Malgun Gothic',sans-serif;font-size:15px;">${h(text).replace(/\n/g, '<br>')}</p>`,
  };
}

// ------------------------------------------------------------------ 발송

export function mailStatePath(cfg) {
  return join(cfg.dataDir, 'mail-state.json');
}

function loadMailState(path) {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

/** 메일 오류를 할 일이 보이는 문장으로 */
export function explainMailError(err, s) {
  const server = err?.response ? ` — 서버 응답: ${String(err.response).slice(0, 160)}` : '';
  switch (err?.code) {
    case 'EAUTH':
      return `SMTP 로그인 실패${server}. Gmail 은 계정 비밀번호가 아니라 2단계 인증 후 만든 '앱 비밀번호'를 SMTP_PASS 에 넣어야 합니다(Outlook.com 은 비밀번호 방식 SMTP 를 막았습니다).`;
    case 'ENOAUTH':
      return 'SMTP_USER·SMTP_PASS 가 비어 있습니다.';
    case 'ECONNECTION':
    case 'ETIMEDOUT':
    case 'ESOCKET':
    case 'EDNS':
      return `SMTP 서버(${s.host}:${s.port})에 연결하지 못했습니다(${err.code}${err.message ? `: ${String(err.message).slice(0, 120)}` : ''}). 주소·포트를 확인하세요. 네이버 메일은 해외(GitHub 서버) 접속을 기본으로 막습니다.`;
    case 'ETLS':
      return `TLS 연결 실패${server}. 465 는 SSL, 587 은 STARTTLS 입니다(SMTP_PORT 확인).`;
    case 'EENVELOPE':
      return `보내는·받는 주소가 거부됐습니다${server}. MAIL_FROM·MAIL_TO 를 확인하세요.`;
    default:
      return `메일 발송 실패(${err?.code || err?.name || '오류'}): ${String(err?.message || err).slice(0, 200)}`;
  }
}

/** Outlook.com: 토큰 갱신(새 토큰은 바로 저장) → 계정 주소 확인 → Graph 로 발송 */
async function sendViaOutlook(path, s, msg, { env, log }) {
  const { accessToken, rotated } = await obtainAccessToken(path, { env, log });
  const { address } = await getAccount(accessToken, { env });
  if (!address) throw new Error('Outlook 계정 주소를 확인하지 못했습니다. mail-login 을 다시 하세요.');
  mask(address, env);
  const to = s.to.length ? s.to : [address];
  // 여럿이면 서로 주소가 보이지 않게: 받는 사람 칸은 보내는 계정, 실제 받는 사람은 숨은 참조
  const envelope = to.length > 1 ? { to: [address], bcc: to } : { to };
  await sendGraphMail(accessToken, { subject: msg.subject, html: msg.html, ...envelope, env });
  return { via: 'Outlook', accepted: to.length, rejected: 0, rotated };
}

async function sendViaSmtp(s, msg, { transportOverride }) {
  let transport = transportOverride;
  if (!transport) {
    let nodemailer;
    try {
      ({ default: nodemailer } = await import('nodemailer'));
    } catch {
      throw new Error('nodemailer 가 설치되지 않았습니다 (npm ci 또는 npm install)');
    }
    transport = nodemailer.createTransport({
      host: s.host,
      port: s.port,
      secure: s.security === 'ssl',
      requireTLS: s.security === 'starttls',
      ignoreTLS: s.security === 'none',
      auth: s.user ? { user: s.user, pass: s.pass } : undefined,
      connectionTimeout: 20000,
      greetingTimeout: 20000,
      socketTimeout: 30000,
      // 본문에 외부 글이 들어가므로 파일·URL 을 읽어 붙이는 기능은 끈다
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  }
  const envelope = s.to.length > 1 ? { to: s.from, bcc: s.to } : { to: s.to[0] };
  let info;
  try {
    info = await transport.sendMail({ from: s.from, ...envelope, ...msg });
  } catch (err) {
    throw new Error(explainMailError(err, s));
  }
  // 여럿에게 보낼 때 받는 사람 칸에 넣은 보내는 주소는 세지 않는다(주소 표기가 달라 못 맞추면 그대로 셈)
  const mine = new Set(s.to.map((x) => x.toLowerCase()));
  const count = (list = []) => list.filter((x) => mine.has(String(x).toLowerCase())).length;
  const accepted = count(info.accepted) || (info.accepted || []).length;
  const rejected = count(info.rejected);
  if (!accepted) throw new Error(`받는 주소가 모두 거부됐습니다 (${rejected}개). MAIL_TO 를 확인하세요.`);
  return { via: 'SMTP', accepted, rejected };
}

/** Outlook 으로 보내고, 막히면(계정 정지 등) SMTP 예비로. 무료 계정이 묶여도 그날 메일이 끊기지 않게 한다. */
async function sendOutlookOrBackup(path, s, msg, { env, log, transportOverride }) {
  try {
    return await sendViaOutlook(path, s, msg, { env, log });
  } catch (err) {
    if (!s.smtp) throw err;
    log(`Outlook 으로 보내지 못해 예비(SMTP)로 보냅니다: ${publicError(err)}`);
    try {
      return { ...(await sendViaSmtp(s.smtp, msg, { transportOverride })), fallback: err.message };
    } catch (backupErr) {
      throw new Error(`${err.message} / 예비(SMTP)도 실패: ${backupErr.message}`);
    }
  }
}

/**
 * 브리핑 메일 발송. 같은 날짜는 한 번만 보낸다(--force 로 다시).
 * 받는 사람이 여럿이면 서로의 주소가 보이지 않게 숨은 참조로 보낸다.
 * Outlook 이 실패하면 SMTP 예비로 보낸다(fallback 에 Outlook 실패 이유). 예비가 없거나 예비도 실패하면 오류.
 * @returns {Promise<{sent:boolean, skipped?:boolean, reason?:string, via?:string, accepted?:number, rejected?:number, fallback?:string}>}
 */
export async function sendBriefMail(cfg, brief, { test = false, force = false, env = process.env, transportOverride, feedOverride, log = console.log } = {}) {
  const s = mailSettings(env);
  if (!s) return { sent: false, skipped: true, reason: '메일 설정이 없어 건너뜁니다 (OUTLOOK_CLIENT_ID·OUTLOOK_REFRESH_TOKEN 또는 SMTP_HOST·MAIL_TO).' };
  const path = mailStatePath(cfg);
  if (!test && !force && brief && loadMailState(path).last_sent === brief.date) {
    return { sent: false, skipped: true, reason: `${brief.date} 브리핑 메일은 이미 보냈습니다 (다시 보내려면 --force).` };
  }
  // 공개 저장소의 Actions 기록에 주소가 찍히지 않게(오류 문구 포함)
  for (const addr of s.to) mask(addr, env);
  const title = mailTitle(cfg, env);
  const extraNews = test || !brief ? null : await fetchMailNews(brief, { env, ...(feedOverride ? { getFeed: feedOverride } : {}) });
  if (extraNews?.error) log('메일 맨 아래 관심 뉴스를 가져오지 못해 안내 문구만 넣습니다.');
  const msg = test || !brief
    ? testMail(cfg, env)
    : {
        subject: mailSubject(brief, title),
        html: renderEmailHtml(brief, { siteUrl: cfg.site.url, title, extraNews, assetUrl: assetUrlOf(env) }),
        text: `${title}\n\n${renderMarkdown(brief, { siteUrl: cfg.site.url })}${assetUrlOf(env) ? `\n\n우리 자산 영향 확인(사내망): ${assetLink(assetUrlOf(env), brief.date)}\n` : ''}${keywordNewsText(extraNews)}`,
      };
  const r = s.kind === 'outlook' ? await sendOutlookOrBackup(path, s, msg, { env, log, transportOverride }) : await sendViaSmtp(s, msg, { transportOverride });
  if (!test && brief) {
    // 공개 저장소에 남으므로 주소는 적지 않는다(건수만). Outlook 토큰 상태는 그대로 둔다.
    const next = { ...loadMailState(path), version: 1, last_sent: brief.date, last_sent_at: kstIso(), recipients: r.accepted };
    writeAtomic(path, `${JSON.stringify(next, null, 2)}\n`);
  }
  return { sent: true, ...r };
}
