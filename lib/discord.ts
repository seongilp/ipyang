import { formatYmd, type Animal } from './animal';

/**
 * Discord 알림.
 *
 * 웹훅 URL 은 그 자체가 인증수단이다(아는 사람은 누구나 메시지를 보낼 수 있다).
 * 절대 클라이언트에 노출하지 말고, 코드에도 적지 말고, 환경변수로만 받는다.
 */

const MAX_EMBEDS = 10;

export function hasWebhook(): boolean {
  return Boolean(process.env.DISCORD_WEBHOOK_URL?.trim());
}

async function send(payload: unknown): Promise<void> {
  const url = process.env.DISCORD_WEBHOOK_URL?.trim();
  if (!url) throw new Error('DISCORD_WEBHOOK_URL 이 설정되지 않았습니다.');

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Discord ${response.status}: ${body.slice(0, 200)}`);
  }
}

function deadlineColor(daysLeft: number | null): number {
  if (daysLeft === null || daysLeft < 0) return 0x6b7280; // 회색
  if (daysLeft <= 3) return 0xef4444; // 빨강
  if (daysLeft <= 7) return 0xf59e0b; // 주황
  return 0x3182f6; // 토스 블루
}

function animalEmbed(animal: Animal, siteUrl: string) {
  const left =
    animal.daysLeft === null
      ? '기한 미상'
      : animal.daysLeft < 0
        ? '공고 종료'
        : animal.daysLeft === 0
          ? '오늘 마감'
          : `${animal.daysLeft}일 남음`;

  return {
    title: `${animal.breed} · ${animal.sex}`,
    description: [animal.note, animal.foundPlace && `발견 ${animal.foundPlace}`]
      .filter(Boolean)
      .join('\n')
      .slice(0, 300),
    color: deadlineColor(animal.daysLeft),
    url: siteUrl,
    fields: [
      { name: '마감', value: `${left} (${formatYmd(animal.noticeTo)})`, inline: true },
      { name: '보호소', value: animal.shelter.name || '미상', inline: true },
      { name: '연락처', value: animal.shelter.tel || '미상', inline: true },
    ],
    // 사진은 프록시 경로라 절대 URL 로 바꿔야 Discord 가 가져갈 수 있다.
    ...(animal.photo ? { thumbnail: { url: `${siteUrl}${animal.photo}` } } : {}),
    footer: { text: `공고번호 ${animal.id}` },
  };
}

/**
 * 특정 날짜에 **시작된** 공고. `noticeSdt` 기준.
 *
 * 범위(`>=`)가 아니라 그 하루만 정확히 고른다. 범위로 잡으면 연속된 두 번의 실행이
 * 같은 개체를 두 번 보낸다 — 이 앱은 무엇을 보냈는지 기억할 저장소가 없으므로
 * "하루당 정확히 한 번" 이 성립해야 중복이 없다.
 */
export function pickNewNotices(animals: Animal[], startedOnYmd: string): Animal[] {
  return animals
    .filter((animal) => animal.noticeFrom === startedOnYmd)
    .filter((animal) => !animal.state.startsWith('종료'));
}

export async function sendNewNotices(
  animals: Animal[],
  startedOnYmd: string,
  siteUrl: string,
): Promise<number> {
  const fresh = pickNewNotices(animals, startedOnYmd);
  if (fresh.length === 0) return 0;

  // 마감이 임박한 순으로 상위만 보낸다. Discord embed 는 메시지당 10개가 상한이고,
  // 하루 수백 건을 다 보내면 알림이 아니라 소음이 된다.
  const top = fresh.slice(0, MAX_EMBEDS);

  await send({
    content: `**${formatYmd(startedOnYmd)} 새 공고 ${fresh.length}건**${
      fresh.length > top.length ? ` (마감 임박 ${top.length}건만 표시)` : ''
    }`,
    embeds: top.map((animal) => animalEmbed(animal, siteUrl)),
  });

  return fresh.length;
}

export async function sendSummary(animals: Animal[], siteUrl: string): Promise<void> {
  const active = animals.filter(
    (a) => !a.state.startsWith('종료') && a.daysLeft !== null && a.daysLeft >= 0,
  );
  const today = active.filter((a) => a.daysLeft === 0);
  const soon = active.filter((a) => a.daysLeft !== null && a.daysLeft > 0 && a.daysLeft <= 3);

  const bySpecies = new Map<string, number>();
  for (const animal of active) {
    bySpecies.set(animal.species, (bySpecies.get(animal.species) ?? 0) + 1);
  }

  const speciesLine =
    [...bySpecies.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => `${name} ${count.toLocaleString()}`)
      .join(' · ') || '없음';

  await send({
    embeds: [
      {
        title: '유기동물 공고 현황',
        url: siteUrl,
        color: today.length > 0 ? 0xef4444 : 0x3182f6,
        fields: [
          { name: '공고중', value: `${active.length.toLocaleString()}마리`, inline: true },
          { name: '오늘 마감', value: `${today.length.toLocaleString()}마리`, inline: true },
          { name: '3일 이내', value: `${soon.length.toLocaleString()}마리`, inline: true },
          { name: '축종', value: speciesLine, inline: false },
        ],
        footer: { text: '국가동물보호정보시스템 공공데이터' },
        timestamp: new Date().toISOString(),
      },
    ],
  });
}
