import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DEFAULTS, deepMerge, loadConfig, loadDotEnv, ROOT } from '../src/config.mjs';

function keysOf(obj, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith('_')) continue;
    out.push(prefix + k);
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...keysOf(v, `${prefix}${k}.`));
  }
  return out;
}

test('config.json 의 항목은 모두 코드가 아는 항목이다(오타 방지)', () => {
  const user = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8'));
  const known = new Set(keysOf(DEFAULTS));
  for (const k of keysOf(user)) assert.ok(known.has(k), `모르는 설정: ${k}`);
});

test('설정 합치기와 .env', () => {
  const merged = deepMerge(DEFAULTS, { vulns: { cvss_min: 9.5 }, _설명: 'x' });
  assert.equal(merged.vulns.cvss_min, 9.5);
  assert.equal(merged.vulns.kev_days, DEFAULTS.vulns.kev_days);
  assert.equal(merged._설명, undefined);
  const dir = mkdtempSync(join(tmpdir(), 'sb-cfg-'));
  writeFileSync(join(dir, '.env'), '# 주석\nA_KEY="quoted value"\nB_KEY=plain\n');
  const env = { B_KEY: 'already' };
  loadDotEnv(join(dir, '.env'), env);
  assert.equal(env.A_KEY, 'quoted value');
  assert.equal(env.B_KEY, 'already', '이미 있는 환경 변수는 덮지 않는다');
  writeFileSync(join(dir, 'config.json'), '{"site": {"title": "우리 기관 브리핑"}}');
  const cfg = loadConfig({ root: dir, env: { SITE_URL: 'https://x.github.io/repo/' } });
  assert.equal(cfg.site.title, '우리 기관 브리핑');
  assert.equal(cfg.site.url, 'https://x.github.io/repo');
  rmSync(dir, { recursive: true, force: true });
});

test('워크플로: 액션은 커밋 해시로 고정, run 안에 ${{ }} 직접 삽입 없음, 권한 최소화', () => {
  for (const name of ['daily-brief.yml', 'site.yml', 'test.yml']) {
    const yml = readFileSync(join(ROOT, '.github', 'workflows', name), 'utf8');
    const uses = [...yml.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
    assert.ok(uses.length >= 2, name);
    for (const u of uses) assert.match(u, /@[0-9a-f]{40}$/, `${name}: 해시로 고정되지 않음: ${u}`);
    // run: 블록 안에 ${{ 가 있으면 스크립트 주입 위험 → env 로만 넘긴다
    const runBlocks = [...yml.matchAll(/run: \|\n((?: {10}.*\n)+)/g)].map((m) => m[1]);
    const runLines = [...yml.matchAll(/run: ([^|\n].*)/g)].map((m) => m[1]);
    for (const r of [...runBlocks, ...runLines]) assert.ok(!r.includes('${{'), `${name}: ${r}`);
    assert.match(yml, /^permissions:\n {2}contents: read/m, name);
  }
  const daily = readFileSync(join(ROOT, '.github', 'workflows', 'daily-brief.yml'), 'utf8');
  // GitHub 예약은 예비: 05:05·06:35 KST (앞 실행이 끝냈으면 건너뜀)
  assert.match(daily, /cron: '5 20 \* \* \*'/);
  assert.match(daily, /cron: '35 21 \* \* \*'/);
  assert.match(daily, /--scheduled/);
  assert.match(daily, /concurrency:/);
  assert.match(readFileSync(join(ROOT, '.github', 'workflows', 'site.yml'), 'utf8'), /group: sec-brief/);
});

test('워크플로: 코드가 읽는 비밀값은 모두 daily-brief 에서 넘겨준다(빠뜨리면 조용히 꺼짐)', () => {
  const daily = readFileSync(join(ROOT, '.github', 'workflows', 'daily-brief.yml'), 'utf8');
  const testOnly = new Set(['SMTP_SECURITY']);
  const names = new Set();
  for (const f of readdirSync(join(ROOT, 'src')).filter((x) => x.endsWith('.mjs'))) {
    for (const m of readFileSync(join(ROOT, 'src', f), 'utf8').matchAll(/secret\('([A-Z0-9_]+)'/g)) names.add(m[1]);
  }
  assert.ok(names.has('OUTLOOK_REFRESH_TOKEN'));
  for (const n of names) if (!testOnly.has(n)) assert.match(daily, new RegExp(`${n}: \\$\\{\\{ secrets\\.${n} \\}\\}`), n);
});

test('설정: 예약 실행의 발송 시각은 05:05 시작과 06:35 재시도 사이', () => {
  const cfg = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8'));
  const [h, m] = cfg.delivery.not_before.split(':').map(Number);
  const min = h * 60 + m;
  assert.ok(min > 5 * 60 + 5 && min < 6 * 60 + 35, cfg.delivery.not_before);
});

test('워크플로: 외부 호출(scheduled)은 GitHub 예약처럼 발송 시각까지 기다리고, 실행 이름으로 구분된다', () => {
  const daily = readFileSync(join(ROOT, '.github', 'workflows', 'daily-brief.yml'), 'utf8');
  assert.match(daily, /\n {6}scheduled:\n {8}description: .+\n {8}type: boolean\n {8}default: false\n/);
  const cond = "${{ (github.event_name == 'schedule' || inputs.scheduled) && '--scheduled' || '' }}";
  assert.ok(daily.includes(`SCHEDULED: ${cond}`), '수집: 건너뛸 때 안내');
  assert.ok(daily.includes(`WAIT: ${cond}`), '발송: 06:30 까지 기다리기');
  assert.match(daily, /run: node src\/cli\.mjs collect \$FORCE \$SCHEDULED\n/);
  assert.match(daily, /run: node src\/cli\.mjs send \$MODE \$FORCE \$WAIT\n/);
  assert.match(daily, /^run-name: .*'GitHub 예약 실행 \(예비\)'.*'정시 실행 \(외부 호출\)'.*'직접 실행'/m);
  // 기다리는 최대 시간(110분)이 발송 작업의 시간 제한 안에 있어야 한다
  const timeout = Number(/name: 발송 \(카카오톡·메일\)[\s\S]*?timeout-minutes: (\d+)/.exec(daily)[1]);
  const maxWait = Number(/const MAX_WAIT_MS = (\d+) \* 60 \* 1000;/.exec(readFileSync(join(ROOT, 'src', 'cli.mjs'), 'utf8'))[1]);
  assert.ok(maxWait + 5 <= timeout, `${maxWait}분 대기 + 준비 5분 > 시간 제한 ${timeout}분`);
});

test('README 의 외부 호출(cron-job.org) 설정이 워크플로·발송 시각과 맞다', () => {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  const daily = readFileSync(join(ROOT, '.github', 'workflows', 'daily-brief.yml'), 'utf8');
  assert.ok(readme.includes('https://api.github.com/repos/<아이디>/sec-brief/actions/workflows/daily-brief.yml/dispatches'));
  // 본문의 입력값 이름이 워크플로에 없으면 GitHub 가 422 로 거절하고, 그날은 예비가 늦게 보낸다
  const bodies = [...readme.matchAll(/`(\{"ref":"main","inputs":\{[^`]*\}\})`/g)].map((m) => m[1]);
  assert.ok(bodies.length >= 1, '요청 본문 예시');
  for (const body of bodies) {
    assert.equal(body, bodies[0], 'README 안의 요청 본문은 모두 같아야 함');
    for (const [k, v] of Object.entries(JSON.parse(body).inputs)) {
      assert.match(daily, new RegExp(`\\n {6}${k}:\\n {8}description:`), `워크플로에 입력값 ${k} 없음`);
      assert.equal(typeof v, 'string', 'API 입력값은 문자열로');
    }
  }
  // 호출 시각(06:00·06:15)은 발송 시각보다 15분 이상 앞서야 06:30 에 맞춰 보낸다
  const cfg = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8'));
  const [h, m] = cfg.delivery.not_before.split(':').map(Number);
  const cron = /`(\d+(?:,\d+)*) (\d+) \* \* \*`\)/.exec(readme);
  assert.ok(cron, 'cron-job.org 일정 식');
  for (const minute of cron[1].split(',').map(Number)) {
    assert.ok(Number(cron[2]) * 60 + minute + 15 <= h * 60 + m, `${cron[2]}:${minute} 호출은 ${cfg.delivery.not_before} 발송에 늦음`);
  }
});
