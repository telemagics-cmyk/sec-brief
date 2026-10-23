// 이전 도구(sec-brief-local 의 out/daily-brief-YYYYMMDD.md, 루틴이 저장소에 남긴 브리핑 파일)를
// 웹 이력으로 옮긴다. 원문은 그대로 보존하고, 검색용으로 CVE 번호와 링크만 뽑아 둔다.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { loadBrief, saveBrief } from './store.mjs';
import { findCveIds, isYmd, uniq } from './util.mjs';

function dateFromName(name) {
  const m = name.match(/(20\d{2})-?(\d{2})-?(\d{2})/);
  if (!m) return '';
  const d = `${m[1]}-${m[2]}-${m[3]}`;
  return isYmd(d) ? d : '';
}

/** 맨 아래 '지난 브리핑 모아보기' + claude.ai 아티팩트 링크는 웹 이력 자체와 겹치므로 뗀다. */
export function stripArchiveFooter(text) {
  const kept = String(text)
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !/claude\.ai\/(code\/)?artifact/.test(line) && line.trim() !== '지난 브리핑 모아보기');
  while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
  return kept.join('\n');
}

function walk(dir, depth = 0) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.') || name === 'node_modules') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory() && depth < 4) out.push(...walk(p, depth + 1));
    else if (st.isFile() && /\.(md|txt)$/i.test(name)) out.push(p);
  }
  return out;
}

/**
 * @returns {{imported:string[], skipped:string[]}}
 */
export function importLegacy(cfg, folder, { overwrite = false, log = console.log } = {}) {
  const imported = [];
  const skipped = [];
  const files = walk(folder).filter((p) => dateFromName(basename(p)));
  // 같은 날짜 파일이 여럿이면 가장 큰 것(전문)을 쓴다
  const byDate = new Map();
  for (const p of files) {
    const d = dateFromName(basename(p));
    const size = statSync(p).size;
    if (!byDate.has(d) || byDate.get(d).size < size) byDate.set(d, { p, size });
  }
  for (const [date, { p }] of [...byDate.entries()].sort()) {
    const existing = loadBrief(cfg.dataDir, date);
    if (existing && !(overwrite && existing.legacy)) {
      skipped.push(`${date} (이미 있음: ${existing.legacy ? '옮긴 기록' : '새 형식 브리핑'})`);
      continue;
    }
    const raw = readFileSync(p, 'utf8').replace(/^﻿/, '');
    const text = stripArchiveFooter(raw);
    if (!text.trim()) {
      skipped.push(`${date} (빈 파일)`);
      continue;
    }
    const firstLine = text.split('\n').find((l) => l.trim()) || '';
    const links = uniq(text.match(/https?:\/\/[^\s<>()"']+/g) || []);
    const brief = {
      version: 1,
      legacy: true,
      date,
      generated_at: `${date}T07:00:00+09:00`,
      title: firstLine.replace(/^#+\s*/, '').replace(/^\[|\]$/g, '').trim(),
      text,
      cves: findCveIds(text),
      links,
      imported_from: `${basename(p, extname(p))}${extname(p)}`,
    };
    saveBrief(cfg.dataDir, brief, `${text}\n`);
    imported.push(date);
    log(`  옮김 ${date} ← ${basename(p)} (CVE ${brief.cves.length}건)`);
  }
  return { imported, skipped };
}
