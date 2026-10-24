#!/usr/bin/env node
// 사이버 보안 일일 브리핑
//
//   node src/cli.mjs run            수집 → 이력 저장 → 웹 페이지 생성 → 카카오톡·메일 발송
//   node src/cli.mjs collect        수집하고 data/briefs 에 저장만 (--force: 오늘 것을 다시 만들기)
//   node src/cli.mjs build          data/briefs → _site/ 웹 페이지
//   node src/cli.mjs send           오늘(또는 --date) 브리핑을 카카오톡·메일로 (--test: 연결 확인, --only kakao|mail)
//   node src/cli.mjs preview        카카오톡으로 보낼 메시지를 화면에만 출력 (--mail: 메일 HTML 을 파일로)
//   node src/cli.mjs kakao-login    처음 한 번: 카카오 로그인으로 리프레시 토큰 받기
//   node src/cli.mjs import <폴더>  이전 도구의 브리핑 파일(daily-brief-*.md)을 웹 이력으로 옮기기
//   node src/cli.mjs serve          _site/ 를 http://localhost:8080 으로 열람
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { buildKakaoTemplate } from './brief.mjs';
import { collectBrief } from './collect.mjs';
import { loadConfig } from './config.mjs';
import { kakaoConfigured, kakaoLogin, sendBrief } from './kakao.mjs';
import { importLegacy } from './legacy.mjs';
import { mailConfigured, mailSubject, renderEmailHtml, sendBriefMail } from './mail.mjs';
import { buildSite } from './site.mjs';
import { listBriefDates, loadBrief, writeAtomic } from './store.mjs';
import { isYmd, kstDate, msUntilKst } from './util.mjs';

const HELP = readFileSync(new URL(import.meta.url), 'utf8')
  .split(/\r?\n/)
  .slice(1)
  .filter((l, i, all) => all.slice(0, i + 1).every((x) => x.startsWith('//')))
  .map((l) => l.replace(/^\/\/ ?/, ''))
  .join('\n');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) args[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--') && ['date', 'port', 'template', 'only'].includes(k)) args[k] = argv[++i];
      else args[k] = true;
    } else args._.push(a);
  }
  return args;
}

const inActions = process.env.GITHUB_ACTIONS === 'true';
function notice(msg) {
  console.log(inActions ? `::notice::${msg}` : msg);
}
function warn(msg) {
  console.log(inActions ? `::warning::${msg}` : `경고: ${msg}`);
}
function fail(msg) {
  console.error(inActions ? `::error::${msg}` : `오류: ${msg}`);
  process.exitCode = 1;
}

function pickBrief(cfg, date) {
  if (date) {
    if (!isYmd(date)) throw new Error(`날짜 형식은 YYYY-MM-DD 입니다: ${date}`);
    const b = loadBrief(cfg.dataDir, date);
    if (!b) throw new Error(`${date} 브리핑이 없습니다.`);
    return b;
  }
  const today = kstDate();
  const b = loadBrief(cfg.dataDir, today);
  if (b) return b;
  const dates = listBriefDates(cfg.dataDir);
  if (!dates.length) throw new Error('저장된 브리핑이 없습니다. 먼저 collect 를 실행하세요.');
  return loadBrief(cfg.dataDir, dates[dates.length - 1]);
}

async function cmdCollect(cfg, args) {
  const opts = { force: Boolean(args.force) };
  if (args.date) {
    if (!isYmd(args.date)) throw new Error(`날짜 형식은 YYYY-MM-DD 입니다: ${args.date}`);
    opts.date = args.date;
  }
  const { brief, skipped } = await collectBrief(cfg, opts);
  if (skipped && inActions) {
    notice(
      process.env.GITHUB_EVENT_NAME === 'schedule'
        ? `앞선 예약 실행이 ${brief.date} 브리핑을 이미 만들어, 이번 재시도는 수집을 건너뜁니다.`
        : `${brief.date} 브리핑이 이미 있어 새로 만들지 않았습니다. 다시 만들려면 Run workflow 에서 '오늘 브리핑이 이미 있어도 다시 만들기'를 체크하세요.`,
    );
  }
  if (!skipped) {
    const bad = brief.sources.filter((s) => !s.ok);
    console.log(
      `저장: data/briefs/${brief.date.slice(0, 4)}/${brief.date}.json: 악용 ${brief.exploited.length} · 고위험 ${brief.critical.length}묶음(전체 ${brief.critical_total}) · KISA ${brief.advisories.length} · 뉴스 ${brief.news.domestic.length + brief.news.international.length} · 요약 ${brief.engine}`,
    );
    for (const s of bad) warn(`수집 실패: ${s.name}: ${s.error}`);
    if (brief.summarizer?.error) warn(`Claude 요약 실패(규칙 기반으로 대체): ${brief.summarizer.error}`);
  }
  if (inActions && process.env.GITHUB_OUTPUT) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_OUTPUT, `date=${brief.date}\n`);
  }
  return brief;
}

/**
 * 카카오톡·메일 발송. 설정된 수단마다 따로 보내고(하나가 실패해도 다른 하나는 보냄), 실패가 있으면 종료 코드 1.
 * --scheduled: 예약 실행 — delivery.not_before(KST) 전이면 그때까지 기다렸다 보낸다.
 */
async function cmdSend(cfg, args, brief) {
  const only = typeof args.only === 'string' ? args.only : '';
  if (only && !['kakao', 'mail'].includes(only)) throw new Error('--only 는 kakao 또는 mail 입니다.');
  const channels = [
    { key: 'kakao', name: '카카오톡', on: kakaoConfigured(), hint: 'KAKAO_REST_API_KEY·KAKAO_REFRESH_TOKEN' },
    { key: 'mail', name: '메일', on: mailConfigured(), hint: 'SMTP_HOST·SMTP_USER·SMTP_PASS·MAIL_TO' },
  ].filter((c) => !only || c.key === only);
  for (const c of channels.filter((x) => !x.on)) notice(`${c.name} 설정이 없어 건너뜁니다 (${c.hint}, README 참고).`);
  const active = channels.filter((c) => c.on);
  if (!active.length) return;
  const b = args.test ? null : brief || pickBrief(cfg, args.date);

  const notBefore = cfg.delivery?.not_before;
  if (args.scheduled && notBefore && !args.test) {
    let ms = 0;
    try {
      ms = msUntilKst(notBefore);
    } catch (err) {
      warn(`config.json 의 delivery.not_before 값이 잘못돼 기다리지 않고 보냅니다: ${err.message}`);
    }
    if (ms > 0) {
      console.log(`발송 시각(${notBefore} KST)까지 ${Math.ceil(ms / 60000)}분 기다립니다.`);
      await sleep(Math.min(ms, 3 * 3600 * 1000));
    }
  }

  const opts = { test: Boolean(args.test), force: Boolean(args.force) };
  const what = b ? b.date : '연결 확인';
  for (const c of active) {
    try {
      if (c.key === 'kakao') {
        const r = await sendBrief(cfg, b, opts);
        if (r.skipped) notice(r.reason);
        else {
          console.log(`카카오톡 발송 완료 (${r.template}${r.rotated ? ', 리프레시 토큰 갱신됨' : ''}): ${what}`);
          if (!cfg.site.url) warn('site.url(또는 SITE_URL)이 비어 있어 카카오 메시지에 웹 이력 버튼이 없습니다.');
        }
      } else {
        const r = await sendBriefMail(cfg, b, opts);
        if (r.skipped) notice(r.reason);
        else console.log(`메일 발송 완료 (받는 사람 ${r.accepted}명${r.rejected ? `, 거부 ${r.rejected}명` : ''}): ${what}`);
      }
    } catch (err) {
      fail(`${c.name} 발송 실패: ${err?.message || err}`);
    }
  }
}

function cmdPreview(cfg, args) {
  const b = pickBrief(cfg, args.date);
  if (args.mail) {
    const out = join(cfg.siteDir, 'mail-preview.html');
    writeAtomic(out, renderEmailHtml(b, { siteUrl: cfg.site.url, title: cfg.site.title }));
    console.log(`제목: ${mailSubject(b, cfg.site.title)}\n본문: ${out}`);
    return;
  }
  const tpl = buildKakaoTemplate(b, { siteUrl: cfg.site.url, template: args.template || cfg.kakao.template });
  console.log(JSON.stringify(tpl, null, 2));
}

async function cmdLogin(cfg, args) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const r = await kakaoLogin(cfg, { port: Number(args.port) || 8765, ask: (q) => rl.question(q), open: !args['no-browser'] });
    const days = r.refreshExpiresIn ? Math.round(r.refreshExpiresIn / 86400) : '?';
    console.log('');
    console.log(`로그인 성공 (동의 범위: ${r.scopes || '확인 불가'}${r.sent ? ', 나와의 채팅으로 확인 메시지를 보냈습니다' : ''})`);
    if (!/talk_message/.test(r.scopes)) warn('동의 범위에 talk_message 가 없습니다. [카카오 로그인] > [동의항목] 에서 카카오톡 메시지 전송을 설정한 뒤 다시 로그인하세요.');
    console.log('');
    console.log(`GitHub 저장소 > Settings > Secrets and variables > Actions 에 아래 값을 넣으세요 (리프레시 토큰 유효기간 약 ${days}일, 이후에는 자동 갱신).`);
    console.log(`  KAKAO_REST_API_KEY   ${r.clientId}`);
    console.log(`  KAKAO_CLIENT_SECRET  ${r.clientSecret ? '(입력한 클라이언트 시크릿)' : '(사용 안 함, 넣지 않아도 됨)'}`);
    console.log(`  KAKAO_REFRESH_TOKEN  ${r.refreshToken}`);
    console.log('');
    console.log('이 토큰은 비밀번호처럼 다루세요. 화면 기록을 공유하지 마세요.');
    if (args.save) {
      const { appendFileSync } = await import('node:fs');
      appendFileSync(join(cfg.root, '.env'), `\nKAKAO_REST_API_KEY=${r.clientId}\n${r.clientSecret ? `KAKAO_CLIENT_SECRET=${r.clientSecret}\n` : ''}KAKAO_REFRESH_TOKEN=${r.refreshToken}\n`);
      console.log('.env 에도 저장했습니다(로컬 실행용, 저장소에는 올라가지 않음).');
    }
  } finally {
    rl.close();
  }
}

function cmdImport(cfg, args) {
  const folder = args._[1];
  if (!folder) throw new Error('옮길 폴더를 주세요: node src/cli.mjs import <폴더>');
  if (!existsSync(folder) || !statSync(folder).isDirectory()) throw new Error(`폴더가 없습니다: ${folder}`);
  const r = importLegacy(cfg, folder, { overwrite: Boolean(args.overwrite) });
  console.log(`옮김 ${r.imported.length}건, 건너뜀 ${r.skipped.length}건`);
  for (const s of r.skipped) console.log(`  건너뜀 ${s}`);
  if (r.imported.length) console.log('웹 페이지에 반영하려면 build 를 실행하세요.');
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.xml': 'application/xml; charset=utf-8' };

function cmdServe(cfg, args) {
  const root = resolve(cfg.siteDir);
  if (!existsSync(join(root, 'index.html'))) throw new Error('_site/index.html 이 없습니다. 먼저 build 를 실행하세요.');
  const port = Number(args.port) || 8080;
  createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = normalize(join(root, p));
    if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { 'content-type': TYPES['.html'] }).end(existsSync(join(root, '404.html')) ? readFileSync(join(root, '404.html')) : 'not found');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }).end(readFileSync(file));
  }).listen(port, '127.0.0.1', () => console.log(`http://localhost:${port}/ (끝내려면 Ctrl+C)`));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0] || 'run';
  if (cmd === 'help' || args.help) {
    console.log(HELP);
    return;
  }
  const cfg = loadConfig();
  switch (cmd) {
    case 'collect':
      await cmdCollect(cfg, args);
      break;
    case 'build':
      buildSite(cfg);
      break;
    case 'send':
      await cmdSend(cfg, args);
      break;
    case 'preview':
      cmdPreview(cfg, args);
      break;
    case 'kakao-login':
      await cmdLogin(cfg, args);
      break;
    case 'import':
      cmdImport(cfg, args);
      break;
    case 'serve':
      cmdServe(cfg, args);
      break;
    case 'run': {
      const brief = await cmdCollect(cfg, args);
      buildSite(cfg);
      await cmdSend(cfg, args, brief);
      break;
    }
    default:
      console.log(HELP);
      process.exitCode = 2;
  }
}

main().catch((err) => fail(err?.message || String(err)));
