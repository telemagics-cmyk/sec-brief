// 메일 발송(선택): 브리핑을 HTML 메일로 보낸다. 보내는 길은 둘 중 하나(둘 다 있으면 Outlook).
//   Outlook.com(개인 Microsoft 계정): OUTLOOK_CLIENT_ID, OUTLOOK_REFRESH_TOKEN — Graph 메일 API (outlook.mjs)
//   SMTP(Gmail 앱 비밀번호 등)     : SMTP_HOST, SMTP_PORT(기본 465), SMTP_USER, SMTP_PASS, MAIL_FROM(선택)
//   받는 주소: MAIL_TO(쉼표로 여러 개). Outlook 은 비우면 보내는 계정 자신에게.
// 공개 저장소이므로 주소·계정·토큰은 저장소가 아니라 비밀값(환경 변수)으로만 받고, Actions 기록에서는 가린다.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { alertOf, briefUrl, emptyNote, renderMarkdown, vulnBadges } from './brief.mjs';
import { secret } from './config.mjs';
import { getAccount, mask, obtainAccessToken, outlookConfigured, sendGraphMail } from './outlook.mjs';
import { writeAtomic } from './store.mjs';
import { escapeHtml as h, kstIso, safeUrl, shortDay, truncate, weekdayKo } from './util.mjs';

const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

/** 비밀값에서 메일 설정을 읽는다. 보낼 길(Outlook, 또는 SMTP+받는 주소)이 없으면 null(메일 끔). */
export function mailSettings(env = process.env) {
  const to = secret('MAIL_TO', env).split(/[,;\s]+/).filter(Boolean);
  const bad = to.filter((a) => !EMAIL_RE.test(a));
  if (bad.length) throw new Error(`MAIL_TO 에 메일 주소가 아닌 값이 있습니다(${bad.length}개). 쉼표로 구분해 넣으세요.`);
  if (outlookConfigured(env)) return { kind: 'outlook', to };
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

function countsLine(b) {
  const ex = (b.exploited?.length || 0) + (b.exploited_more?.length || 0);
  return [
    `국내 ${b.news?.domestic?.length || 0}`,
    `해외 ${b.news?.international?.length || 0}`,
    `KISA ${b.advisories?.length || 0}`,
    ex ? `악용 ${ex}` : '',
    b.critical_total ? `고위험 ${b.critical_total}` : '',
  ]
    .filter(Boolean)
    .join('·');
}

export function mailSubject(b, title = '일일 보안 브리핑') {
  return `${alertOf(b) ? '[경보] ' : ''}[${title}] ${shortDay(b.date)} | ${countsLine(b)}`;
}

// ------------------------------------------------------------------ HTML 본문 (메일 프로그램용: 인라인 스타일만)

const C = {
  ink: '#111827', ink2: '#1f2937', muted: '#5b6573', faint: '#7b8593', rule: '#e1e5ea', bg: '#f3f4f6',
  accent: '#0b6b88', accentSoft: '#e2f0f4', hot: '#b42318', warn: '#8f5400', warnSoft: '#fff3db',
};

function a(url, text, style = '') {
  const href = safeUrl(url);
  return href ? `<a href="${h(href)}" style="color:${C.accent};${style}">${text}</a>` : text;
}

function sectionTitle(text, sub = '') {
  return `<h2 style="margin:26px 0 10px;padding-top:16px;border-top:1px solid ${C.rule};font-size:17px;color:${C.ink};">${h(text)}${sub ? ` <span style="font-size:12.5px;font-weight:normal;color:${C.muted};">${h(sub)}</span>` : ''}</h2>`;
}

function newsList(list, b) {
  if (!list.length) return `<p style="margin:0;color:${C.muted};font-size:14px;">${h(emptyNote(b, 'news'))}</p>`;
  return `<ol style="margin:0;padding-left:20px;">${list
    .map((n) => {
      const others = n.outlets.length > 1 ? ` 외 ${n.outlets.length - 1}곳` : '';
      const orig = n.title_ko && n.title_ko !== n.title ? `<div style="font-size:12.5px;color:${C.faint};">${h(n.title)}</div>` : '';
      const sum = n.summary_ko || truncate(n.snippet || '', 120);
      return `<li style="margin:0 0 12px;">
<div style="font-size:15px;font-weight:bold;line-height:1.45;">${a(n.url, h(n.title_ko || n.title), `color:${C.ink};text-decoration:none;`)}</div>
${orig}<div style="font-size:12.5px;color:${C.faint};">${h(n.source)}${h(others)}</div>
${sum ? `<div style="font-size:14px;color:${C.ink2};margin-top:2px;">${h(sum)}</div>` : ''}
</li>`;
    })
    .join('')}</ol>`;
}

function vulnItem(v, color) {
  const ids = v.ids && v.ids.length > 1 ? ` 외 ${v.ids.length - 1}건` : '';
  const links = [...(v.links || []).slice(0, 1).map((u) => a(u, '벤더 공지')), a(v.nvd, 'NVD')].join(' · ');
  const row = (k, val) => `<tr><td style="padding:1px 8px 1px 0;color:${C.muted};font-size:13px;white-space:nowrap;vertical-align:top;">${k}</td><td style="padding:1px 0;font-size:14px;">${h(val || '-')}</td></tr>`;
  return `<div style="margin:0 0 12px;padding:10px 12px;border:1px solid ${C.rule};border-left:4px solid ${color};border-radius:6px;">
<div style="font-family:Consolas,monospace;font-size:12.5px;color:${C.ink2};">${h(v.id)}${h(ids)} <span style="font-family:inherit;color:${C.muted};">· ${h(vulnBadges(v).join(' · '))}</span></div>
<div style="font-size:15px;font-weight:bold;margin:4px 0 6px;">${h(v.ko?.title || v.id)}</div>
<table role="presentation" style="border-collapse:collapse;">${row('대상', v.ko?.target)}${row('영향', v.ko?.impact)}${row('조치', v.ko?.action)}</table>
<div style="font-size:13px;margin-top:6px;">${links}</div>
</div>`;
}

/** 웹 페이지와 같은 순서: 국내 뉴스 → 해외 뉴스 → KISA 공지 → 악용 확인 → 신규 고위험 */
export function renderEmailHtml(b, { siteUrl = '', title = '일일 보안 브리핑' } = {}) {
  const dayUrl = briefUrl(siteUrl, b.date);
  const anchor = (id) => (dayUrl ? `${dayUrl}#${id}` : '');
  const ex = b.exploited || [];
  const cr = b.critical || [];
  const adv = b.advisories || [];
  const alert = alertOf(b);
  const exTotal = ex.length + (b.exploited_more?.length || 0);
  const date = `${Number(b.date.slice(0, 4))}년 ${Number(b.date.slice(5, 7))}월 ${Number(b.date.slice(8, 10))}일 (${weekdayKo(b.date)})`;
  const tiles = [
    ['news-domestic', b.news?.domestic?.length || 0, '국내 뉴스', C.ink],
    ['news-international', b.news?.international?.length || 0, '해외 뉴스', C.ink],
    ['kisa', adv.length, 'KISA 공지', alert ? C.warn : C.ink],
    ['exploited', b.failed?.kev ? '–' : exTotal, '악용 확인', exTotal ? C.hot : C.ink],
    ['critical', b.critical_total ?? '–', `고위험 ${Number(b.cvss_min ?? 9).toFixed(1)}+`, C.ink],
  ];
  const tileCells = tiles
    .map(([id, n, label, color]) => `<td style="width:20%;padding:3px;"><div style="background:${C.bg};border:1px solid ${C.rule};border-radius:6px;padding:8px 2px;text-align:center;">
${a(anchor(id), `<span style="display:block;font-size:20px;font-weight:bold;color:${color};">${h(n)}</span><span style="display:block;font-size:11.5px;color:${C.muted};">${h(label)}</span>`, 'text-decoration:none;')}</div></td>`)
    .join('');
  const parts = [];
  parts.push(`<p style="margin:0;font-size:12px;letter-spacing:.12em;color:${C.accent};font-weight:bold;">${h(title)}</p>
<h1 style="margin:4px 0 2px;font-size:22px;color:${C.ink};">${date}</h1>
<p style="margin:0;font-size:13px;color:${C.muted};">${h(b.generated_at?.slice(11, 16) || '')} KST 생성${dayUrl ? ` · ${a(dayUrl, '웹에서 보기')}` : ''}</p>
<table role="presentation" style="width:100%;border-collapse:collapse;margin-top:12px;"><tr>${tileCells}</tr></table>`);
  if (alert) {
    parts.push(`<div style="margin-top:14px;padding:10px 12px;background:${C.warnSoft};border:1px solid ${C.warn};border-radius:6px;font-size:14px;"><b style="color:${C.warn};">경보</b> ${a(alert.url, h(alert.title), `color:${C.ink};font-weight:bold;`)} <span style="color:${C.faint};font-size:12.5px;">${h(alert.source)} · ${h(alert.date)}</span></div>`);
  }
  if (b.overview) parts.push(`<div style="margin-top:14px;padding:12px 14px;background:${C.accentSoft};border-radius:6px;font-size:14.5px;">${h(b.overview)}</div>`);

  parts.push(sectionTitle('국내 보안 뉴스'), newsList(b.news?.domestic || [], b));
  parts.push(sectionTitle('해외 보안 뉴스'), newsList(b.news?.international || [], b));

  parts.push(sectionTitle('KISA 공지', '보호나라·KrCERT'));
  parts.push(adv.length
    ? `<ul style="margin:0;padding-left:20px;">${adv.map((x) => `<li style="margin:0 0 6px;font-size:14px;">${a(x.url, h(x.title), x.alert ? `color:${C.warn};font-weight:bold;` : '')} <span style="color:${C.faint};font-size:12.5px;">${h(x.source)} · ${h(x.date)}</span></li>`).join('')}</ul>`
    : `<p style="margin:0;color:${C.muted};font-size:14px;">${h(emptyNote(b, 'kisa'))}</p>`);

  parts.push(sectionTitle('악용 확인 취약점', `CISA KEV 신규 ${b.failed?.kev ? '— 수집 실패' : `${exTotal}건`}`));
  parts.push(ex.length ? ex.map((v) => vulnItem(v, C.hot)).join('') : `<p style="margin:0;color:${C.muted};font-size:14px;">${h(emptyNote(b, 'exploited'))}</p>`);
  if (b.exploited_more?.length) parts.push(`<p style="font-size:13px;color:${C.muted};">그 밖의 신규 등재 ${b.exploited_more.length}건: ${h(b.exploited_more.map((v) => v.id).join(', '))}</p>`);

  const crSub = b.critical_total === null || b.critical_total === undefined ? '— 수집 실패' : `CVSS ${Number(b.cvss_min ?? 9).toFixed(1)} 이상 ${b.critical_total}건 중 주요 ${cr.length}묶음`;
  parts.push(sectionTitle('신규 고위험 취약점', crSub));
  parts.push(cr.length ? cr.map((g) => vulnItem(g, C.warn)).join('') : `<p style="margin:0;color:${C.muted};font-size:14px;">${h(emptyNote(b, 'critical'))}</p>`);
  if (b.critical_more?.length) parts.push(`<p style="font-size:13px;color:${C.muted};">그 밖의 고위험 ${b.critical_more.length}묶음은 ${dayUrl ? a(anchor('critical'), '웹 페이지') : '웹 페이지'}에서 볼 수 있습니다.</p>`);

  const ok = (b.sources || []).filter((s) => s.ok).length;
  parts.push(`<p style="margin:24px 0 0;padding-top:12px;border-top:1px solid ${C.rule};font-size:12.5px;color:${C.faint};">수집 ${ok}/${(b.sources || []).length}곳 정상${siteUrl ? ` · ${a(`${siteUrl}/archive.html`, '지난 브리핑')}` : ''} · 매일 아침 자동 발송</p>`);

  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${h(mailSubject(b, title))}</title></head>
<body style="margin:0;padding:0;background:${C.bg};">
<div style="max-width:680px;margin:0 auto;padding:12px;font-family:'Malgun Gothic','Apple SD Gothic Neo','Noto Sans KR',sans-serif;color:${C.ink};line-height:1.6;word-break:keep-all;overflow-wrap:anywhere;">
<div style="background:#ffffff;border:1px solid ${C.rule};border-radius:10px;padding:18px 16px;">
${parts.join('\n')}
</div></div></body></html>
`;
}

export function testMail(cfg) {
  const url = cfg.site.url ? `${cfg.site.url}/` : '';
  const text = `[${cfg.site.title}] 메일 연결 확인입니다. 이 메일이 보이면 메일 발송 설정이 끝났습니다.${url ? `\n웹 이력: ${url}` : ''}`;
  return {
    subject: `[${cfg.site.title}] 메일 연결 확인`,
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

/**
 * 브리핑 메일 발송. 같은 날짜는 한 번만 보낸다(--force 로 다시).
 * 받는 사람이 여럿이면 서로의 주소가 보이지 않게 숨은 참조로 보낸다.
 * @returns {Promise<{sent:boolean, skipped?:boolean, reason?:string, via?:string, accepted?:number, rejected?:number}>}
 */
export async function sendBriefMail(cfg, brief, { test = false, force = false, env = process.env, transportOverride, log = console.log } = {}) {
  const s = mailSettings(env);
  if (!s) return { sent: false, skipped: true, reason: '메일 설정이 없어 건너뜁니다 (OUTLOOK_CLIENT_ID·OUTLOOK_REFRESH_TOKEN 또는 SMTP_HOST·MAIL_TO).' };
  const path = mailStatePath(cfg);
  if (!test && !force && brief && loadMailState(path).last_sent === brief.date) {
    return { sent: false, skipped: true, reason: `${brief.date} 브리핑 메일은 이미 보냈습니다 (다시 보내려면 --force).` };
  }
  // 공개 저장소의 Actions 기록에 주소가 찍히지 않게(오류 문구 포함)
  for (const addr of s.to) mask(addr, env);
  const msg = test || !brief
    ? testMail(cfg)
    : {
        subject: mailSubject(brief, cfg.site.title),
        html: renderEmailHtml(brief, { siteUrl: cfg.site.url, title: cfg.site.title }),
        text: renderMarkdown(brief, { siteUrl: cfg.site.url }),
      };
  const r = s.kind === 'outlook' ? await sendViaOutlook(path, s, msg, { env, log }) : await sendViaSmtp(s, msg, { transportOverride });
  if (!test && brief) {
    // 공개 저장소에 남으므로 주소는 적지 않는다(건수만). Outlook 토큰 상태는 그대로 둔다.
    const next = { ...loadMailState(path), version: 1, last_sent: brief.date, last_sent_at: kstIso(), recipients: r.accepted };
    writeAtomic(path, `${JSON.stringify(next, null, 2)}\n`);
  }
  return { sent: true, ...r };
}
