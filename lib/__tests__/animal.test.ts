import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { RawAnimal } from '../animal-api';
import { normalizeAnimal, type Animal } from '../animal';
import { byDeadline, filterAnimals } from '../animal-cache';
import { pickNewNotices } from '../discord';

/** KST 2026-08-30 정오. 팀 리드가 프로덕션에서 재현한 그 날짜다. */
const NOW = Date.UTC(2026, 7, 30, 3, 0, 0);

function raw(overrides: Partial<RawAnimal> = {}): RawAnimal {
  return {
    desertionNo: '441101202600001',
    happenDt: '20260824',
    happenPlace: '서울시 강남구',
    upKindNm: '개',
    kindNm: '[개] 믹스견',
    noticeSdt: '20260824',
    noticeEdt: '20260831',
    processState: '보호중',
    ...overrides,
  };
}

function animal(overrides: Partial<RawAnimal> = {}): Animal {
  return normalizeAnimal(raw(overrides), NOW);
}

describe('normalizeAnimal.daysLeft', () => {
  // 팀 리드가 프로덕션에서 확인한 표. 고치기 전에는 전부 하나씩 적게 나왔다.
  const cases: [string, number][] = [
    ['20260829', -1],
    ['20260830', 0],
    ['20260831', 1],
    ['20260901', 2],
  ];

  for (const [noticeEdt, expected] of cases) {
    it(`noticeEdt=${noticeEdt} → ${expected}`, () => {
      assert.equal(animal({ noticeEdt }).daysLeft, expected);
    });
  }

  it('종료일이 없으면 null', () => {
    assert.equal(animal({ noticeEdt: '' }).daysLeft, null);
  });

  it('화면에 적히는 noticeTo 와 daysLeft 가 서로 모순되지 않는다', () => {
    // 한 화면에 "공고 … ~ 2026.08.31" 과 "오늘 마감" 이 같이 뜨던 게 이 결함의 증상이었다.
    const a = animal({ noticeEdt: '20260831' });
    assert.equal(a.noticeTo, '20260831');
    assert.equal(a.daysLeft, 1);
  });

  it('KST 자정을 넘기면 하루 줄어든다', () => {
    const beforeMidnight = Date.UTC(2026, 7, 30, 14, 59, 59); // KST 8/30 23:59:59
    const afterMidnight = Date.UTC(2026, 7, 30, 15, 0, 0); // KST 8/31 00:00:00
    assert.equal(normalizeAnimal(raw({ noticeEdt: '20260831' }), beforeMidnight).daysLeft, 1);
    assert.equal(normalizeAnimal(raw({ noticeEdt: '20260831' }), afterMidnight).daysLeft, 0);
  });
});

describe('matchesState 경계', () => {
  const today = animal({ noticeEdt: '20260830' });
  const tomorrow = animal({ noticeEdt: '20260831' });
  const yesterday = animal({ noticeEdt: '20260829' });
  const finished = animal({ noticeEdt: '20260831', processState: '종료(입양)' });
  const unknown = animal({ noticeEdt: '' });
  const all = [today, tomorrow, yesterday, finished, unknown];

  it('오늘 마감은 공고중에 남는다', () => {
    // 이 결함의 가장 심각한 파급. 가장 급한 개체가 기본 화면에서 사라졌다.
    const notice = filterAnimals(all, { state: 'notice' });
    assert.ok(notice.includes(today), '오늘 마감이 공고중에 없다');
    assert.ok(notice.includes(tomorrow));
    assert.ok(!notice.includes(yesterday));
    assert.ok(!notice.includes(finished));
  });

  it('어제 마감은 보호중으로 간다', () => {
    const protect = filterAnimals(all, { state: 'protect' });
    assert.ok(protect.includes(yesterday));
    assert.ok(!protect.includes(today), '오늘 마감이 보호중으로 밀려났다');
    assert.ok(!protect.includes(tomorrow));
    assert.ok(!protect.includes(finished));
  });

  it('종료는 종료로만 잡힌다', () => {
    assert.deepEqual(filterAnimals(all, { state: 'return' }), [finished]);
  });

  it('기한 미상은 공고중·보호중 양쪽에 남는다', () => {
    assert.ok(filterAnimals(all, { state: 'notice' }).includes(unknown));
    assert.ok(filterAnimals(all, { state: 'protect' }).includes(unknown));
  });
});

describe('byDeadline 정렬', () => {
  it('마감 임박순 → 지난 것(최근 순) → 기한 미상', () => {
    const list = [
      animal({ desertionNo: 'past-old', noticeEdt: '20260820' }),
      animal({ desertionNo: 'unknown', noticeEdt: '' }),
      animal({ desertionNo: 'd7', noticeEdt: '20260906' }),
      animal({ desertionNo: 'today', noticeEdt: '20260830' }),
      animal({ desertionNo: 'past-recent', noticeEdt: '20260829' }),
      animal({ desertionNo: 'd1', noticeEdt: '20260831' }),
    ];
    assert.deepEqual(
      [...list].sort(byDeadline).map((a) => a.id),
      ['today', 'd1', 'd7', 'past-recent', 'past-old', 'unknown'],
    );
  });
});

describe('pickNewNotices', () => {
  const list = [
    animal({ desertionNo: 'a', noticeSdt: '20260829' }),
    animal({ desertionNo: 'b', noticeSdt: '20260829' }),
    animal({ desertionNo: 'c', noticeSdt: '20260830' }),
    animal({ desertionNo: 'd', noticeSdt: '20260828' }),
    animal({ desertionNo: 'e', noticeSdt: '20260829', processState: '종료(반환)' }),
  ];

  it('그 하루에 시작된 것만 고른다', () => {
    assert.deepEqual(pickNewNotices(list, '20260829').map((a) => a.id), ['a', 'b']);
  });

  it('연속된 두 실행이 같은 개체를 두 번 보내지 않는다', () => {
    const first = pickNewNotices(list, '20260829').map((a) => a.id);
    const second = pickNewNotices(list, '20260830').map((a) => a.id);
    assert.equal(first.filter((id) => second.includes(id)).length, 0);
  });

  it('종료된 공고는 제외한다', () => {
    assert.ok(!pickNewNotices(list, '20260829').some((a) => a.id === 'e'));
  });
});
