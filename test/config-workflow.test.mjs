import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  // 05:05 KST 에 시작, 06:35 KST 에 한 번 더(앞 실행이 끝냈으면 건너뜀)
  assert.match(daily, /cron: '5 20 \* \* \*'/);
  assert.match(daily, /cron: '35 21 \* \* \*'/);
  assert.match(daily, /--scheduled/);
  assert.match(daily, /concurrency:/);
  assert.match(readFileSync(join(ROOT, '.github', 'workflows', 'site.yml'), 'utf8'), /group: sec-brief/);
});

test('설정: 예약 실행의 발송 시각은 05:05 시작과 06:35 재시도 사이', () => {
  const cfg = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8'));
  const [h, m] = cfg.delivery.not_before.split(':').map(Number);
  const min = h * 60 + m;
  assert.ok(min > 5 * 60 + 5 && min < 6 * 60 + 35, cfg.delivery.not_before);
});
