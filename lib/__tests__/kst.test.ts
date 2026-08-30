import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { dayToYmd, daysUntilKst, kstToday, todayYmdKst, ymdToDay } from '../kst';

/** KST 로 그 날짜 09:00 에 해당하는 UTC 밀리초. (KST 정오 언저리 = 안전한 한낮) */
function kstNoon(ymd: string): number {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(4, 6));
  const d = Number(ymd.slice(6, 8));
  return Date.UTC(y, m - 1, d, 12 - 9, 0, 0);
}

describe('daysUntilKst', () => {
  // 이 결함이 프로덕션까지 나갔다. KST 2026-08-30 기준 실제 값.
  const now = kstNoon('20260830');

  it('어제 마감이면 -1', () => {
    assert.equal(daysUntilKst('20260829', now), -1);
  });

  it('오늘 마감이면 0', () => {
    assert.equal(daysUntilKst('20260830', now), 0);
  });

  it('내일 마감이면 1', () => {
    assert.equal(daysUntilKst('20260831', now), 1);
  });

  it('모레 마감이면 2', () => {
    assert.equal(daysUntilKst('20260901', now), 2);
  });

  it('형식이 아니거나 없는 값이면 null', () => {
    assert.equal(daysUntilKst(undefined, now), null);
    assert.equal(daysUntilKst('', now), null);
    assert.equal(daysUntilKst('2026-08-31', now), null);
    assert.equal(daysUntilKst('202608311', now), null);
  });

  it('존재하지 않는 날짜는 굴리지 않고 null', () => {
    // Date.UTC 는 20260231 을 3월 3일로 조용히 굴린다. 그걸 그대로 쓰면 안 된다.
    assert.equal(daysUntilKst('20260231', now), null);
    assert.equal(daysUntilKst('20261301', now), null);
    assert.equal(daysUntilKst('20260800', now), null);
  });

  it('월·연 경계를 넘어도 맞는다', () => {
    assert.equal(daysUntilKst('20260901', kstNoon('20260831')), 1);
    assert.equal(daysUntilKst('20270101', kstNoon('20261231')), 1);
    assert.equal(daysUntilKst('20260301', kstNoon('20260228')), 1);
  });
});

describe('KST 자정 경계', () => {
  // KST 자정 = 15:00 UTC. 이 순간에 '오늘'이 하루 넘어가야 한다.
  const midnight = Date.UTC(2026, 7, 30, 15, 0, 0); // 2026-08-31 00:00 KST

  it('자정 1ms 전에는 아직 8/30', () => {
    assert.equal(todayYmdKst(midnight - 1), '20260830');
    assert.equal(daysUntilKst('20260831', midnight - 1), 1);
  });

  it('자정이 되면 8/31', () => {
    assert.equal(todayYmdKst(midnight), '20260831');
    assert.equal(daysUntilKst('20260831', midnight), 0);
  });

  it('자정 1ms 뒤에도 8/31', () => {
    assert.equal(todayYmdKst(midnight + 1), '20260831');
    assert.equal(daysUntilKst('20260831', midnight + 1), 0);
  });

  it('UTC 자정에는 이미 KST 로 하루가 지나 있다', () => {
    // UTC 2026-08-30 00:00 = KST 2026-08-30 09:00. UTC 날짜를 그대로 쓰면 여기서 어긋난다.
    assert.equal(todayYmdKst(Date.UTC(2026, 7, 30, 0, 0, 0)), '20260830');
    // UTC 2026-08-30 23:00 = KST 2026-08-31 08:00.
    assert.equal(todayYmdKst(Date.UTC(2026, 7, 30, 23, 0, 0)), '20260831');
  });
});

describe('ymdToDay / dayToYmd', () => {
  it('왕복해도 같다', () => {
    for (const ymd of ['20260101', '20260228', '20260831', '20261231', '20240229']) {
      assert.equal(dayToYmd(ymdToDay(ymd)!), ymd);
    }
  });

  it('하루 차이는 정확히 1', () => {
    assert.equal(ymdToDay('20260831')! - ymdToDay('20260830')!, 1);
    assert.equal(ymdToDay('20260301')! - ymdToDay('20260228')!, 1);
  });

  it('kstToday - 1 은 어제다', () => {
    assert.equal(dayToYmd(kstToday(kstNoon('20260901')) - 1), '20260831');
    assert.equal(dayToYmd(kstToday(kstNoon('20260101')) - 1), '20251231');
  });
});
