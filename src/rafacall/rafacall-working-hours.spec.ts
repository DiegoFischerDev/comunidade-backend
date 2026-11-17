import {
  parseWorkingHoursDays,
  sortWorkingHoursDays,
  validateWorkingHoursDays,
  type WorkingHoursDays,
} from './rafacall-working-hours';

const openWeek = (): WorkingHoursDays => ({
  mon: [{ start: '16:00', end: '18:20' }],
  tue: [{ start: '16:00', end: '18:20' }],
  wed: [{ start: '16:00', end: '18:20' }],
  thu: [{ start: '16:00', end: '18:20' }],
  fri: [{ start: '16:00', end: '18:20' }],
  sat: [],
  sun: [],
});

describe('rafacall working hours', () => {
  it('aceita a grelha em tuplos do .env', () => {
    const parsed = parseWorkingHoursDays({
      mon: [['16:00', '18:20']],
      tue: [],
      wed: [],
      thu: [],
      fri: [],
      sat: [],
      sun: [],
    });
    expect(parsed).toEqual({
      days: {
        mon: [{ start: '16:00', end: '18:20' }],
        tue: [],
        wed: [],
        thu: [],
        fri: [],
        sat: [],
        sun: [],
      },
    });
  });

  it('recusa intervalo mais curto do que a chamada', () => {
    const days = openWeek();
    days.mon = [{ start: '16:00', end: '16:10' }];
    expect(
      validateWorkingHoursDays(days, { durationMinutes: 15, bufferMinutes: 10 }),
    ).toMatch(/curto para uma chamada de 15 min/);
  });

  it('exige folga entre intervalos do mesmo dia', () => {
    const days = openWeek();
    days.tue = [
      { start: '10:00', end: '11:00' },
      { start: '11:05', end: '12:00' },
    ];
    expect(
      validateWorkingHoursDays(days, { durationMinutes: 15, bufferMinutes: 10 }),
    ).toMatch(/pelo menos 10 min/);
  });

  it('ordena intervalos pela hora de início', () => {
    const days = openWeek();
    days.fri = [
      { start: '18:00', end: '19:00' },
      { start: '10:00', end: '11:00' },
    ];
    expect(sortWorkingHoursDays(days).fri).toEqual([
      { start: '10:00', end: '11:00' },
      { start: '18:00', end: '19:00' },
    ]);
  });
});
