// 대한민국 관공서 공휴일(대체공휴일·선거일 포함). 정시·예약 실행은 주말과 이날을 쉰다(config.json schedule).
//
// 출처: 우주항공청 2027년 월력요항(2026-06-29 발표), 한국천문연구원 달력자료(https://astro.kasi.re.kr/kor/life/post/calendarData),
//       노동절·제헌절 공휴일 지정(「관공서의 공휴일에 관한 규정」 개정, 2026-04-28 국무회의, 2026년부터).
// 해마다 6월 말 다음 해 월력요항이 나오면 그해 것을 더한다. 갑자기 정해지는 임시공휴일은 config.json 의 schedule.extra_holidays 에 넣는다.
import { weekdayKo } from './util.mjs';

export const KR_HOLIDAYS = {
  2026: {
    '2026-01-01': '신정',
    '2026-02-16': '설날 연휴',
    '2026-02-17': '설날',
    '2026-02-18': '설날 연휴',
    '2026-03-01': '삼일절',
    '2026-03-02': '대체공휴일(삼일절)',
    '2026-05-01': '노동절',
    '2026-05-05': '어린이날',
    '2026-05-24': '부처님오신날',
    '2026-05-25': '대체공휴일(부처님오신날)',
    '2026-06-03': '전국동시지방선거',
    '2026-06-06': '현충일',
    '2026-07-17': '제헌절',
    '2026-08-15': '광복절',
    '2026-08-17': '대체공휴일(광복절)',
    '2026-09-24': '추석 연휴',
    '2026-09-25': '추석',
    '2026-09-26': '추석 연휴',
    '2026-10-03': '개천절',
    '2026-10-05': '대체공휴일(개천절)',
    '2026-10-09': '한글날',
    '2026-12-25': '성탄절',
  },
  2027: {
    '2027-01-01': '신정',
    '2027-02-06': '설날 연휴',
    '2027-02-07': '설날',
    '2027-02-08': '설날 연휴',
    '2027-02-09': '대체공휴일(설날)',
    '2027-03-01': '삼일절',
    '2027-05-01': '노동절',
    '2027-05-03': '대체공휴일(노동절)',
    '2027-05-05': '어린이날',
    '2027-05-13': '부처님오신날',
    '2027-06-06': '현충일',
    '2027-07-17': '제헌절',
    '2027-07-19': '대체공휴일(제헌절)',
    '2027-08-15': '광복절',
    '2027-08-16': '대체공휴일(광복절)',
    '2027-09-14': '추석 연휴',
    '2027-09-15': '추석',
    '2027-09-16': '추석 연휴',
    '2027-10-03': '개천절',
    '2027-10-04': '대체공휴일(개천절)',
    '2027-10-09': '한글날',
    '2027-10-11': '대체공휴일(한글날)',
    '2027-12-25': '성탄절',
    '2027-12-27': '대체공휴일(성탄절)',
  },
};

/** 그해 공휴일 자료가 있는지 (없으면 주말만 쉰다) */
export function holidaysKnown(year) {
  return Boolean(KR_HOLIDAYS[String(year)]);
}

/** 그해 공휴일 + config 의 임시공휴일, 날짜순 [{date, name}] */
export function holidaysOf(year, extra = {}) {
  const map = { ...(KR_HOLIDAYS[String(year)] || {}) };
  for (const [date, name] of Object.entries(extra || {})) if (date.startsWith(`${year}-`)) map[date] = name || '임시공휴일';
  return Object.entries(map)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, name]) => ({ date, name }));
}

/**
 * 쉬는 날인지. 공휴일 이름이 주말보다 먼저(주말과 겹친 공휴일은 공휴일 이름).
 * @param {string} ymd 'YYYY-MM-DD' (한국 날짜)
 * @param {Record<string,string>} extra config.json schedule.extra_holidays
 * @returns {{off: boolean, reason: string}}
 */
export function dayOff(ymd, extra = {}) {
  if (extra && Object.hasOwn(extra, ymd)) return { off: true, reason: extra[ymd] || '임시공휴일' };
  const name = KR_HOLIDAYS[ymd.slice(0, 4)]?.[ymd];
  if (name) return { off: true, reason: name };
  const wd = weekdayKo(ymd);
  if (wd === '토' || wd === '일') return { off: true, reason: `${wd}요일` };
  return { off: false, reason: '' };
}
