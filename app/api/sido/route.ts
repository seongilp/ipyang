import { NextResponse } from 'next/server';

import { AnimalApiFailure, fetchSido } from '@/lib/animal-api';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    const { items } = await fetchSido();
    return NextResponse.json(
      { sido: items.map((s) => ({ code: s.orgCd, name: s.orgdownNm })) },
      { headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800' } },
    );
  } catch (error) {
    if (error instanceof AnimalApiFailure) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
    }
    throw error;
  }
}
