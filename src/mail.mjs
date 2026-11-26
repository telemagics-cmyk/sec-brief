// 메일 발송(선택): 브리핑을 HTML 메일로 보낸다. 보내는 길은 둘 중 하나.
// 둘 다 있으면 SMTP(Gmail)로 보내고, SMTP 가 실패한 날만 Outlook 으로 보낸다(Outlook.com 은 접수 뒤 반송할 수 있어 예비로만).
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
 * 비밀값에서 메일 설정을 읽는다. 보낼 길(SMTP+받는 주소, 또는 Outlook)이 없으면 null(메일 끔).
 * 둘 다 있으면 SMTP(Gmail 등)로 보내고 Outlook 은 예비로 둔다(outlook: true). Outlook.com 은 발송을 '접수'(202)한 뒤에
 * 보낸 곳 IP 대역을 스팸으로 보고 받는 사람 전원에게 반송할 수 있어(2026-11-24, 5.7.501) 실패를 알 수도 예비로 넘길 수도 없다.
 */
export function mailSettings(env = process.env) {
  const to = secret('MAIL_TO', env).split(/[,;\s]+/).filter(Boolean);
  const bad = to.filter((a) => !EMAIL_RE.test(a));
  if (bad.length) throw new Error(`MAIL_TO 에 메일 주소가 아닌 값이 있습니다(${bad.length}개). 쉼표로 구분해 넣으세요.`);
  const smtp = smtpSettings(to, env);
  const outlook = outlookConfigured(env);
  if (smtp) return outlook ? { ...smtp, outlook: true } : smtp;
  return outlook ? { kind: 'outlook', to } : null;
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
// 디자인(2026-11-19 사용자가 준 두 번째 시안): 미색 바탕·흰 본문·남색 글자·금색 강조.
// 구성: 머리(이름 | 조직, 큰 제목, 오른쪽 날짜) → (경보) → 건수 4칸 → 오늘의 우선 점검(남색 상자) → 웹에서 보기(구역 링크)
//       → 주요 보안 뉴스(국내|해외, 국내 언론 기사가 많은 날은 통합) → KISA 보안 업데이트 권고 → 실제 악용 확인 취약점(있는 날)
//       → 신규 고위험 취약점(제품·주요 영향·CVSS 표) → 관심 회사 소식(Secret 이 있을 때) → 꼬리(이름·링크·수집 상태).
// Outlook(Windows) 은 Word 로 그려 div 의 폭·여백을 무시하므로 뼈대는 표로 짜고 배경색은 bgcolor 로도 준다.
// 스타일은 인라인이 기본이고 <style> 에는 휴대폰 배치와 Outlook 보정만 둔다(모르는 메일 앱은 인라인 그대로 보인다).
// 시안과 다르게 한 것: 숨김 미리 보기 글·display:none·font-size:0 은 쓰지 않는다(스팸 메일의 흔한 특징 — 시험이 지킨다).
// 메일 안 이동 링크(#)는 메일 앱마다 되고 안 되고가 달라(Outlook 웹 등) '웹에서 보기'로 웹 페이지의 같은 구역을 연다.
// 인쇄용 규칙(@page, 인쇄 때 순서 바꾸기)은 메일 앱 대부분이 지우므로 넣지 않았다.

const FONT = "'Malgun Gothic','맑은 고딕','Apple SD Gothic Neo','Noto Sans KR',Arial,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";
const LATIN = "Arial,'Malgun Gothic','Apple SD Gothic Neo',sans-serif";
const MONO = "Consolas,'Courier New',monospace";
// 시안의 색(작은 글자도 바탕 대비 4.5:1 이상 — 시안 값 그대로 넘는다). hot 은 경보·실제 악용·점수
const C = {
  page: '#EBE9E2', paper: '#FFFFFF', mast: '#F8F5ED', navy: '#223947', hero: '#1E3443', ink: '#203645',
  identity: '#465862', gap: '#B9B3A7', dateRule: '#CFC8B8', month: '#64583F', clock: '#53616B',
  label: '#344B58', value: '#203746', unit: '#58636A', detail: '#495C64', tileRule: '#D6D5CD',
  panelHead: '#FAF8F2', num: '#E9C48A', key: '#FFFFFF', desc: '#EDF1F0', panelRule: '#50616A',
  navRule: '#D4D7D3', navLabel: '#53616A', link: '#3B5260',
  colTitle: '#263D4B', gold: '#A88442', count: '#74551D',
  story: '#253B49', meta: '#53636B', summary: '#354952', check: '#384C56', checkLabel: '#79571F', rule: '#DADBD4',
  mark: '#906C2F', kisa: '#2C434E', scope: '#4F5E64', th: '#F4F2EB', thRule: '#D3D5CE', thText: '#42535B',
  product: '#253C49', impact: '#3C505A',
  corp: '#F2F5EF', corpBar: '#55705F', corpLabel: '#415F51', corpHead: '#263F37', corpText: '#425A50',
  foot: '#46565D', footRule: '#D2D2C7',
  hot: '#803D2E', hotBar: '#9C351C', alertSoft: '#FBEEE9',
};
const TBL = 'role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"';

// 폭: 받는 사람 대부분이 1920×1080 화면의 웹메일(읽기 창 약 1,000~1,500px)로 읽는다 → 시안대로 최대 MAIL_W.
// Outlook(Windows) 은 MSO_W 한 단: 그 Word 그리기 방식은 max-width 를 고정 폭처럼 써서(창이 좁아도 줄지 않음 — Word 로
// 그려 확인) 넓히면 좁은 읽기 창·125% 배율에서 가로로 밀린다 → 최대 폭은 Word 가 보지 않는 div(<!--[if !mso]>)에 두고,
// Word 에는 MSO_W 폭 표만 보인다.
const MAIL_W = 900;
const MSO_W = 680;
const PAD = 40; // 본문 좌우 여백(창이 좁으면 25·20·15 — LAYOUT_CSS)

// 휴대폰·좁은 창(시안의 네 구간). 칸을 위아래로 쌓고 여백·큰 글자를 줄일 뿐 감추는 규칙(display:none 등)은 쓰지 않는다.
// 창 폭 기준이라 넓은 화면의 좁은 읽기 창에서는 데스크톱 배치 그대로다(그래도 넘치지 않게 칸은 표 비율).
const LAYOUT_CSS = `@media (max-width: 760px) {
  .outer { padding: 0 !important; }
  .pad { padding-left: 25px !important; padding-right: 25px !important; }
  .pkey { width: 202px !important; }
}
@media (max-width: 680px) {
  .ncol { display: block !important; width: 100% !important; padding: 0 !important; }
  .ncol2 { padding-top: 24px !important; }
  .pkey, .pdesc { display: block !important; width: auto !important; padding: 0 !important; }
  .pdesc { padding-top: 2px !important; }
}
@media (max-width: 560px) {
  .pad { padding-left: 20px !important; padding-right: 20px !important; }
  .mast { padding-top: 21px !important; padding-bottom: 20px !important; }
  .mast-copy, .date-cell { display: block !important; width: 100% !important; }
  .brand { font-size: 18px !important; }
  .brand-gap { margin-left: 5px !important; padding-left: 9px !important; }
  .hero { font-size: 34px !important; line-height: 45px !important; letter-spacing: -1.6px !important; }
  .date-cell { padding: 8px 0 0 !important; border-left: 0 !important; text-align: left !important; }
  .date-line { display: inline !important; color: #4B5C63 !important; font-size: 13px !important; line-height: 21px !important; }
  .date-day { font-family: 'Malgun Gothic','Apple SD Gothic Neo',Arial,sans-serif !important; font-size: 13px !important; line-height: 21px !important; letter-spacing: 0 !important; font-weight: bold !important; color: #4B5C63 !important; }
  .date-clock { margin-left: 6px !important; padding-left: 8px !important; border-left: 1px solid #B7B2A4 !important; }
  .metric-pair { display: block !important; width: 100% !important; }
  .metric-third { padding-left: 0 !important; border-left: 0 !important; }
  .metric-lower { padding-top: 11px !important; }
  .metric-low { padding-top: 9px !important; border-top: 1px solid #DBDDD5 !important; }
  .metric-num { font-size: 29px !important; }
  .panel { padding: 16px 15px 10px !important; }
  .panel-title { font-size: 21px !important; }
  .sec-title { font-size: 23px !important; letter-spacing: -0.8px !important; }
  .story-title { font-size: 17px !important; }
  .rcell { padding: 9px 5px !important; }
  .rcol-p { width: 44% !important; }
  .rcol-i { width: 37% !important; }
  .rcol-s { width: 19% !important; }
  .foot-links { display: block !important; text-align: left !important; padding-top: 6px !important; }
}
@media (max-width: 345px) {
  .pad { padding-left: 15px !important; padding-right: 15px !important; }
}`;
// Outlook(Windows): 표 안 글자에 글꼴을 물려주지 않아 따로 정하고(날짜·건수·번호 숫자만 세리프), 한글·숫자 사이 자동 띄움('2026 년')을 끈다.
// Word 는 class 속성의 첫 이름만 읽는다(2026-11-19 Word 로 그려 확인) → 여기 규칙이 걸릴 이름(serif)은 class 맨 앞에.
// **글꼴 말고는 넣지 않는다**: Outlook.com 웹은 이 <!--[if mso]> 안의 <style> 도 적용한다(2026-11-26 Gmail 로 보낸 메일에서
// 폭 규칙 .mailw·.ncol 이 걸려 본문 680px·국내|해외 9:1 — 그 규칙만 풀어 브라우저로 그려 같은 모양 재현). 배치는 MSO 전용 태그로.
const MSO_CSS = `<!--[if mso]><style>table,td,th,p,a,span,strong,h1,h2,h3,h4{font-family:'Malgun Gothic',Arial,sans-serif !important;text-autospace:none;}.serif{font-family:Georgia,serif !important;}</style><![endif]-->`;
/**
 * 표 칸 여는 태그를 Outlook(Windows)과 그 밖의 메일 앱에 따로 준다(조건 주석 — Word 만 앞의 것, 나머지는 뒤의 것을 본다).
 * 국내|해외 칸을 Outlook 에서 위아래로 쌓을 때 폭·여백을 Word 쪽 태그에만 준다(위 MSO_CSS 로 덮어쓰면 Outlook.com 도 따름).
 */
function td(webAttrs, msoAttrs) {
  return `<!--[if mso]><td ${msoAttrs}><![endif]--><!--[if !mso]><!--><td ${webAttrs}><!--<![endif]-->`;
}
// Outlook(Windows) 은 글자 단위 요소의 안쪽 여백·테두리를 무시하므로, 띄울 자리에 Outlook 에서만 보이는 빈칸을 둔다
const MSO_PAD = '<!--[if mso]>&nbsp;<![endif]-->';
const pad2 = (n) => String(n).padStart(2, '0');

/** 링크(허용한 주소만). 글자색은 둘레 글과 같게, 밑줄은 extra 로 */
function a(url, text, color = C.story, extra = '') {
  const href = safeUrl(url);
  return href ? `<a href="${h(href)}" style="color:${color};text-decoration:none;${extra}">${text}</a>` : text;
}
const underline = (color) => (url, text) => a(url, text, color, 'text-decoration:underline;');

/** 'MM.DD HH:mm' (한국 시간) */
function when(iso) {
  const t = Date.parse(iso || '');
  return Number.isNaN(t) ? '' : kstStamp(new Date(t)).slice(5).replace('-', '.');
}
/** 'YYYY-MM-DD' → 'MM.DD' */
const mmdd = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d || '') ? `${d.slice(5, 7)}.${d.slice(8, 10)}` : '');

/**
 * 머리·꼬리의 이름(Secret MAIL_TITLE·MAIL_ORG — 저장소에 두지 않는다).
 * 'OO팀 일일 보안 브리핑' + '가나다 · OO센터' → 굵은 이름 '가나다 OO팀' | 'OO센터', 큰 제목 '일일 보안 브리핑'.
 * 조직이 한 덩이면 칸막이 뒤에 두고, 회사 이름에 팀 이름이 이미 들었으면 되풀이하지 않는다. 이름 꼴이 아니면 큰 제목은 그대로.
 */
export function mastNames(title, org = '') {
  const t = String(title || '').trim();
  const m = /^(.*?)\s*일일\s*보안\s*브리핑$/.exec(t);
  const team = m ? m[1].trim() : '';
  const heading = m ? '일일 보안 브리핑' : t || '일일 보안 브리핑';
  const parts = String(org || '').split('·').map((s) => s.trim()).filter(Boolean);
  const company = parts.length > 1 ? parts[0] : '';
  const unit = parts.length > 1 ? parts.slice(1).join(' · ') : parts[0] || '';
  const brand = company && team && !company.split(/\s+/).includes(team) ? `${company} ${team}` : company || team;
  return brand ? { brand, unit, heading } : { brand: unit, unit: '', heading };
}

/** 건수 칸의 KISA 공지 이름: 'Fortinet 제품 보안 업데이트 권고' → 'Fortinet'. 같은 이름은 한 번, 경보 단계 변경은 빼고 */
export function kisaNames(adv) {
  const names = [];
  for (const x of adv || []) {
    if (x.alert) continue;
    const t = String(x.title || '').replace(/^CVE-\d{4}-\d+\s*\|\s*/, '').trim();
    const m = /^(.+?)\s+(?:제품|보안|신규|대상|관련|패키지|플러그인)/.exec(t);
    const name = (m ? m[1] : t.split(/\s+/)[0] || '').trim();
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

function kisaDetail(adv, b) {
  if (b.failed?.kisa) return '수집 실패';
  if (!adv.length) return '새 공지 없음';
  const names = kisaNames(adv);
  if (!names.length) return '경보 단계 변경';
  const shown = names.slice(0, 2).join(' · ').length > 18 ? names.slice(0, 1) : names.slice(0, 2);
  return `${shown.join(' · ')}${names.length > shown.length ? ` 외 ${names.length - shown.length}` : ''}`;
}

/** 구역 제목(27px 굵게), 오른쪽에 금색 작은 글씨(건수) */
function sectionTitle(title, note = '', top = 30) {
  return `<tr><td style="padding:${top}px 0 0;"><h2 class="sec-title" style="margin:0;font-size:27px;line-height:38px;font-weight:bold;letter-spacing:-1.05px;color:${C.ink};">${h(title)}${note ? ` <span style="margin-left:4px;font-size:14px;font-weight:bold;letter-spacing:0;color:${C.count};white-space:nowrap;">${h(note)}</span>` : ''}</h2></td></tr>`;
}

/** 작은 안내 줄(html: 이미 이스케이프한 글) */
function noteRow(html, top = 8) {
  return `<tr><td style="padding:${top}px 0 0;font-size:14px;line-height:22px;color:${C.scope};">${html}</td></tr>`;
}

/** 건수 한 칸: 이름(굵게)·숫자(세리프)·건·설명. rule: 왼쪽 세로 줄 */
function metric([label, value, detail, hot], { cls = '', rule = true } = {}) {
  const unit = typeof value === 'number' ? `${MSO_PAD}<span style="padding-left:4px;font-family:${FONT};font-size:13px;line-height:18px;letter-spacing:0;color:${C.unit};">건</span>` : '';
  return `<td class="metric${cls}" width="50%" valign="top" style="width:50%;padding:1px 10px 1px ${rule ? 18 : 0}px;vertical-align:top;${rule ? `border-left:1px solid ${C.tileRule};` : ''}">
<p class="metric-label" style="margin:0;font-size:14px;line-height:21px;font-weight:bold;color:${C.label};">${h(label)}</p>
<p class="serif metric-num" style="margin:3px 0 0;font-family:${SERIF};font-size:36px;line-height:42px;letter-spacing:-1px;color:${hot ? C.hot : C.value};">${h(value)}${unit}</p>
<p style="margin:2px 0 0;font-size:13px;line-height:21px;color:${C.detail};">${h(detail)}</p>
</td>`;
}

/** 건수 4칸(시안): 두 칸씩 묶어 넓으면 한 줄, 휴대폰은 두 줄 */
function statsGrid([c1, c2, c3, c4]) {
  const pair = (x, y, lower) => `<td class="metric-pair${lower ? ' metric-lower' : ''}" width="50%" valign="top" style="width:50%;padding:0;vertical-align:top;"><table ${TBL} style="table-layout:fixed;"><tr>
${metric(x, { cls: lower ? ' metric-low metric-third' : '', rule: lower })}
${metric(y, { cls: lower ? ' metric-low' : '' })}
</tr></table></td>`;
  return `<table ${TBL} style="table-layout:fixed;"><tr>${pair(c1, c2, false)}${pair(c3, c4, true)}</tr></table>`;
}

/**
 * 오늘의 우선 점검: Claude 가 고른 것(brief.actions — 제목·설명, 최대 3개). 없으면(규칙 기반 날·예전 브리핑)
 * 요약 문장을 '오늘의 요약'으로 대신 보인다(첫 문장 = 요약 규칙상 가장 시급한 일만 굵게).
 */
function todayChecks(b) {
  const actions = (Array.isArray(b.actions) ? b.actions : []).filter((x) => x?.title).slice(0, 3);
  if (actions.length) return { title: '오늘의 우선 점검', pairs: true, items: actions.map((x) => ({ title: x.title, detail: x.detail || '' })) };
  const lines = sentences(b.overview).slice(0, 3);
  return { title: '오늘의 요약', pairs: false, items: lines.map((s, i) => ({ title: s, strong: i === 0 })) };
}

/** 남색 상자: 금색 번호 01·02·03, 굵은 흰 제목 | 설명(좁으면 위아래) */
function priorityPanel(checks) {
  const rows = checks.items.map((x, i) => {
    const rule = i ? `border-top:1px solid ${C.panelRule};` : '';
    const body = checks.pairs
      ? `<table ${TBL}><tr><td class="pkey" width="224" valign="top" style="width:224px;padding:0 12px 0 0;font-size:16px;line-height:25px;font-weight:bold;color:${C.key};">${h(x.title)}</td><td class="pdesc" valign="top" style="padding:0;font-size:15px;line-height:25px;color:${C.desc};">${h(x.detail)}</td></tr></table>`
      : `<p style="margin:0;font-size:15px;line-height:25px;${x.strong ? `font-weight:bold;color:${C.key};` : `color:${C.desc};`}">${h(x.title)}</p>`;
    return `<tr><td class="serif" width="41" valign="top" style="width:41px;padding:8px 4px 8px 0;font-family:${SERIF};font-size:20px;line-height:25px;color:${C.num};${rule}">${pad2(i + 1)}</td><td valign="top" style="padding:8px 0;${rule}">${body}</td></tr>`;
  });
  return `<table ${TBL} bgcolor="${C.navy}" style="background:${C.navy};"><tr><td class="panel" style="padding:20px 24px 14px;">
<h2 class="panel-title" style="margin:0 0 6px;font-size:23px;line-height:33px;font-weight:bold;letter-spacing:-0.9px;color:${C.panelHead};">${h(checks.title)}</h2>
<table ${TBL}>${rows.join('\n')}</table>
</td></tr></table>`;
}

/** 웹에서 보기: 웹 페이지의 같은 구역으로(메일 안 이동 링크는 메일 앱마다 달라 쓰지 않는다) */
function webNav(dayUrl, hasKev) {
  const items = [['news-domestic', '국내 뉴스'], ['news-international', '해외 뉴스'], ['kisa', 'KISA 권고'], ...(hasKev ? [['exploited', '실제 악용']] : []), ['critical', '고위험 취약점']];
  const links = items.map(([id, text]) => a(`${dayUrl}#${id}`, text, C.link, 'font-weight:bold;text-decoration:underline;white-space:nowrap;')).join(`&nbsp;&nbsp;&nbsp; `);
  return `<table ${TBL}><tr><td style="padding:0;border-bottom:1px solid ${C.navRule};font-size:13px;line-height:38px;color:${C.navLabel};"><strong style="color:${C.navLabel};">웹에서 보기</strong>&nbsp;&nbsp;&nbsp; ${links}</td></tr></table>`;
}

/** 국내·해외 칸 제목: 금색 밑줄, 오른쪽에 건수 */
function columnTitle(title, note) {
  return `<table ${TBL}><tr><td style="padding:0 0 9px;border-bottom:2px solid ${C.gold};"><h3 style="margin:0;font-size:20px;line-height:29px;font-weight:bold;letter-spacing:-0.6px;color:${C.colTitle};">${h(title)} <span style="padding-left:4px;font-size:13px;font-weight:bold;letter-spacing:0;color:${C.count};white-space:nowrap;">${h(note)}</span></h3></td></tr></table>`;
}

/**
 * 기사 한 건: 굵은 제목(→ 원문), 매체·시각, 요약, 점검(금색 표시). 원문 제목은 웹 페이지에만(메일은 간결하게).
 * foreign: 통합 목록의 해외 언론 기사 표시
 */
function story(n, { foreign = false } = {}) {
  const others = n.outlets?.length > 1 ? ` 외 ${n.outlets.length - 1}곳` : '';
  const at = when(n.published);
  const meta = `${n.source || ''}${others}${at ? ` · ${at}` : ''}`;
  const summary = n.summary_ko || truncate(n.snippet || '', 120);
  return `<h4 class="story-title" style="margin:0;font-size:18px;line-height:27px;font-weight:bold;letter-spacing:-0.5px;color:${C.story};">${a(n.url, h(n.title_ko || n.title))}</h4>
${meta ? `<p style="margin:4px 0 0;font-size:13px;line-height:21px;color:${C.meta};">${foreign ? `<strong style="color:${C.count};">해외</strong> · ` : ''}${h(meta)}</p>` : ''}
${summary ? `<p style="margin:8px 0 0;font-size:15px;line-height:25px;letter-spacing:-0.14px;color:${C.summary};">${h(summary)}</p>` : ''}
${n.check_ko ? `<p style="margin:6px 0 0;font-size:14px;line-height:23px;color:${C.check};"><strong style="font-size:13px;color:${C.checkLabel};">점검</strong>&nbsp; ${h(n.check_ko)}</p>` : ''}`;
}

const storyCell = (n, opts) => `<table ${TBL}><tr><td style="padding:16px 0 17px;">${story(n, opts)}</td></tr></table>`;
const emptyNews = (b) => `<p style="margin:14px 0 0;font-size:14px;line-height:22px;color:${C.scope};">${h(emptyNote(b, 'news'))}</p>`;

/** 국내·해외 한 칸: 제목·건수 + 기사(아래 줄) */
function newsColumn(title, list, b) {
  const body = list.length
    ? `<table ${TBL}>${list.map((n) => `<tr><td style="padding:0;border-bottom:1px solid ${C.rule};">${storyCell(n)}</td></tr>`).join('')}</table>`
    : emptyNews(b);
  return `${columnTitle(title, `${list.length}건`)}
${body}`;
}

/**
 * 국내|해외 두 칸(시안대로 표 두 칸 — Outlook 웹·Gmail·국내 웹메일 모두 나란히, 휴대폰은 LAYOUT_CSS 로 위아래).
 * Outlook(Windows) 은 두 칸 사이에서 행을 나눠(<!--[if mso]>) 위아래로 놓고, 칸 폭·여백은 Word 만 보는 태그(td())로 준다.
 */
function newsColumns(dom, intl, b) {
  return `<table ${TBL}><tr>
${td('class="ncol" valign="top" style="width:50%;padding:0 16px 0 0;vertical-align:top;"', 'valign="top" width="100%" style="width:100%;padding:0;vertical-align:top;"')}${newsColumn('국내 뉴스', dom, b)}</td>
<!--[if mso]></tr><tr><![endif]-->
${td('class="ncol2 ncol" valign="top" style="width:50%;padding:0 0 0 16px;vertical-align:top;"', 'valign="top" width="100%" style="width:100%;padding:24px 0 0;vertical-align:top;"')}${newsColumn('해외 뉴스', intl, b)}</td>
</tr></table>`;
}

/** 통합 목록의 기사(중요한 순서 = brief.news.order, 빠진 것은 뒤에) */
function mergedNews(b) {
  const all = [...(b.news?.domestic || []), ...(b.news?.international || [])];
  const byId = new Map(all.map((n) => [n.id, n]));
  const list = (b.news?.order || []).map((id) => byId.get(id)).filter(Boolean);
  for (const n of all) if (!list.includes(n)) list.push(n);
  return list;
}

/**
 * 국내 언론 기사가 많은 날(brief.news.merged): 국내·해외를 중요한 순서 한 목록으로(국내 7 : 해외 3 정도 — src/news.mjs arrangeNews).
 * 넓으면 두 건씩 나란히(중요한 순서가 가로로 이어짐), 해외 언론 기사엔 '해외' 표시. 줄은 바깥 칸에 그어 나란한 두 건의 줄이 맞는다.
 * 휴대폰·Outlook(Windows)은 순서대로 위아래(newsColumns 와 같은 방법).
 */
function newsMerged(list, b) {
  const dom = list.filter((n) => n.region === 'domestic').length;
  const head = columnTitle('국내·해외 통합', `국내 ${dom} · 해외 ${list.length - dom}`);
  if (!list.length) return `${head}${emptyNews(b)}`;
  const line = `border-bottom:1px solid ${C.rule};`;
  const cell = (n, pad) => (n
    ? `${td(`class="ncol" valign="top" style="width:50%;padding:${pad};vertical-align:top;${line}"`, `valign="top" width="100%" style="width:100%;padding:0;vertical-align:top;${line}"`)}${storyCell(n, { foreign: n.region !== 'domestic' })}</td>`
    : `${td(`class="ncol" valign="top" style="width:50%;padding:${pad};"`, 'width="100%" style="width:100%;padding:0;"')}</td>`);
  const rows = [];
  for (let i = 0; i < list.length; i += 2) {
    rows.push(`<tr>
${cell(list[i], '0 16px 0 0')}
<!--[if mso]></tr><tr><![endif]-->
${cell(list[i + 1], '0 0 0 16px')}
</tr>`);
  }
  return `${head}
<table ${TBL}>${rows.join('')}</table>`;
}

/** KISA 보안 업데이트 권고(보호나라): 금색 윗줄, 금색 점과 굵은 제목. 보안공지가 아닌 것(취약점 정보·경보단계)만 작은 표시 */
function kisaList(adv, b) {
  if (!adv.length) return noteRow(h(emptyNote(b, 'kisa')), 12);
  const line = `border-bottom:1px solid ${C.rule};`;
  const rows = adv.map((x) => {
    const kind = String(x.source || '').replace(/^KISA\s*/, '');
    const color = x.alert ? C.hot : C.kisa;
    const tag = kind && kind !== '보안공지' ? ` <span style="font-size:13px;font-weight:bold;color:${x.alert ? C.hot : C.count};">${h(kind)}</span>` : '';
    const day = mmdd(x.date);
    return `<tr><td width="20" valign="top" style="width:20px;padding:10px 0;${line}font-family:Arial,sans-serif;font-size:17px;line-height:25px;color:${C.mark};">•</td><td valign="top" style="padding:10px 0;${line}"><p style="margin:0;font-size:16px;line-height:25px;font-weight:bold;color:${color};">${a(x.url, h(x.title), color)}${tag}${day ? ` <span style="font-size:13px;font-weight:normal;color:${C.meta};">· ${day}</span>` : ''}</p></td></tr>`;
  });
  return `<tr><td style="padding:12px 0 0;"><table ${TBL}><tr><td style="padding:0;border-top:2px solid ${C.gold};"><table ${TBL}>
${rows.join('\n')}
</table></td></tr></table></td></tr>`;
}

/**
 * 취약점 표(시안: 제품 | 주요 영향 | CVSS). 제품 칸 = 제목(→ NVD) + 번호·다른 표시(웹과 같은 순서)·링크, 영향 칸 = 영향 + 조치.
 * 표시는 점수 칸에 넣지 않는다(휴대폰에서 좁은 칸이 넘침). 실제 악용(kev) 표의 셋째 칸은 CISA 조치 기한
 * (새 등재는 CVSS 가 아직 없는 일이 많아 '–' 만 늘어서므로 — 점수는 있으면 번호 줄에).
 */
function riskTable(list, assetHref, { kev = false } = {}) {
  const th = (text, cls, w, align = 'left') => `<th class="rcell ${cls}" width="${w}%" align="${align}" bgcolor="${C.th}" style="width:${w}%;padding:9px 12px;background:${C.th};border-bottom:1px solid ${C.thRule};font-size:13px;line-height:20px;font-weight:bold;color:${C.thText};text-align:${align};">${text}</th>`;
  const link = underline(C.meta);
  const line = `border-bottom:1px solid ${C.rule};`;
  const rows = list.map((v) => {
    const score = v.cvss?.score;
    const last = kev ? mmdd(v.due) || '–' : Number.isFinite(score) ? score.toFixed(1) : '–';
    const ids = v.ids?.length > 1 ? ` 외 ${v.ids.length - 1}건` : '';
    const meta = [
      `<span style="font-family:${MONO};">${h(v.id)}</span>${h(ids)}`,
      ...sortedBadges(v).filter((t) => t !== 'KEV' && !t.startsWith(kev ? '기한' : 'CVSS')).map((t) => h(t)),
      ...(v.links?.[0] ? [link(v.links[0], '벤더 공지')] : []),
      ...(assetHref(v.id) ? [link(assetHref(v.id), '우리 자산 영향')] : []),
    ].join(' · ');
    const impact = v.ko?.impact ? `<p style="margin:0;font-size:15px;line-height:22px;color:${C.impact};">${h(v.ko.impact)}</p>` : '';
    const action = v.ko?.action ? `<p style="margin:${impact ? 6 : 0}px 0 0;font-size:14px;line-height:21px;color:${C.check};"><strong style="font-size:13px;color:${C.checkLabel};">조치</strong>&nbsp; ${h(v.ko.action)}</p>` : '';
    return `<tr>
<td class="rcell" valign="top" style="padding:11px 12px;${line}"><p style="margin:0;font-size:15px;line-height:22px;font-weight:bold;color:${C.product};">${a(v.nvd, h(v.ko?.title || v.id), C.product)}</p><p style="margin:4px 0 0;font-size:12.5px;line-height:19px;color:${C.meta};">${meta}</p></td>
<td class="rcell" valign="top" style="padding:11px 12px;${line}">${impact}${action}</td>
<td class="rcell" valign="top" align="right" style="padding:11px 12px;${line}text-align:right;"><p style="margin:0;font-family:${LATIN};font-size:16px;line-height:22px;font-weight:bold;color:${C.hot};">${last}</p></td>
</tr>`;
  });
  return `<tr><td style="padding:12px 0 0;"><table ${TBL}><tr><td style="padding:0;border-top:2px solid ${C.gold};"><table ${TBL} style="table-layout:fixed;">
<tr>${th('제품', 'rcol-p', 47)}${th('주요 영향', 'rcol-i', 35)}${th(kev ? '조치 기한' : 'CVSS', 'rcol-s', 18, 'right')}</tr>
${rows.join('\n')}
</table></td></tr></table></td></tr>`;
}

/** 글자 메일(SMTP 의 text 부분)에 붙는 같은 내용 */
function keywordNewsText(extra) {
  if (!extra) return '';
  const lines = extra.items.map((n) => `- ${n.title} (${n.outlet}${n.outlets > 1 ? ` 외 ${n.outlets - 1}곳` : ''}) ${n.url}`);
  return `\n\n## ${extra.keyword} 소식\n\n${extra.error || (lines.length ? lines.join('\n') : '새 기사가 없습니다.')}\n`;
}

/** (선택) 메일에만 붙는 '○○ 소식' (src/mail-news.mjs, Secret MAIL_NEWS_KEYWORD): 연한 녹색 상자(왼쪽 막대)에 기사 제목·매체 */
function corpNews(extra) {
  const sub = (html, top) => `<p style="margin:${top}px 0 0;font-size:13px;line-height:20px;color:${C.corpText};">${html}</p>`;
  let inner;
  if (extra.error) inner = sub(h(extra.error), 6);
  else if (!extra.items.length) inner = sub('새 기사가 없습니다.', 6);
  else {
    inner = extra.items
      .map((n, i) => `<p style="margin:${i ? 12 : 6}px 0 0;font-size:16px;line-height:24px;font-weight:bold;letter-spacing:-0.3px;">${a(n.url, h(n.title), C.corpHead)}</p>
${sub(h(`${n.outlet}${n.outlets > 1 ? ` 외 ${n.outlets - 1}곳` : ''} · ${when(n.published)}`), 2)}`)
      .join('\n');
    if (extra.total > extra.items.length) {
      inner += sub(`그 밖의 ${extra.total - extra.items.length}건은 ${underline(C.corpText)(mailNewsSearchUrl(extra.keyword), 'Google 뉴스')}에서 볼 수 있습니다.`, 12);
    }
  }
  return `<tr><td style="padding:26px 0 0;"><table ${TBL} bgcolor="${C.corp}" style="background:${C.corp};"><tr><td style="padding:14px 18px 15px;border-left:3px solid ${C.corpBar};">
<h2 style="margin:0;font-size:14px;line-height:21px;font-weight:bold;color:${C.corpLabel};">${h(extra.keyword)} 소식 <span style="font-size:12.5px;font-weight:normal;">Google 뉴스 · 지난 브리핑 이후</span></h2>
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

/** 웹 페이지와 같은 순서: 뉴스(국내|해외) → KISA → 악용 확인 → 신규 고위험 (그 앞에 건수·우선 점검, 메일에만 관심 회사 소식) */
export function renderEmailHtml(b, { siteUrl = '', title = '일일 보안 브리핑', org = '', extraNews = null, assetUrl = '' } = {}) {
  const assetHref = (id) => assetLink(assetUrl, b.date, id);
  const dayUrl = briefUrl(siteUrl, b.date);
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
  const crTotal = b.critical_total;
  const crKnown = crTotal !== null && crTotal !== undefined;
  const names = mastNames(title, org);

  // 머리: 이름 | 조직 → 큰 제목, 오른쪽에 날짜(년월 / 일·요일 / 생성 시각 / 주말·연휴 뒤면 '지난 브리핑 이후')
  const identity = names.brand
    ? `<p style="margin:0 0 13px;font-size:14px;line-height:25px;color:${C.identity};"><strong class="brand" style="font-family:${LATIN};font-size:21px;line-height:25px;font-weight:bold;letter-spacing:-0.6px;color:${C.navy};white-space:nowrap;">${h(names.brand)}</strong>${names.unit ? ` ${MSO_PAD}${MSO_PAD}<span class="brand-gap" style="margin-left:9px;padding-left:13px;border-left:1px solid ${C.gap};font-size:13px;vertical-align:2px;white-space:nowrap;">${MSO_PAD}${h(names.unit)}</span>` : ''}</p>`
    : '';
  const dateLine = (text, color, extra = '') => `<p class="date-line${extra}" style="margin:0;font-size:13px;line-height:19px;color:${color};">${text}</p>`;
  const mast = `<table ${TBL}><tr>
<td class="mast-copy" valign="middle" style="vertical-align:middle;">${identity}<h1 class="hero" style="margin:0;font-size:45px;line-height:58px;font-weight:bold;letter-spacing:-2.3px;color:${C.hero};">${h(names.heading)}</h1></td>
<td class="date-cell" width="149" align="right" valign="middle" style="width:149px;padding:0;vertical-align:middle;border-left:1px solid ${C.dateRule};text-align:right;">
<p class="date-line" style="margin:0;font-size:13px;line-height:19px;font-weight:bold;color:${C.month};">${y}년 ${m}월</p>
<p class="date-line" style="margin:0;font-size:13px;line-height:20px;font-weight:bold;color:${C.navy};"><span class="serif date-day" style="font-family:${SERIF};font-size:48px;line-height:52px;font-weight:normal;letter-spacing:-2px;color:${C.navy};">${d}</span>일 ${weekdayKo(b.date)}요일</p>
${hhmm ? dateLine(`${h(hhmm)} KST 기준`, C.clock, ' date-clock') : ''}
${since ? dateLine(h(since), C.clock, ' date-clock') : ''}
</td>
</tr></table>`;

  const rows = [];
  if (alert) {
    rows.push(`<tr><td style="padding:22px 0 0;"><table ${TBL}><tr><td bgcolor="${C.alertSoft}" style="background:${C.alertSoft};border-left:4px solid ${C.hotBar};padding:12px 16px;">
<p style="margin:0;font-size:13px;line-height:19px;font-weight:bold;color:${C.hotBar};">사이버위기 경보</p>
<p style="margin:2px 0 0;font-size:16px;line-height:24px;font-weight:bold;">${a(alert.url, h(alert.title))}</p>
<p style="margin:2px 0 0;font-size:13px;line-height:19px;color:${C.meta};">${h(alert.source)} · ${h(alert.date)}</p>
</td></tr></table></td></tr>`);
  }

  // 건수 4칸(시안 순서): 보안 뉴스 · KISA 보안 공지 · 고위험 취약점 · KEV 신규 등재. 새 경보·실제 악용이 있는 날만 숫자를 붉게
  const domN = dom.length;
  const intlN = intl.length;
  rows.push(`<tr><td style="padding:23px 0;">${statsGrid([
    ['보안 뉴스', domN + intlN, `국내 ${domN} · 해외 ${intlN}`, false],
    ['KISA 보안 공지', b.failed?.kisa && !adv.length ? '–' : adv.length, kisaDetail(adv, b), Boolean(alert)],
    ['고위험 취약점', crKnown ? crTotal : '–', crKnown ? `CVSS ${cvssMin} 이상` : '수집 실패', false],
    ['KEV 신규 등재', b.failed?.kev ? '–' : exTotal, b.failed?.kev ? '수집 실패' : '이번 수집 기준', !b.failed?.kev && exTotal > 0],
  ])}</td></tr>`);

  const checks = todayChecks(b);
  if (checks.items.length) rows.push(`<tr><td>${priorityPanel(checks)}</td></tr>`);
  if (dayUrl) rows.push(`<tr><td style="padding:10px 0 0;">${webNav(dayUrl, ex.length > 0)}</td></tr>`);

  // 국내 언론 기사가 많은 날은 국내·해외 통합 목록(국내 7 : 해외 3 정도), 아니면 국내 5 | 해외 5 (src/news.mjs arrangeNews)
  rows.push(sectionTitle('주요 보안 뉴스', '', 27), `<tr><td style="padding:16px 0 0;">${b.news?.merged ? newsMerged(mergedNews(b), b) : newsColumns(dom, intl, b)}</td></tr>`);
  rows.push(sectionTitle('KISA 보안 업데이트 권고', `${adv.length}건`), kisaList(adv, b));

  // 오늘 브리핑의 취약점을 자산 대장과 한 번에 비교(첫 취약점 구역 위에 한 번)
  const assetAll = assetUrl && (ex.length || cr.length)
    ? noteRow(`${a(assetHref(), '우리 자산 영향 한눈에 보기', C.link, 'font-weight:bold;text-decoration:underline;')} — 오늘 브리핑의 취약점을 자산 대장과 비교합니다(사내망에서 열림)`, 6)
    : '';
  if (ex.length) {
    rows.push(sectionTitle('실제 악용 확인 취약점', `CISA KEV 신규 ${exTotal}건`, 29));
    if (assetAll) rows.push(assetAll);
    rows.push(riskTable(ex, assetHref, { kev: true }));
    if (b.exploited_more?.length) rows.push(noteRow(`그 밖의 신규 등재 ${b.exploited_more.length}건: ${h(b.exploited_more.map((v) => v.id).join(', '))}`));
  }

  rows.push(sectionTitle('신규 고위험 취약점', crKnown ? '' : '수집 실패', 29));
  if (cr.length && crKnown) {
    const more = b.critical_more?.length || 0;
    const web = dayUrl ? underline(C.link)(`${dayUrl}#critical`, '웹 페이지') : '웹 페이지';
    rows.push(noteRow(`CVSS ${cvssMin} 이상 <strong style="color:${C.ink};">${h(crTotal)}건 중 주요 ${cr.length}묶음</strong>${more ? ` · 나머지 ${more}묶음은 ${web}에서 볼 수 있습니다.` : ''}`, 5));
  }
  if (!ex.length && assetAll) rows.push(assetAll);
  rows.push(cr.length ? riskTable(cr, assetHref) : noteRow(h(emptyNote(b, 'critical')), 6));
  if (extraNews) rows.push(corpNews(extraNews));

  // 꼬리: 이름 | 링크 → 생성·수집 상태 → (KEV 수집 실패) → 표시 풀이
  const ok = (b.sources || []).filter((s) => s.ok).length;
  const small = (text, top = 4) => `<p style="margin:${top}px 0 0;font-size:12px;line-height:19px;color:${C.foot};">${text}</p>`;
  const footLink = (url, text) => a(url, text, C.link, 'font-weight:bold;text-decoration:underline;');
  const links = [dayUrl ? footLink(dayUrl, '전체 브리핑 보기') : '', siteUrl ? footLink(`${siteUrl}/archive.html`, '지난 브리핑') : ''].filter(Boolean).join(' &nbsp;·&nbsp; ');
  const footName = names.brand
    ? `<strong style="color:${C.foot};">${h(names.brand)}</strong>${names.unit ? ` <span style="padding-left:6px;">${MSO_PAD}${h(names.unit)}</span>` : ''}`
    : `<strong style="color:${C.foot};">${h(title)}</strong>`;
  const foot = [
    `<table ${TBL}><tr>
<td valign="top" style="font-size:13px;line-height:20px;color:${C.foot};">${footName}</td>
${links ? `<td class="foot-links" align="right" valign="top" style="text-align:right;font-size:13px;line-height:20px;">${links}</td>` : ''}
</tr></table>`,
    small(`${b.date.replaceAll('-', '.')} ${h(hhmm)} KST 생성 · 수집 ${ok}/${(b.sources || []).length}곳 정상 · 자동 발송`, 8),
    b.failed?.kev ? small('CISA KEV 수집 실패 — 실제 악용 취약점은 웹 페이지에서 확인하세요') : '',
    ex.length || cr.length ? small('KEV: 미국 사이버보안청(CISA)이 실제 공격에 쓰인 것을 확인한 취약점 · CVSS: 심각도 점수(10점 만점) · EPSS: 30일 안에 공격에 쓰일 확률(추정)') : '',
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
<table ${TBL} bgcolor="${C.page}" style="background:${C.page};"><tr><td class="outer" align="center" style="padding:28px 12px;">
<!--[if mso]><table role="presentation" width="${MSO_W}" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<!--[if !mso]><!--><div style="max-width:${MAIL_W}px;margin:0 auto;"><!--<![endif]-->
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${C.paper}" style="width:100%;background:${C.paper};font-family:${FONT};color:${C.navy};word-break:keep-all;overflow-wrap:anywhere;">
<tr><td class="pad mast" bgcolor="${C.mast}" style="background:${C.mast};border-top:5px solid ${C.navy};padding:27px ${PAD}px 29px;">
${mast}
</td></tr>
<tr><td class="pad" style="padding:0 ${PAD}px 34px;">
<table ${TBL}>
${rows.join('\n')}
</table>
</td></tr>
<tr><td class="pad" bgcolor="${C.mast}" style="background:${C.mast};border-top:1px solid ${C.footRule};padding:16px ${PAD}px 18px;">
${foot}
</td></tr>
</table>
<!--[if !mso]><!--></div><!--<![endif]-->
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

/**
 * (선택) Secret MAIL_ORG: 메일 머리·꼬리에 쓰는 '회사 · 조직' 이름(예: '○○ · ○○센터' → '○○ ○○팀 | ○○센터', mastNames).
 * 저장소·웹·카카오에는 남기지 않는다.
 */
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

/** SMTP(Gmail 등)로 보내고, 막히면(로그인·연결 오류 등) Outlook 예비로 — 그날 메일이 끊기지 않게 한다. */
async function sendSmtpOrBackup(path, s, msg, { env, log, transportOverride }) {
  try {
    return await sendViaSmtp(s, msg, { transportOverride });
  } catch (err) {
    if (!s.outlook) throw err;
    log(`SMTP 로 보내지 못해 예비(Outlook)로 보냅니다: ${publicError(err)}`);
    try {
      return { ...(await sendViaOutlook(path, { kind: 'outlook', to: s.to }, msg, { env, log })), fallback: err.message };
    } catch (backupErr) {
      throw new Error(`${err.message} / 예비(Outlook)도 실패: ${backupErr.message}`);
    }
  }
}

/**
 * 브리핑 메일 발송. 같은 날짜는 한 번만 보낸다(--force 로 다시).
 * 받는 사람이 여럿이면 서로의 주소가 보이지 않게 숨은 참조로 보낸다.
 * SMTP 가 실패하면 Outlook 예비로 보낸다(fallback 에 SMTP 실패 이유). 예비가 없거나 예비도 실패하면 오류.
 * @returns {Promise<{sent:boolean, skipped?:boolean, reason?:string, via?:string, accepted?:number, rejected?:number, fallback?:string}>}
 */
export async function sendBriefMail(cfg, brief, { test = false, force = false, env = process.env, transportOverride, feedOverride, log = console.log } = {}) {
  const s = mailSettings(env);
  if (!s) return { sent: false, skipped: true, reason: '메일 설정이 없어 건너뜁니다 (SMTP_HOST·MAIL_TO 또는 OUTLOOK_CLIENT_ID·OUTLOOK_REFRESH_TOKEN).' };
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
  const r = s.kind === 'outlook' ? await sendViaOutlook(path, s, msg, { env, log }) : await sendSmtpOrBackup(path, s, msg, { env, log, transportOverride });
  if (!test && brief) {
    // 공개 저장소에 남으므로 주소는 적지 않는다(건수만). Outlook 토큰 상태는 그대로 둔다.
    const next = { ...loadMailState(path), version: 1, last_sent: brief.date, last_sent_at: kstIso(), recipients: r.accepted };
    writeAtomic(path, `${JSON.stringify(next, null, 2)}\n`);
  }
  return { sent: true, ...r };
}
