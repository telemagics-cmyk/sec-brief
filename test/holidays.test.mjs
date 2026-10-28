// 공휴일 표: 공식 월력요항과 같은지(건수·날짜), 대체공휴일 규칙에 맞는지 스스로 확인한다.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dayOff, holidaysKnown, holidaysOf, KR_HOLIDAYS } from '../src/holidays.mjs';
import { addDays, isYmd, weekdayKo } from '../src/util.mjs';

const weekend = (d) => ['토', '일'].includes(weekdayKo(d));

test('공휴일 표: 날짜 형식·연도, 2027년은 월력요항대로 24일(평일 15일)', () => {
  for (const [year, map] of Object.entries(KR_HOLIDAYS)) {
    for (const [date, name] of Object.entries(map)) {
      assert.ok(isYmd(date) && date.startsWith(`${year}-`), date);
      assert.ok(name.trim(), date);
    }
  }
  // 우주항공청 2027년 월력요항: 일요일 52일 + 국경일·대체공휴일·노동절·제헌절 등 24일
  const y2027 = Object.keys(KR_HOLIDAYS[2027]);
  assert.equal(y2027.length, 24);
  assert.equal(y2027.filter((d) => !weekend(d)).length, 15);
  assert.equal(KR_HOLIDAYS[2027]['2027-02-09'], '대체공휴일(설날)');
  assert.equal(KR_HOLIDAYS[2026]['2026-12-25'], '성탄절');
  assert.equal(KR_HOLIDAYS[2026]['2026-07-17'], '제헌절', '2026년부터 공휴일');
  assert.equal(KR_HOLIDAYS[2026]['2026-05-01'], '노동절', '2026년부터 공휴일');
});

test('공휴일 표: 대체공휴일은 원래 공휴일 다음 첫 평일·비공휴일이고, 주말에 걸린 대상 공휴일엔 빠짐없이 있다', () => {
  // 주말(토·일)과 겹치면 대체공휴일이 생기는 날. 설날·추석은 연휴가 일요일과 겹칠 때만, 신정·현충일은 없음.
  const onWeekend = ['삼일절', '노동절', '어린이날', '부처님오신날', '제헌절', '광복절', '개천절', '한글날', '성탄절'];
  for (const [year, map] of Object.entries(KR_HOLIDAYS)) {
    const isHoliday = (d) => Object.hasOwn(map, d);
    const subs = Object.entries(map).filter(([, n]) => n.startsWith('대체공휴일('));
    for (const [date, name] of subs) {
      const base = name.slice('대체공휴일('.length, -1);
      const baseDate = Object.keys(map).find((d) => map[d] === base);
      assert.ok(baseDate, `${year} ${name}: 원래 공휴일이 표에 없음`);
      assert.ok(weekend(baseDate), `${year} ${base}(${baseDate})는 주말이 아님`);
      let d = addDays(baseDate, 1);
      while (weekend(d) || (isHoliday(d) && d !== date)) d = addDays(d, 1);
      assert.equal(date, d, `${year} ${name}`);
    }
    for (const [date, name] of Object.entries(map)) {
      if (onWeekend.includes(name) && weekend(date)) assert.ok(subs.some(([, n]) => n === `대체공휴일(${name})`), `${date} ${name} 대체공휴일 없음`);
    }
    for (const big of ['설날', '추석']) {
      const block = Object.keys(map).filter((d) => map[d].startsWith(big) && !map[d].startsWith('대체'));
      const hasSub = subs.some(([, n]) => n === `대체공휴일(${big})`);
      assert.equal(hasSub, block.some((d) => weekdayKo(d) === '일'), `${year} ${big} 연휴 ${block.join(',')}`);
    }
  }
});

test('쉬는 날 판단: 주말·공휴일·config 의 임시공휴일', () => {
  assert.deepEqual(dayOff('2026-10-29'), { off: false, reason: '' });
  assert.deepEqual(dayOff('2026-10-31'), { off: true, reason: '토요일' });
  assert.deepEqual(dayOff('2026-11-01'), { off: true, reason: '일요일' });
  assert.deepEqual(dayOff('2026-12-25'), { off: true, reason: '성탄절' });
  assert.deepEqual(dayOff('2027-08-15'), { off: true, reason: '광복절' }, '주말과 겹친 공휴일은 공휴일 이름');
  assert.deepEqual(dayOff('2027-08-16'), { off: true, reason: '대체공휴일(광복절)' });
  assert.deepEqual(dayOff('2026-11-02', { '2026-11-02': '임시공휴일' }), { off: true, reason: '임시공휴일' });
  assert.deepEqual(dayOff('2026-11-03', { '2026-11-03': '' }), { off: true, reason: '임시공휴일' }, '이름을 비워도 쉼');
  assert.ok(holidaysKnown(2027) && !holidaysKnown(2030));
  const list = holidaysOf(2026, { '2026-11-02': '임시공휴일', '2027-01-04': '다른 해' });
  assert.deepEqual(list.at(-2), { date: '2026-11-02', name: '임시공휴일' }, '날짜순으로 끼워 넣음');
  assert.ok(!list.some((x) => x.date === '2027-01-04'));
});
