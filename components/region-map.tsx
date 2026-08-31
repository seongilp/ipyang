'use client';

import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';

import type { RegionAgg } from '@/lib/map-data';

import 'maplibre-gl/dist/maplibre-gl.css';

/**
 * 시군구 choropleth.
 *
 * 개별 보호소를 점으로 찍지 않고, 시군구 경계 폴리곤을 **개체 수로 색칠한다.** 지오코딩이
 * 필요 없다 — 주소 앞부분을 시군구로 파싱해(`lib/sigungu.ts`) 번들된 경계(`/sgg.geojson`,
 * WGS84 230개)에 조인한다.
 *
 * 색만으로는 규모를 못 읽는다("여유 8.4만 vs 700" 문제). 그래서 색과 **숫자 라벨을 항상 같이**
 * 얹는다. 색은 상대적 많고 적음, 숫자는 정확한 마리 수를 맡는다.
 */

const BASEMAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

/** 대한민국 본토+제주 대략 경계. 여백은 fitBounds padding 으로만 준다. */
const KOREA_BOUNDS: [[number, number], [number, number]] = [
  [125.5, 33.1],
  [129.7, 38.4],
];
const FIT_PADDING = { top: 24, right: 24, bottom: 40, left: 24 };
const FIT_PADDING_COMPACT = { top: 16, right: 16, bottom: 48, left: 16 };

const SOURCE = 'sgg';
const LABEL_SOURCE = 'sgg-labels';

/**
 * 개체 수 → 색. 어두운 베이스맵 위에서 밝을수록 많다. 토스 블루 계열로 단계를 벌린다.
 * 0(데이터 없음)은 거의 안 보이게 눕혀 "여기엔 없다"를 색으로도 밝힌다.
 * feature-state 는 초기값이 없을 수 있어 coalesce 로 0 처리한다.
 */
const FILL_COLOR = [
  'interpolate',
  ['linear'],
  ['coalesce', ['feature-state', 'count'], 0],
  0,
  '#111827',
  1,
  '#1e3a8a',
  15,
  '#1d4ed8',
  60,
  '#2563eb',
  150,
  '#3b82f6',
  400,
  '#60a5fa',
] as unknown as maplibregl.ExpressionSpecification;

interface FeatureProps {
  code: string;
  name: string;
}

/** 폴리곤 집합의 대략 중심(라벨 위치용). 가장 큰 링의 bbox 중앙이면 바다로 새지 않는다. */
function labelPoint(geometry: GeoJSON.Geometry): [number, number] | null {
  const rings: number[][][] = [];
  if (geometry.type === 'Polygon') rings.push(geometry.coordinates[0]);
  else if (geometry.type === 'MultiPolygon') {
    let best: number[][] | null = null;
    let bestLen = 0;
    for (const poly of geometry.coordinates) {
      const outer = poly[0];
      if (outer.length > bestLen) {
        bestLen = outer.length;
        best = outer;
      }
    }
    if (best) rings.push(best);
  }
  const ring = rings[0];
  if (!ring || ring.length === 0) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

export function RegionMap({
  regions,
  selectedCode,
  onSelect,
  compact = false,
}: {
  regions: RegionAgg[];
  selectedCode: string | null;
  onSelect: (region: { code: string; name: string }) => void;
  compact?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const loadedRef = useRef(false);
  const fittedRef = useRef(false);
  const [geo, setGeo] = useState<GeoJSON.FeatureCollection | null>(null);
  /** 코드 → 라벨 좌표. geojson 로드 시 한 번 계산. */
  const centersRef = useRef<Map<string, [number, number]>>(new Map());

  const onSelectRef = useRef(onSelect);
  const regionsRef = useRef(regions);
  const compactRef = useRef(compact);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);
  useEffect(() => {
    regionsRef.current = regions;
  }, [regions]);
  useEffect(() => {
    compactRef.current = compact;
  }, [compact]);

  /* 경계 데이터는 정적 파일에서 한 번만 받는다. 라벨 좌표도 이때 계산해 둔다. */
  useEffect(() => {
    let cancelled = false;
    fetch('/sgg.geojson')
      .then((response) => response.json())
      .then((data: GeoJSON.FeatureCollection) => {
        if (cancelled) return;
        const centers = new Map<string, [number, number]>();
        for (const feature of data.features) {
          const code = (feature.properties as FeatureProps | null)?.code;
          const point = labelPoint(feature.geometry);
          if (code && point) centers.set(code, point);
        }
        centersRef.current = centers;
        setGeo(data);
      })
      .catch(() => {
        // 경계 없이도 인포그래픽은 성립한다. 지도는 조용히 비운다.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /* 지도 생성 — geojson 이 준비된 뒤 한 번만. */
  useEffect(() => {
    if (!geo || !containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP_STYLE,
      bounds: KOREA_BOUNDS,
      fitBoundsOptions: { padding: compactRef.current ? FIT_PADDING_COMPACT : FIT_PADDING },
      minZoom: 4,
      maxZoom: 12,
      attributionControl: { compact: true },
      // CARTO 글리프 서버에 한글 음절이 없다. 숫자 라벨엔 무관하지만 안전하게 브라우저 폰트로.
      localIdeographFontFamily: "'Noto Sans KR', sans-serif",
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    map.on('load', () => {
      // 경계 폴리곤. feature-state 로 개체 수를 칠하려면 안정적 id 가 필요하다.
      map.addSource(SOURCE, { type: 'geojson', data: geo, promoteId: 'code' });

      map.addLayer({
        id: 'sgg-fill',
        type: 'fill',
        source: SOURCE,
        paint: {
          'fill-color': FILL_COLOR,
          'fill-opacity': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            0.92,
            ['boolean', ['feature-state', 'hover'], false],
            0.85,
            0.72,
          ],
        },
      });

      map.addLayer({
        id: 'sgg-outline',
        type: 'line',
        source: SOURCE,
        paint: {
          'line-color': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            '#ffffff',
            'rgba(148,163,184,0.35)',
          ],
          'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 2.4, 0.5],
        },
      });

      // 숫자 라벨. text-field 는 feature-state 를 못 읽으므로 별도 포인트 소스에 값을 담는다.
      map.addSource(LABEL_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'sgg-label',
        type: 'symbol',
        source: LABEL_SOURCE,
        layout: {
          'text-field': ['get', 'label'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 5, 10, 9, 13],
          'text-font': ['Open Sans Bold', 'Noto Sans Bold'],
          // 230개가 다 뜨면 못 읽는다. 겹치면 숨기되(allow-overlap:false), 개체 많은 곳부터
          // 살아남게 정렬 키를 음수 개체 수로 준다(작을수록 먼저 그려져 충돌에서 이김).
          'text-allow-overlap': false,
          'symbol-sort-key': ['-', 0, ['get', 'count']],
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': '#0b0f19',
          'text-halo-width': 1.4,
        },
      });

      loadedRef.current = true;
      applyCounts();
      applyLabels();
    });

    map.on('click', 'sgg-fill', (event) => {
      const props = event.features?.[0]?.properties as FeatureProps | undefined;
      if (props?.code) onSelectRef.current({ code: props.code, name: props.name });
    });

    let hovered: string | null = null;
    map.on('mousemove', 'sgg-fill', (event) => {
      const code = (event.features?.[0]?.properties as FeatureProps | undefined)?.code;
      map.getCanvas().style.cursor = 'pointer';
      if (hovered === code) return;
      if (hovered) map.setFeatureState({ source: SOURCE, id: hovered }, { hover: false });
      hovered = code ?? null;
      if (hovered) map.setFeatureState({ source: SOURCE, id: hovered }, { hover: true });
    });
    map.on('mouseleave', 'sgg-fill', () => {
      map.getCanvas().style.cursor = '';
      if (hovered) map.setFeatureState({ source: SOURCE, id: hovered }, { hover: false });
      hovered = null;
    });

    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box || box.width < 1 || box.height < 1) return;
      map.resize();
      if (fittedRef.current) return;
      fittedRef.current = true;
      map.fitBounds(KOREA_BOUNDS, {
        padding: compactRef.current ? FIT_PADDING_COMPACT : FIT_PADDING,
        duration: 0,
      });
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      loadedRef.current = false;
      fittedRef.current = false;
    };
  }, [geo]);

  /** 시군구별 개체 수를 feature-state 로 칠한다. */
  function applyCounts(): void {
    const map = mapRef.current;
    if (!map || !map.getSource(SOURCE)) return;
    // 먼저 전부 0 으로 눕히고(직전 필터의 잔상 제거), 있는 것만 채운다.
    for (const [code] of centersRef.current) {
      map.setFeatureState({ source: SOURCE, id: code }, { count: 0 });
    }
    for (const region of regionsRef.current) {
      map.setFeatureState({ source: SOURCE, id: region.code }, { count: region.total });
    }
  }

  /** 숫자 라벨 소스를 갱신한다. 개체가 있는 시군구만. */
  function applyLabels(): void {
    const map = mapRef.current;
    const source = map?.getSource(LABEL_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    source.setData({
      type: 'FeatureCollection',
      features: regionsRef.current.flatMap((region) => {
        const center = centersRef.current.get(region.code);
        if (!center) return [];
        return [
          {
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: center },
            properties: {
              label: region.total > 999 ? `${(region.total / 1000).toFixed(1)}천` : String(region.total),
              count: region.total,
            },
          },
        ];
      }),
    });
  }

  /* 필터 결과가 바뀌면 색과 라벨을 다시 칠한다. */
  useEffect(() => {
    if (!loadedRef.current) return;
    applyCounts();
    applyLabels();
    // regions 는 매번 새 배열이라 값으로 반응한다.
  }, [regions]);

  /* 선택 강조. */
  const selectedRef = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const previous = selectedRef.current;
    if (previous && previous !== selectedCode) {
      map.setFeatureState({ source: SOURCE, id: previous }, { selected: false });
    }
    selectedRef.current = selectedCode;
    if (selectedCode) map.setFeatureState({ source: SOURCE, id: selectedCode }, { selected: true });
  }, [selectedCode]);

  return <div ref={containerRef} className="size-full" />;
}
