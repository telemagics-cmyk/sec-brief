// 메일 발송(선택): 브리핑을 HTML 메일로 보낸다. 보내는 길은 둘 중 하나.
// 둘 다 있으면 Outlook 으로 보내고, Outlook 이 실패한 날(무료 계정 정지 등)은 SMTP 로 보낸다.
//   Outlook.com(개인 Microsoft 계정): OUTLOOK_CLIENT_ID, OUTLOOK_REFRESH_TOKEN — Graph 메일 API (outlook.mjs)
//   SMTP(Gmail 앱 비밀번호 등)     : SMTP_HOST, SMTP_PORT(기본 465), SMTP_USER, SMTP_PASS, MAIL_FROM(선택)
//   받는 주소: MAIL_TO(쉼표로 여러 개). Outlook 은 비우면 보내는 계정 자신에게.
// 공개 저장소이므로 주소·계정·토큰은 저장소가 아니라 비밀값(환경 변수)으로만 받고, Actions 기록에서는 가린다.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { alertOf, briefUrl, emptyNote, renderMarkdown, sinceNote, sortedBadges } from './brief.mjs';
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
// 디자인(2026-11-18 사용자가 준 시안): 미색 바탕·남색 글자·금색 강조, 모서리 없는 흰 본문.
// 구성: 머리(이름·날짜·한 줄 문구) → 건수 → 오늘 먼저 확인할 일 → 주요 보안 뉴스(국내|해외) → 보안 업데이트 권고(KISA)
//       → 실제 악용 확인 취약점(있는 날) → 신규 고위험 취약점 → 관심 회사 소식(Secret 이 있을 때) → 꼬리(수집 상태·링크).
// Outlook(Windows) 은 Word 로 그려 div 의 폭·여백을 무시하므로 뼈대는 표로 짜고 배경색은 bgcolor 로도 준다.
// 스타일은 인라인이 기본이고 <style> 에는 휴대폰 배치와 Outlook 보정만 둔다(모르는 메일 앱은 인라인 그대로 보인다).
// 숨김 글·보이지 않는 문자·글자 크기 0 은 쓰지 않는다(스팸 메일의 흔한 특징 — 시험이 지킨다).

const FONT = "'Malgun Gothic','맑은 고딕','Apple SD Gothic Neo','Noto Sans KR',Arial,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";
const MONO = "Consolas,'Courier New',monospace";
// 시안의 색. 작은 회색 글자만 바탕 대비 4.5:1 이상이 되게 조금 진하게 했다.
const C = {
  page: '#EDEBE5', card: '#FFFFFF', head: '#FAF8F2', soft: '#F5F3ED', check: '#F8F6F0', corp: '#F7F5EF',
  ink: '#243747', ink2: '#3D4F5D', body: '#637078', label: '#56687A', meta: '#6B716E', headSub: '#666B69', foot: '#5F6F7B',
  gold: '#9A783C', goldText: '#8B6B35', rule: '#E5E2DA', ruleCheck: '#E4E0D6', box: '#DFDBD1',
  hot: '#9C351C', hotSoft: '#FFF0E9', alertSoft: '#FBEEE9', corpInk: '#254338', corpSub: '#55695D',
};
const TBL = 'role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"';

// 폭: 받는 사람 대부분이 1920×1080 화면의 웹메일(읽기 창 약 1,000~1,500px)로 읽는다 → 시안대로 최대 MAIL_W.
// Outlook(Windows) 은 MSO_W 한 단: 그 Word 그리기 방식은 max-width 를 고정 폭처럼 써서(창이 좁아도 줄지 않음 — Word 로
// 그려 확인) 넓히면 좁은 읽기 창·125% 배율에서 가로로 밀린다 → MSO 표와 MSO_CSS 의 .mailw 로 Outlook 에서만 MSO_W.
const MAIL_W = 880;
const MSO_W = 680;
const PAD = 38; // 본문 좌우 여백(휴대폰은 20 — LAYOUT_CSS)

// 밝은 화면 전용(시안). 휴대폰(창 640px 이하)은 여백·큰 문구를 줄이고 국내|해외를 위아래로, 취약점 표시는 제목 위로 — 데스크톱 웹메일 창은
// 이보다 좁을 일이 없어 창 폭 기준이어도 된다. 감추는 규칙(display:none 등)은 쓰지 않는다.
const LAYOUT_CSS = `:root { color-scheme: light; supported-color-schemes: light; }
@media (max-width: 640px) {
  .outer { padding: 0 !important; }
  .pad { padding-left: 20px !important; padding-right: 20px !important; }
  .hero { font-size: 32px !important; line-height: 42px !important; }
  .ncol { display: block !important; width: 100% !important; padding: 0 !important; }
  .ncol2 { padding-top: 28px !important; }
  .vpill { display: block !important; width: auto !important; padding: 12px 0 0 !important; border-bottom: 0 !important; }
  .vbody { display: block !important; padding-top: 6px !important; }
}`;
// Outlook(Windows): 표 안 글자에 글꼴을 물려주지 않아 따로 정하고(날짜 숫자만 세리프), 한글·숫자 사이 자동 띄움('2026 년')을 끈다.
// 국내|해외는 Outlook 에서 위아래로(680px 본문에 두 칸이면 한 줄이 18자 남짓): newsColumns 가 두 칸 사이에서 행을 나누고
// 여기서 칸 폭·여백을 덮어쓴다.
const MSO_CSS = `<!--[if mso]><style>table,td,p,a,span,h1,h2,h3,div{font-family:'Malgun Gothic',Arial,sans-serif !important;text-autospace:none;}.serif{font-family:Georgia,serif !important;}.mailw{max-width:${MSO_W}px !important;}.ncol{width:100% !important;padding:0 !important;}.ncol2{padding-top:28px !important;}</style><![endif]-->`;
// Outlook(Windows) 은 글자 단위 요소의 안쪽 여백을 무시하므로, 표시 안에 Outlook 에서만 보이는 빈칸을 둔다
const MSO_PAD = '<!--[if mso]>&nbsp;<![endif]-->';
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const pad2 = (n) => String(n).padStart(2, '0');

function a(url, text, style = '') {
  const href = safeUrl(url);
  return href ? `<a href="${h(href)}" style="color:${C.ink};text-decoration:none;${style}">${text}</a>` : text;
}

/** 'MM.DD HH:mm' (한국 시간) */
function when(iso) {
  const t = Date.parse(iso || '');
  return Number.isNaN(t) ? '' : kstStamp(new Date(t)).slice(5).replace('-', '.');
}

/**
 * 머리 맨 위 영문 이름: 'OO팀 일일 보안 브리핑' → 'OO팀 / DAILY SECURITY BRIEF'(이름은 Secret MAIL_TITLE — 저장소에 두지 않는다).
 * 그 꼴이 아니면 이름 그대로. 글자 사이는 벌리지 않는다(영문 약어가 떨어져 보임).
 */
export function brandLine(title) {
  const t = String(title || '').trim();
  const m = /^(.*?)\s*일일\s*보안\s*브리핑$/.exec(t);
  if (!m) return t;
  return m[1] ? `${m[1]} / DAILY SECURITY BRIEF` : 'DAILY SECURITY BRIEF';
}

/** 구역 제목(19px 굵게), 오른쪽에 금색 작은 글씨(건수·출처) */
function sectionTitle(title, note = '') {
  return `<tr><td style="padding:30px 0 12px;"><h2 style="margin:0;font-size:19px;line-height:28px;font-weight:bold;color:${C.ink};">${h(title)}${note ? ` <span style="font-size:12px;color:${C.gold};">${h(note)}</span>` : ''}</h2></td></tr>`;
}

/** 작은 안내 줄(html: 이미 이스케이프한 글) */
function noteRow(html, top = 8) {
  return `<tr><td style="padding:${top}px 0 0;font-size:12.5px;line-height:19px;color:${C.label};">${html}</td></tr>`;
}

/** 건수(시안: 연한 칸 여러 개를 흰 세로 줄로 나눔). 누르면 웹 페이지의 해당 구역 */
function statsTable(cells) {
  const w = Math.floor(100 / cells.length);
  return `<table ${TBL}><tr>${cells
    .map(([href, n, label, hot], i) => `<td width="${w}%" align="center" valign="top" bgcolor="${C.soft}" style="width:${w}%;padding:14px 4px 12px;background:${C.soft};text-align:center;${i < cells.length - 1 ? 'border-right:2px solid #FFFFFF;' : ''}">
${a(href, `<span style="font-size:25px;line-height:32px;font-weight:bold;color:${hot ? C.hot : C.ink};">${h(n)}</span><br><span class="tile-label" style="font-size:12px;line-height:18px;color:${C.label};">${h(label)}</span>`)}
</td>`)
    .join('')}</tr></table>`;
}

/** 오늘 먼저 확인할 일: 금색 번호 01·02·03, 굵은 제목과 설명(요약 문장으로 대신할 때는 첫 문장만 굵게) */
function checkTable(items) {
  const last = items.length - 1;
  return `<table ${TBL} bgcolor="${C.check}" style="background:${C.check};">${items
    .map((x, i) => `<tr>
<td width="46" valign="top" style="width:46px;padding:12px 0 12px 16px;"><p style="margin:0;font-size:19px;line-height:24px;font-weight:bold;color:${C.gold};">${pad2(i + 1)}</p></td>
<td valign="top" style="padding:12px 16px 12px 4px;${i < last ? `border-bottom:1px solid ${C.ruleCheck};` : ''}"><p style="margin:0;font-size:15px;line-height:24px;${x.strong ? 'font-weight:bold;' : ''}color:${C.ink};">${h(x.title)}</p>${x.detail ? `<p style="margin:1px 0 0;font-size:13px;line-height:20px;color:${C.label};">${h(x.detail)}</p>` : ''}</td>
</tr>`)
    .join('')}</table>`;
}

/** 기사 한 건: 금색 번호, 굵은 제목(→ 원문), 매체·시각, 요약, 확인 포인트(금색). 원문 제목은 웹 페이지에만(메일은 간결하게) */
function newsItem(i, n) {
  const others = n.outlets?.length > 1 ? ` 외 ${n.outlets.length - 1}곳` : '';
  const at = when(n.published);
  const meta = `${n.source || ''}${others}${at ? ` · ${at}` : ''}`;
  const summary = n.summary_ko || truncate(n.snippet || '', 120);
  const line = `border-bottom:1px solid ${C.rule};`;
  return `<tr>
<td width="30" valign="top" style="width:30px;padding:15px 4px 16px 0;${line}"><p style="margin:0;font-size:12px;line-height:24px;font-weight:bold;color:${C.gold};">${pad2(i + 1)}</p></td>
<td valign="top" style="padding:15px 0 16px;${line}">
<p style="margin:0;font-size:15px;line-height:24px;font-weight:bold;">${a(n.url, h(n.title_ko || n.title))}</p>
${meta ? `<p style="margin:4px 0 0;font-size:11.5px;line-height:17px;color:${C.meta};">${h(meta)}</p>` : ''}
${summary ? `<p style="margin:7px 0 0;font-size:13px;line-height:21px;color:${C.body};">${h(summary)}</p>` : ''}
${n.check_ko ? `<p style="margin:7px 0 0;font-size:13px;line-height:20px;font-weight:bold;color:${C.goldText};">확인 포인트 · ${h(n.check_ko)}</p>` : ''}
</td></tr>`;
}

/** 국내·해외 한 칸: 제목(금색 밑줄)·건수 + 기사 목록 */
function newsColumn(title, list, b) {
  const body = list.length
    ? `<table ${TBL}>${list.map((n, i) => newsItem(i, n)).join('')}</table>`
    : `<p style="margin:14px 0 0;font-size:13px;line-height:20px;color:${C.label};">${h(emptyNote(b, 'news'))}</p>`;
  return `<table ${TBL}><tr><td style="padding:0 0 12px;border-bottom:2px solid ${C.gold};"><h3 style="margin:0;font-size:18px;line-height:26px;font-weight:bold;color:${C.ink};">${h(title)} <span style="font-size:12px;color:${C.gold};">${list.length}건</span></h3></td></tr></table>
${body}`;
}

/**
 * 국내|해외 두 칸(시안대로 표 두 칸 — Outlook 웹·Gmail·국내 웹메일 모두 나란히, 휴대폰은 LAYOUT_CSS 로 위아래).
 * Outlook(Windows) 은 두 칸 사이에서 행을 나눠(<!--[if mso]>) 위아래로 놓고 MSO_CSS 가 폭·여백을 덮어쓴다.
 */
function newsColumns(dom, intl, b) {
  return `<table ${TBL}><tr>
<td class="ncol" valign="top" style="width:50%;padding:0 16px 0 0;vertical-align:top;">${newsColumn('국내 보안 뉴스', dom, b)}</td>
<!--[if mso]></tr><tr><![endif]-->
<td class="ncol ncol2" valign="top" style="width:50%;padding:0 0 0 16px;vertical-align:top;">${newsColumn('해외 보안 뉴스', intl, b)}</td>
</tr></table>`;
}

/** 보안 업데이트 권고(KISA 보호나라): 금색 왼쪽 막대 상자에 제목을 굵게. 보안공지가 아닌 것(취약점 정보·경보단계)만 작은 표시 */
function kisaBox(adv, b) {
  if (!adv.length) return noteRow(h(emptyNote(b, 'kisa')), 0);
  const lines = adv.map((x, i) => {
    const kind = String(x.source || '').replace(/^KISA\s*/, '');
    const color = x.alert ? C.hot : C.ink2;
    const tag = kind && kind !== '보안공지' ? ` <span style="font-size:12px;color:${x.alert ? C.hot : C.gold};">${h(kind)}</span>` : '';
    const day = /^\d{4}-\d{2}-\d{2}$/.test(x.date || '') ? `${x.date.slice(5, 7)}.${x.date.slice(8, 10)}` : '';
    return `<p style="margin:${i ? 8 : 0}px 0 0;font-size:14px;line-height:22px;font-weight:bold;color:${color};">${a(x.url, h(x.title), `color:${color};`)}${tag}${day ? ` <span style="font-size:12px;font-weight:normal;color:${C.meta};">· ${day}</span>` : ''}</p>`;
  });
  return `<tr><td><table ${TBL}><tr><td style="padding:15px 18px;border:1px solid ${C.box};border-left:4px solid ${C.gold};">
${lines.join('\n')}
</td></tr></table></td></tr>`;
}

/** 취약점 표시(시안: 붉은 작은 칸). 실제 악용(KEV)은 진하게 */
function pill(text, strong = false) {
  return `<span style="display:inline-block;white-space:nowrap;padding:3px 8px;font-size:11px;line-height:16px;font-weight:bold;color:${strong ? '#FFFFFF' : C.hot};background:${strong ? C.hot : C.hotSoft};">${MSO_PAD}${h(text)}${MSO_PAD}</span>`;
}

/** 취약점 한 줄: 왼쪽 표시, 제목(→ NVD)·영향·조치(금색), 맨 아래 번호·다른 표시(웹과 같은 순서)·링크 */
function vulnRow(v, { kev = false, assetHref = '' } = {}) {
  const score = v.cvss?.score;
  const label = kev ? 'KEV' : Number.isFinite(score) ? `CVSS ${score.toFixed(1)}` : 'CVE';
  const ids = v.ids?.length > 1 ? ` 외 ${v.ids.length - 1}건` : '';
  const link = (u, t) => a(u, t, `color:${C.meta};text-decoration:underline;`);
  const meta = [
    `<span style="font-family:${MONO};">${h(v.id)}</span>${h(ids)}`,
    ...sortedBadges(v).filter((t) => t !== label).map((t) => h(t)),
    ...(v.links?.[0] ? [link(v.links[0], '벤더 공지')] : []),
    ...(assetHref ? [link(assetHref, '우리 자산 영향')] : []),
  ].join(' · ');
  const line = `border-bottom:1px solid ${C.rule};`;
  return `<tr>
<td class="vpill" width="88" valign="top" style="width:88px;padding:14px 8px 13px 0;${line}">${pill(label, kev)}</td>
<td class="vbody" valign="top" style="padding:12px 0 13px;${line}">
<p style="margin:0;font-size:14.5px;line-height:23px;font-weight:bold;">${a(v.nvd, h(v.ko?.title || v.id))}</p>
${v.ko?.impact ? `<p style="margin:2px 0 0;font-size:13px;line-height:20px;color:${C.body};">${h(v.ko.impact)}</p>` : ''}
${v.ko?.action ? `<p style="margin:5px 0 0;font-size:13px;line-height:20px;font-weight:bold;color:${C.goldText};">조치 · ${h(v.ko.action)}</p>` : ''}
<p style="margin:5px 0 0;font-size:11.5px;line-height:18px;color:${C.meta};">${meta}</p>
</td></tr>`;
}

/** 글자 메일(SMTP 의 text 부분)에 붙는 같은 내용 */
function keywordNewsText(extra) {
  if (!extra) return '';
  const lines = extra.items.map((n) => `- ${n.title} (${n.outlet}${n.outlets > 1 ? ` 외 ${n.outlets - 1}곳` : ''}) ${n.url}`);
  return `\n\n## ${extra.keyword} 소식\n\n${extra.error || (lines.length ? lines.join('\n') : '새 기사가 없습니다.')}\n`;
}

/** (선택) 메일에만 붙는 '○○ 소식' (src/mail-news.mjs, Secret MAIL_NEWS_KEYWORD): 연한 상자에 기사 제목·매체 */
function corpNews(extra) {
  const sub = (html, top = 0) => `<p style="margin:${top}px 0 0;font-size:12px;line-height:18px;color:${C.corpSub};">${html}</p>`;
  let inner;
  if (extra.error) inner = sub(h(extra.error));
  else if (!extra.items.length) inner = sub('새 기사가 없습니다.');
  else {
    inner = extra.items
      .map((n, i) => `<p style="margin:${i ? 12 : 0}px 0 0;font-size:14px;line-height:22px;font-weight:bold;">${a(n.url, h(n.title), `color:${C.corpInk};`)}</p>
${sub(h(`${n.outlet}${n.outlets > 1 ? ` 외 ${n.outlets - 1}곳` : ''} · ${when(n.published)}`), 2)}`)
      .join('\n');
    if (extra.total > extra.items.length) {
      inner += sub(`그 밖의 ${extra.total - extra.items.length}건은 ${a(mailNewsSearchUrl(extra.keyword), 'Google 뉴스', `color:${C.corpSub};text-decoration:underline;`)}에서 볼 수 있습니다.`, 12);
    }
  }
  return `${sectionTitle(`${extra.keyword} 소식`, 'Google 뉴스 · 지난 브리핑 이후')}
<tr><td><table ${TBL} bgcolor="${C.corp}" style="background:${C.corp};"><tr><td style="padding:16px 18px;">
${inner}
</td></tr></table></td></tr>`;
}

/**
 * (선택) Secret ASSET_URL: 사내 정보자산 관리 프로그램의 주소(예: https://자산서버:4800). 있으면 취약점마다 '우리 자산 영향' 링크가
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

/**
 * 요약을 문장으로 나눈다(마침표·물음표·느낌표 뒤 빈칸). 영문 약어('U.S. ')·숫자('2026. 11.') 뒤는 나누지 않는다 —
 * 잘못 나누는 것보다 두 문장이 한 줄에 남는 편이 낫다.
 */
export function sentences(text) {
  return String(text || '').split(/(?<=[^A-Za-z0-9\s.][.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}

/**
 * 오늘 먼저 확인할 일: Claude 가 고른 것(brief.actions — 제목·설명, 최대 3개). 없으면(규칙 기반 날·예전 브리핑)
 * 요약 문장을 '오늘의 요약'으로 대신 보인다(첫 문장 = 요약 규칙상 가장 시급한 일만 굵게).
 */
function todayChecks(b) {
  const actions = (Array.isArray(b.actions) ? b.actions : []).filter((x) => x?.title).slice(0, 3);
  if (actions.length) {
    return { title: actions.length > 1 ? `오늘 먼저 확인할 ${actions.length}가지` : '오늘 먼저 확인할 것', items: actions.map((x) => ({ title: x.title, detail: x.detail || '', strong: true })) };
  }
  const lines = sentences(b.overview).slice(0, 3);
  return { title: '오늘의 요약', items: lines.map((s, i) => ({ title: s, detail: '', strong: i === 0 })) };
}

/** 웹 페이지와 같은 순서: 뉴스(국내|해외) → KISA → 악용 확인 → 신규 고위험 (그 앞에 건수·확인할 일, 메일에만 관심 회사 소식) */
export function renderEmailHtml(b, { siteUrl = '', title = '일일 보안 브리핑', org = '', extraNews = null, assetUrl = '' } = {}) {
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
  const [y, m, d] = [0, 5, 8].map((i) => Number(b.date.slice(i, i + (i ? 2 : 4))));
  const hhmm = b.generated_at?.slice(11, 16) || '';
  const cvssMin = Number(b.cvss_min ?? 9).toFixed(1);
  const underline = `color:${C.ink};text-decoration:underline;`;

  // 머리: 이름(왼쪽)·월/일(오른쪽) → 한 줄 문구 → 날짜·생성 시각
  const head = `<table ${TBL}><tr>
<td valign="top"><p style="margin:0;font-size:12px;line-height:18px;font-weight:bold;color:${C.ink};">${h(brandLine(title))}</p>${org ? `<p style="margin:4px 0 0;font-size:12px;line-height:18px;color:${C.headSub};">${h(org)}</p>` : ''}</td>
<td width="90" align="right" valign="top" style="width:90px;text-align:right;"><p style="margin:0;font-size:11px;line-height:14px;font-weight:bold;color:${C.headSub};">${MONTHS[m - 1]}</p><p class="serif" style="margin:0;font-family:${SERIF};font-size:38px;line-height:44px;color:${C.ink};">${d}</p></td>
</tr></table>
<p class="hero" style="margin:24px 0 12px;font-size:42px;line-height:54px;font-weight:bold;letter-spacing:-1.5px;color:${C.ink};">안전한 하루를 위한<br>보안 인사이트.</p>
<p style="margin:0;font-size:13px;line-height:20px;color:${C.headSub};">${y}년 ${m}월 ${d}일 ${weekdayKo(b.date)}요일 · ${h(hhmm)} KST${since ? ` · ${h(since)}` : ''}</p>`;

  const rows = [];
  if (alert) {
    rows.push(`<tr><td style="padding:0 0 16px;"><table ${TBL}><tr><td bgcolor="${C.alertSoft}" style="background:${C.alertSoft};border-left:4px solid ${C.hot};padding:12px 16px;">
<p style="margin:0;font-size:12px;line-height:18px;font-weight:bold;color:${C.hot};">사이버위기 경보</p>
<p style="margin:2px 0 0;font-size:15px;line-height:23px;font-weight:bold;">${a(alert.url, h(alert.title))}</p>
<p style="margin:2px 0 0;font-size:12px;line-height:18px;color:${C.meta};">${h(alert.source)} · ${h(alert.date)}</p>
</td></tr></table></td></tr>`);
  }

  // 건수: 실제 악용 칸은 새로 등재된 날(또는 수집 실패)만 — 없는 날은 꼬리에 '0건'
  const cells = [
    [anchor('news-domestic'), dom.length + intl.length, '국내·해외 뉴스', false],
    [anchor('kisa'), adv.length, 'KISA 공지', Boolean(alert)],
  ];
  if (exTotal || b.failed?.kev) cells.push([anchor('exploited'), b.failed?.kev ? '–' : exTotal, '실제 악용', exTotal > 0]);
  cells.push([anchor('critical'), b.critical_total ?? '–', `CVSS ${cvssMin} 이상`, false]);
  rows.push(`<tr><td>${statsTable(cells)}</td></tr>`);

  const checks = todayChecks(b);
  if (checks.items.length) rows.push(sectionTitle(checks.title), `<tr><td>${checkTable(checks.items)}</td></tr>`);

  rows.push(sectionTitle('주요 보안 뉴스'), `<tr><td>${newsColumns(dom, intl, b)}</td></tr>`);
  rows.push(sectionTitle('보안 업데이트 권고', `KISA ${adv.length}건`), kisaBox(adv, b));

  // 오늘 브리핑의 취약점을 자산 대장과 한 번에 비교(첫 취약점 구역 위에 한 번)
  const assetAll = assetUrl && (ex.length || cr.length)
    ? noteRow(`${a(assetHref(), '우리 자산 영향 한눈에 보기', `${underline}font-weight:bold;`)} — 오늘 브리핑의 취약점을 자산 대장과 비교합니다(사내망에서 열림)`, 0)
    : '';
  if (ex.length) {
    rows.push(sectionTitle('실제 악용 확인 취약점', `CISA KEV 신규 ${exTotal}건`));
    if (assetAll) rows.push(assetAll);
    rows.push(`<tr><td><table ${TBL}>${ex.map((v) => vulnRow(v, { kev: true, assetHref: assetHref(v.id) })).join('')}</table></td></tr>`);
    if (b.exploited_more?.length) rows.push(noteRow(`그 밖의 신규 등재 ${b.exploited_more.length}건: ${h(b.exploited_more.map((v) => v.id).join(', '))}`));
  }

  const crTotal = b.critical_total;
  rows.push(sectionTitle('신규 고위험 취약점', crTotal === null || crTotal === undefined ? '수집 실패' : ''));
  if (!ex.length && assetAll) rows.push(assetAll);
  rows.push(cr.length ? `<tr><td><table ${TBL}>${cr.map((g) => vulnRow(g, { assetHref: assetHref(g.id) })).join('')}</table></td></tr>` : noteRow(h(emptyNote(b, 'critical')), 0));
  if (cr.length && crTotal !== null && crTotal !== undefined) {
    const more = b.critical_more?.length || 0;
    rows.push(noteRow(`CVSS ${cvssMin} 이상 ${crTotal}건 중 주요 ${cr.length}묶음${more ? ` · 나머지 ${more}묶음은 ${dayUrl ? a(anchor('critical'), '웹 페이지', underline) : '웹 페이지'}에서 볼 수 있습니다.` : ''}`));
  }
  if (extraNews) rows.push(corpNews(extraNews));

  // 꼬리: 이름 → 생성·수집 상태 → KEV 0건(시안) → 표시 풀이 → 링크
  const ok = (b.sources || []).filter((s) => s.ok).length;
  const small = (text, top = 4) => `<p style="margin:${top}px 0 0;font-size:11.5px;line-height:18px;color:${C.foot};">${text}</p>`;
  const kevNote = b.failed?.kev ? 'CISA KEV 수집 실패 — 실제 악용 취약점은 웹 페이지에서 확인하세요' : exTotal ? '' : 'CISA KEV 신규 등재 0건 · 이번 수집 기준';
  const footLink = `color:${C.foot};text-decoration:underline;`;
  const links = [dayUrl ? a(dayUrl, '전체 브리핑 보기', footLink) : '', siteUrl ? a(`${siteUrl}/archive.html`, '지난 브리핑', footLink) : ''].filter(Boolean).join(' &nbsp;/&nbsp; ');
  const foot = [
    `<p style="margin:0;font-size:12px;line-height:18px;font-weight:bold;color:${C.foot};">${h(org || title)}</p>`,
    small(`${b.date.replaceAll('-', '.')} ${h(hhmm)} KST 생성 · 수집 ${ok}/${(b.sources || []).length}곳 정상 · 자동 발송`),
    kevNote ? small(h(kevNote)) : '',
    ex.length || cr.length ? small('KEV: 미국 사이버보안청(CISA)이 실제 공격에 쓰인 것을 확인한 취약점 · CVSS: 심각도 점수(10점 만점) · EPSS: 30일 안에 공격에 쓰일 확률(추정)') : '',
    links ? `<p style="margin:10px 0 0;font-size:12px;line-height:18px;color:${C.foot};">${links}</p>` : '',
  ].filter(Boolean).join('\n');

  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<meta name="x-apple-disable-message-reformatting">
<title>${h(mailSubject(b, title))}</title>
<style>${LAYOUT_CSS}</style>
${MSO_CSS}
</head>
<body bgcolor="${C.page}" style="margin:0;padding:0;background:${C.page};">
<table ${TBL} bgcolor="${C.page}" style="background:${C.page};"><tr><td class="outer" align="center" style="padding:28px 0;">
<!--[if mso]><table role="presentation" width="${MSO_W}" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="mailw" bgcolor="${C.card}" style="max-width:${MAIL_W}px;width:100%;background:${C.card};font-family:${FONT};color:${C.ink};word-break:keep-all;overflow-wrap:anywhere;">
<tr><td class="pad" bgcolor="${C.head}" style="background:${C.head};padding:30px ${PAD}px 26px;">
${head}
</td></tr>
<tr><td class="pad" style="padding:24px ${PAD}px 34px;">
<table ${TBL}>
${rows.join('\n')}
</table>
</td></tr>
<tr><td class="pad" bgcolor="${C.soft}" style="background:${C.soft};padding:22px ${PAD}px 24px;">
${foot}
</td></tr>
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

/** (선택) Secret MAIL_ORG: 메일 머리 이름 아래·꼬리에 쓰는 조직 이름(예: '○○ · ○○센터'). 저장소·웹·카카오에는 남기지 않는다. */
export function mailOrg(env = process.env) {
  return secret('MAIL_ORG', env);
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
        html: renderEmailHtml(brief, { siteUrl: cfg.site.url, title, org: mailOrg(env), extraNews, assetUrl: assetUrlOf(env) }),
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
