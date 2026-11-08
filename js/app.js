import {
  CONFIDENCES,
  RISK_COLOR,
  TYPE_LABEL,
  TYPES,
  arcCollection,
  attachLinks,
  buildRecords,
  dateAt,
  dayNumber,
  formatDate,
  isUnofficial,
  linkedIdSet,
  newsVisible,
  recordVisible,
  safeHttpUrl,
  shownConfidence
} from './model.js';

const EMPTY = { type: 'FeatureCollection', features: [] };
const DASH = [
  [0, 2, 4, 2],
  [0.5, 2, 3.5, 2],
  [1, 2, 3, 2],
  [1.5, 2, 2.5, 2],
  [2, 2, 2, 2],
  [2.5, 2, 1.5, 2],
  [3, 2, 1, 2],
  [3.5, 2, 0.5, 2],
  [4, 2, 0, 2]
];
const TABS = [
  ['details', 'Деталі'],
  ['today', 'Сьогодні важливо'],
  ['poland', 'Польща і Краків'],
  ['news', 'Новини'],
  ['list', 'Список'],
  ['help', 'Як читати']
];

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const mobileQuery = matchMedia('(max-width: 860px)');

const els = {
  asof: document.getElementById('asof'),
  filters: document.getElementById('filters'),
  filterHost: document.getElementById('filter-host'),
  tools: document.getElementById('tools'),
  status: document.getElementById('map-status'),
  legend: document.getElementById('legend'),
  hover: document.getElementById('hovercard'),
  sheet: document.getElementById('sheet'),
  handle: document.getElementById('handle'),
  peek: document.getElementById('peek'),
  timeline: document.getElementById('timeline'),
  scroll: document.getElementById('sheet-scroll'),
  tabs: document.getElementById('tabs'),
  panel: document.getElementById('panel'),
  mapWrap: document.getElementById('map-wrap'),
  live: document.getElementById('live')
};

function h(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}

function placeChrome() {
  if (mobileQuery.matches) {
    els.scroll.prepend(els.filters);
    els.handle.after(els.peek);
    els.peek.after(els.timeline);
  } else {
    els.filterHost.append(els.filters);
    els.mapWrap.append(els.timeline);
    els.legend.open = true;
  }
}

function setSnap(name) {
  els.sheet.dataset.snap = name;
  els.handle.setAttribute('aria-expanded', name === 'peek' ? 'false' : 'true');
}

function nudgeSnap(deltaY) {
  if (!mobileQuery.matches) return;
  const order = ['peek', 'half', 'full'];
  let index = order.indexOf(els.sheet.dataset.snap || 'peek');
  index = Math.max(0, Math.min(order.length - 1, index - Math.sign(deltaY)));
  setSnap(order[index]);
}

let dragY = null;
let dragged = false;
els.handle.addEventListener('pointerdown', (event) => {
  dragY = event.clientY;
  dragged = false;
  els.handle.setPointerCapture(event.pointerId);
});
els.handle.addEventListener('pointermove', (event) => {
  if (dragY != null && Math.abs(event.clientY - dragY) > 8) dragged = true;
});
els.handle.addEventListener('pointerup', (event) => {
  if (dragY == null) return;
  const delta = event.clientY - dragY;
  dragY = null;
  if (dragged) nudgeSnap(delta);
});
els.handle.addEventListener('click', () => {
  if (dragged || !mobileQuery.matches) return;
  const order = ['peek', 'half', 'full'];
  const index = order.indexOf(els.sheet.dataset.snap || 'peek');
  setSnap(order[(index + 1) % order.length]);
});
mobileQuery.addEventListener('change', () => {
  placeChrome();
  if (map) map.resize();
});
placeChrome();

async function loadJson(file) {
  const response = await fetch(new URL(`../${file}`, import.meta.url));
  if (!response.ok) throw new Error(file);
  return response.json();
}

function points(records) {
  return {
    type: 'FeatureCollection',
    features: records
      .filter((record) => Number.isFinite(record.lon) && Number.isFinite(record.lat))
      .map((record) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [record.lon, record.lat] },
        properties: {
          id: record.id,
          title: record.title,
          confidence: shownConfidence(record),
          kind: record.kind
        }
      }))
  };
}

function newsPoints(items) {
  return {
    type: 'FeatureCollection',
    features: items
      .filter((item) => Number.isFinite(item.lon) && Number.isFinite(item.lat))
      .map((item) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [item.lon, item.lat] },
        properties: { id: item.id, title: item.title, place: item.place || '' }
      }))
  };
}

let map = null;
let mapReady = false;
let dashStep = 0;
let data = null;

function existingLayers(ids) {
  return ids.filter((id) => map && map.getLayer(id));
}

function paintMap() {
  if (!mapReady || !data) return;
  const { records, state } = data;
  const linked = linkedIdSet(records, state.selectedId);
  const selected = records.find((record) => record.id === state.selectedId) || null;
  const shown = records.filter((record) => (
    recordVisible(record, state, linked) || record.id === state.selectedId || (selected && linked.has(record.id))
  ));
  const shownNews = data.newsItems.filter((item) => newsVisible(item, state) || item.id === state.selectedId);
  map.getSource('events').setData(points(shown.filter((record) => record.id !== state.selectedId)));
  map.getSource('news').setData(newsPoints(shownNews.filter((item) => item.id !== state.selectedId)));
  const focus = [];
  if (selected) focus.push(...points([selected]).features);
  const currentNews = shownNews.find((item) => item.id === state.selectedId);
  if (currentNews) focus.push(...newsPoints([currentNews]).features);
  map.getSource('focus').setData({ type: 'FeatureCollection', features: focus });
  map.getSource('arcs').setData(arcCollection(selected, records));
  const iso = selected?.country || '';
  map.setFilter('country-selected', ['==', ['get', 'iso_a2'], iso || '___']);
  const visibility = state.showCountries ? 'visible' : 'none';
  for (const id of ['countries-fill', 'countries-line', 'country-labels', 'country-selected']) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility);
  }
  const count = shown.filter((record) => record.kind !== 'країна' || state.showCountryDots).length
    + shownNews.filter((item) => item.displayLat != null).length;
  data.visibleCount = count;
}

function addLayers(world) {
  for (const feature of world.features) {
    const row = data.byCode.get(feature.properties.iso_a2);
    feature.properties.risk = row && row.advisory != null ? row.advisory : 0;
  }
  map.addSource('countries', { type: 'geojson', data: world });
  map.addLayer({
    id: 'countries-fill',
    type: 'fill',
    source: 'countries',
    paint: {
      'fill-color': ['match', ['get', 'risk'], 1, RISK_COLOR[1], 2, RISK_COLOR[2], 3, RISK_COLOR[3], 4, RISK_COLOR[4], RISK_COLOR[0]],
      'fill-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.78, 4, 0.62, 8, 0.28, 12, 0.14, 14, 0.08]
    }
  }, 'building');
  map.addLayer({
    id: 'countries-line',
    type: 'line',
    source: 'countries',
    paint: {
      'line-color': '#d5e6dc',
      'line-width': ['interpolate', ['linear'], ['zoom'], 0, 0.4, 6, 1, 12, 1.3],
      'line-opacity': 0.45
    }
  }, 'building');
  map.addLayer({
    id: 'country-selected',
    type: 'line',
    source: 'countries',
    filter: ['==', ['get', 'iso_a2'], '___'],
    paint: { 'line-color': '#f4f1e6', 'line-width': 2, 'line-opacity': 0.9 }
  });
  const labels = {
    type: 'FeatureCollection',
    features: data.centroids
      .filter((row) => row.code && Number.isFinite(row.lon))
      .map((row) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [row.lon, row.lat] },
        properties: { name_uk: row.name_uk, iso_a2: row.code }
      }))
  };
  map.addSource('labels', { type: 'geojson', data: labels });
  map.addLayer({
    id: 'country-labels',
    type: 'symbol',
    source: 'labels',
    minzoom: 1.4,
    maxzoom: 5.6,
    layout: {
      'text-field': ['get', 'name_uk'],
      'text-font': ['Noto Sans Regular'],
      'text-size': 12,
      'text-padding': 4
    },
    paint: {
      'text-color': '#f3f7f4',
      'text-halo-color': '#101614',
      'text-halo-width': 1.2
    }
  });
  map.addSource('events', { type: 'geojson', data: EMPTY, cluster: true, clusterRadius: 36, clusterMaxZoom: 6 });
  map.addSource('news', { type: 'geojson', data: EMPTY, cluster: true, clusterRadius: 46, clusterMaxZoom: 10 });
  map.addSource('focus', { type: 'geojson', data: EMPTY });
  map.addSource('arcs', { type: 'geojson', data: EMPTY });
  map.addLayer({
    id: 'clusters',
    type: 'circle',
    source: 'events',
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': '#24362e',
      'circle-radius': ['step', ['get', 'point_count'], 14, 10, 18, 30, 24],
      'circle-stroke-width': 1,
      'circle-stroke-color': '#d6c4a1'
    }
  });
  map.addLayer({
    id: 'cluster-count',
    type: 'symbol',
    source: 'events',
    filter: ['has', 'point_count'],
    layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Regular'], 'text-size': 12 },
    paint: { 'text-color': '#f4f7f2' }
  });
  map.addLayer({
    id: 'rec-points',
    type: 'circle',
    source: 'events',
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': ['match', ['get', 'confidence'], 'підтверджено', '#3ecf8e', 'одне джерело', '#e0b423', 'неперевірений сигнал', '#e07a6a', '#d0d0d0'],
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 4, 8, 7, 14, 9],
      'circle-stroke-width': 1.4,
      'circle-stroke-color': '#101614'
    }
  });
  map.addLayer({
    id: 'news-clusters',
    type: 'circle',
    source: 'news',
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': '#1d3348',
      'circle-radius': ['step', ['get', 'point_count'], 13, 8, 17, 24, 22],
      'circle-stroke-width': 1,
      'circle-stroke-color': '#8eb7e8'
    }
  });
  map.addLayer({
    id: 'news-count',
    type: 'symbol',
    source: 'news',
    filter: ['has', 'point_count'],
    layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Regular'], 'text-size': 12 },
    paint: { 'text-color': '#d7e7f8' }
  });
  map.addLayer({
    id: 'news-points',
    type: 'circle',
    source: 'news',
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': '#8eb7e8',
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 3.5, 8, 6, 14, 8],
      'circle-stroke-width': 1.4,
      'circle-stroke-color': '#101614'
    }
  });
  map.addLayer({
    id: 'arcs',
    type: 'line',
    source: 'arcs',
    filter: ['!=', ['get', 'speculative'], true],
    paint: {
      'line-color': ['match', ['get', 'relation'], 'географія', '#8fb9a8', 'офіційний режим', '#8eb7e8', '#e0b423'],
      'line-width': ['match', ['get', 'relation'], 'географія', 1.3, 2.3],
      'line-opacity': 0.95,
      'line-dasharray': DASH[0]
    }
  });
  map.addLayer({
    id: 'arcs-spec',
    type: 'line',
    source: 'arcs',
    filter: ['==', ['get', 'speculative'], true],
    paint: { 'line-color': '#c9a6ff', 'line-width': 2.4, 'line-dasharray': [1.2, 1.4], 'line-opacity': 0.95 }
  });
  map.addLayer({
    id: 'arc-labels',
    type: 'symbol',
    source: 'arcs',
    layout: {
      'symbol-placement': 'line-center',
      'text-field': ['get', 'why'],
      'text-font': ['Noto Sans Regular'],
      'text-size': 11,
      'text-max-width': 18,
      'text-padding': 2
    },
    paint: { 'text-color': '#f7f3ea', 'text-halo-color': '#101614', 'text-halo-width': 1.3 }
  });
  map.addLayer({
    id: 'focus',
    type: 'circle',
    source: 'focus',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 8, 8, 12, 14, 16],
      'circle-color': 'rgba(0,0,0,0)',
      'circle-stroke-width': 2,
      'circle-stroke-color': '#f4f1e6'
    }
  });
  for (const layer of map.getStyle().layers) {
    if (layer.type === 'symbol' && /country/i.test(layer.id)) {
      map.setLayoutProperty(layer.id, 'visibility', 'none');
    }
  }
}

function fly(center, zoom) {
  if (!map) return;
  map.flyTo({ center, zoom, essential: true, duration: reduceMotion ? 0 : 850 });
}

function expandCluster(feature) {
  const source = map.getSource(feature.source || feature.layer?.source);
  const center = feature.geometry.coordinates;
  const id = feature.properties.cluster_id;
  Promise.resolve(source.getClusterExpansionZoom(id))
    .then((zoom) => map.easeTo({ center, zoom: Math.min(zoom + 0.3, 14) }))
    .catch(() => map.easeTo({ center, zoom: Math.min(map.getZoom() + 1.6, 14) }));
}

function isCluster(feature) {
  const props = feature.properties || {};
  return props.cluster === true || props.cluster === 'true' || props.point_count != null;
}

function setupMap(world) {
  if (!window.maplibregl) {
    els.status.textContent = 'Бібліотека карти не завантажилась. Списки й досьє нижче працюють без глобуса.';
    return;
  }
  const canvas = document.createElement('canvas');
  const webgl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  if (!webgl) {
    els.status.textContent = 'Цей пристрій не відкрив WebGL, тож глобус недоступний. Записи лишаються у панелі.';
    return;
  }
  try {
    map = new maplibregl.Map({
    container: 'map',
    style: 'https://tiles.openfreemap.org/styles/dark',
    center: [19.4, 50.2],
    zoom: 2.65,
    minZoom: 0.8,
    maxZoom: 16,
    attributionControl: false,
    locale: {
      'NavigationControl.ZoomIn': 'Ближче',
      'NavigationControl.ZoomOut': 'Далі',
      'NavigationControl.ResetBearing': 'Скинути поворот',
      'AttributionControl.ToggleAttribution': 'Джерела карти',
      'GlobeControl.Enable': 'Глобус',
      'GlobeControl.Disable': 'Плоска карта'
    }
  });
  } catch (error) {
    els.status.textContent = 'Не вдалося відкрити карту. Списки й досьє нижче працюють.';
    return;
  }
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
  map.touchZoomRotate.disableRotation();
  let projectionSet = false;
  let globeOk = true;
  map.on('style.load', () => {
    if (!projectionSet) {
      projectionSet = true;
      try { map.setProjection({ type: 'globe' }); } catch { globeOk = false; }
    }
    if (!map.getSource('countries')) addLayers(world);
    mapReady = true;
    els.status.textContent = globeOk ? '' : 'Глобус у цій збірці карти недоступний. Лишилась плоска мапа.';
    paint();
    if (!reduceMotion && !map.__dash) {
      map.__dash = true;
      requestAnimationFrame(animateDash);
    }
  });
  map.on('click', (event) => {
    const hits = map.queryRenderedFeatures(event.point, {
      layers: existingLayers(['rec-points', 'news-points', 'clusters', 'news-clusters', 'focus'])
    });
    const cluster = hits.find(isCluster);
    if (cluster) { expandCluster(cluster); return; }
    const point = hits.find((feature) => feature.properties && feature.properties.id);
    if (point) { select(point.properties.id); return; }
    if (!map.getLayer('countries-fill')) return;
    const country = map.queryRenderedFeatures(event.point, { layers: ['countries-fill'] })[0];
    if (!country) return;
    const code = country.properties.iso_a2;
    if (code && data.records.some((record) => record.id === `c-${code}`)) select(`c-${code}`);
    else selectUnknown(country.properties);
  });
  map.on('mousemove', (event) => {
    if (!mapReady || event.originalEvent.pointerType === 'touch') return;
    const hits = map.queryRenderedFeatures(event.point, {
      layers: existingLayers(['rec-points', 'news-points', 'focus'])
    });
    const point = hits.find((feature) => feature.properties && feature.properties.id && !isCluster(feature));
    map.getCanvas().style.cursor = point || map.queryRenderedFeatures(event.point, { layers: existingLayers(['countries-fill', 'clusters', 'news-clusters']) }).length ? 'pointer' : '';
    if (!point) { els.hover.hidden = true; return; }
    const title = point.properties.title || 'Запис';
    const extra = point.properties.confidence || (point.layer.id.includes('news') ? 'новини · одне джерело' : '');
    els.hover.replaceChildren(h('strong', { text: title }), h('span', { text: extra }));
    const box = els.mapWrap.getBoundingClientRect();
    const x = Math.min(event.point.x + 12, box.width - 270);
    const y = Math.min(event.point.y + 12, box.height - 70);
    els.hover.style.left = `${Math.max(8, x)}px`;
    els.hover.style.top = `${Math.max(8, y)}px`;
    els.hover.hidden = false;
  });
  map.on('mouseleave', () => { els.hover.hidden = true; });
  map.on('move', updateMode);
  const failTimer = setTimeout(() => {
    if (!mapReady) els.status.textContent = 'Підкладка карти не відповідає. Списки й досьє працюють без тайлів. Потрібна мережа до OpenFreeMap.';
  }, 12000);
  map.on('load', () => clearTimeout(failTimer));
  new ResizeObserver(() => map.resize()).observe(els.mapWrap);
}

function animateDash(time) {
  if (mapReady && map.getLayer('arcs') && map.isStyleLoaded()) {
    const next = Math.floor(time / 70) % DASH.length;
    if (next !== dashStep) {
      dashStep = next;
      try { map.setPaintProperty('arcs', 'line-dasharray', DASH[next]); } catch { return; }
    }
  }
  requestAnimationFrame(animateDash);
}

function updateMode() {
  if (!map || !data?.mode) return;
  const zoom = map.getZoom();
  const type = map.getProjection?.()?.type;
  let mode = 'Карта';
  if (type === 'globe' && zoom < 4.2) mode = 'Глобус';
  else if (zoom >= 12) mode = 'Вулиці';
  data.mode.textContent = `Вигляд: ${mode}`;
}

function originLabel(origin) {
  if (origin === 'gdelt') return 'GDELT DOC';
  if (origin === 'google-news') return 'Google News RSS';
  return origin || 'стрічка';
}

function when(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso || '';
  return new Intl.DateTimeFormat('uk-UA', {
    timeZone: 'Europe/Warsaw',
    dateStyle: 'long',
    timeStyle: 'short'
  }).format(date);
}

function linkList(urls) {
  const box = h('div', { class: 'sources' });
  urls.forEach((url, index) => {
    const safe = safeHttpUrl(url);
    box.append(safe
      ? h('a', { href: safe, target: '_blank', rel: 'noreferrer noopener' }, [`${index + 1}. ${safe}`])
      : h('span', { text: url }));
  });
  return box;
}

function recordButton(record, extra) {
  const button = h('button', { type: 'button', class: 'block' }, [record.title]);
  button.addEventListener('click', () => select(record.id));
  const wrap = h('div', { class: 'card' }, [button]);
  if (extra) wrap.append(h('p', { class: 'note' }, [extra]));
  return wrap;
}

function renderDetails() {
  const { records, newsItems, state } = data;
  if (state.unknown) {
    return h('div', {}, [
      h('p', { class: 'kicker', text: 'територія' }),
      h('h2', { text: state.unknown.name_uk || 'Територія' }),
      h('p', { class: 'prose', text: 'Для цієї території в наборі немає числового рівня ризику: немає даних. Сірий колір не означає, що там безпечно.' }),
      state.unknown.name_en ? h('p', { class: 'note', text: state.unknown.name_en }) : h('span')
    ]);
  }
  const news = newsItems.find((item) => item.id === state.selectedId);
  if (news) return renderNews(news);
  const record = records.find((item) => item.id === state.selectedId) || records[0];
  if (!record) return h('p', { text: 'Записів немає.' });
  const bits = [
    h('p', { class: 'kicker', text: `${record.kind} · ${TYPE_LABEL[record.type] || record.type}` }),
    h('h2', { text: record.title }),
    h('p', { class: 'meta' }, [
      `${formatDate(record.date)}${record.endDate ? ` — ${formatDate(record.endDate)}` : ''}`,
      h('br'),
      record.dateKind,
      h('br'),
      record.place
    ]),
    h('div', { class: 'badge' }, [
      h('i', { style: `background:${confidenceColor(shownConfidence(record))}` }),
      shownConfidence(record)
    ]),
    h('p', { class: 'prose', text: record.description })
  ];
  if (isUnofficial(record)) {
    bits.push(h('p', { class: 'note', text: 'Неофіційний сигнал. На мапі він завжди позначений як неперевірений, навіть якщо у файлі стоїть інша мітка.' }));
  }
  if (record.avoid) bits.push(h('p', { class: 'avoid', text: `Практично: ${record.avoid}` }));
  if (record.kind === 'країна') {
    const level = record.advisory == null ? 'немає даних' : `${record.advisory} · ${['', 'звичайна обережність', 'підвищена обережність', 'переглянути поїздку', 'не подорожувати'][record.advisory]}`;
    bits.push(h('p', { class: 'note', text: `Рівень на мапі: ${level}.` }));
  }
  bits.push(h('h3', { text: 'Джерела' }), linkList(record.sources || []));
  if (record.links?.length) {
    const links = h('div', { class: 'links' });
    for (const link of record.links) {
      const other = records.find((item) => item.id === link.id);
      const button = h('button', { type: 'button', class: 'block' }, [other?.title || link.id]);
      button.addEventListener('click', () => select(link.id));
      const card = h('div', { class: 'card' }, [
        button,
        h('p', { class: link.speculative ? 'note spec' : 'note' }, [
          `${link.relation}${link.speculative ? ' · припущення' : ''}: ${link.reason}`
        ])
      ]);
      const safe = safeHttpUrl(link.source);
      if (safe) card.append(h('a', { href: safe, target: '_blank', rel: 'noreferrer noopener' }, ['Джерело зв’язку']));
      links.append(card);
    }
    bits.push(h('h3', { text: 'Зв’язки: що саме встановлено' }), links);
    bits.push(h('p', { class: 'note', text: 'Дуги на мапі ведуть до цих записів. Підпис на дузі скорочений. Напрям анімації не означає причинність. Припущення малюється фіолетовим пунктиром.' }));
  } else {
    bits.push(h('p', { class: 'note', text: 'Для цього запису доказових зв’язків з іншими мітками немає, тож дуги не малюються.' }));
  }
  return h('div', {}, bits);
}

function confidenceColor(name) {
  if (name === 'підтверджено') return '#3ecf8e';
  if (name === 'одне джерело') return '#e0b423';
  return '#e07a6a';
}

function renderNews(item) {
  const place = item.place
    ? `Приблизна прив’язка: ${item.place} (${item.geocodePrecision === 'місто' ? 'місто' : 'країна'} зі згадки в заголовку). Це не координати події.`
    : 'У заголовку немає міста чи країни з довідника, тож точки на мапі немає.';
  const safe = safeHttpUrl(item.link);
  return h('div', {}, [
    h('p', { class: 'kicker', text: `новини · ${originLabel(item.origin)}` }),
    h('h2', { text: item.title }),
    h('p', { class: 'meta' }, [when(item.published), h('br'), item.source || '']),
    h('div', { class: 'badge' }, [h('i', { style: 'background:#e0b423' }), 'одне джерело']),
    h('p', { class: 'prose', text: place }),
    h('p', { class: 'note', text: `Знайдено запитом: ${item.query || '—'}. Заголовок не переказується і не доповнюється.` }),
    safe ? h('p', {}, [h('a', { href: safe, target: '_blank', rel: 'noreferrer noopener' }, ['Відкрити джерело'])]) : h('p', { class: 'note', text: 'Посилання відсутнє.' })
  ]);
}

function renderToday() {
  const box = h('div', {}, [
    h('h2', { text: `Увага на ${formatDate(data.meta.asOf)}` }),
    h('p', { class: 'note', text: 'Редакційний список для людини в Кракові. Це не нові попередження в реальному часі й не прогноз атак.' })
  ]);
  for (const id of data.meta.todayImportant) {
    const record = data.records.find((item) => item.id === id);
    if (record) box.append(recordButton(record, record.avoid || record.description));
  }
  return box;
}

function renderPoland() {
  const box = h('div', {}, [
    h('h2', { text: 'Польща і Краків' }),
    h('p', { class: 'note', text: 'Підтвердженої в цьому наборі підстави радити залишити Краків або оминати всі торгові центри немає. Конкретні «небезпечні вулиці» з річного звіту не виводяться.' })
  ]);
  const rows = data.records.filter((record) => record.country === 'PL' && record.kind !== 'країна');
  const country = data.records.find((record) => record.id === 'c-PL');
  if (country) box.append(recordButton(country, country.description));
  for (const record of rows) box.append(recordButton(record, record.avoid || record.description));
  return box;
}

function renderNewsList() {
  const { state, newsFile } = data;
  const items = data.newsItems.filter((item) => newsVisible(item, { ...state, news: true, linksOnly: false }));
  const ok = (newsFile.sources || []).filter((source) => source.ok).length;
  const total = (newsFile.sources || []).length;
  const box = h('div', {}, [
    h('h2', { text: 'Стрічка' }),
    h('p', { class: 'note', text: newsFile.generatedAt
      ? `Зібрано ${when(newsFile.generatedAt)}. Записів у вікні ${data.newsItems.length}. Джерел відповіло ${ok} із ${total}. Кожен заголовок — одне джерело. Нічого не дописано вручну.`
      : 'Стрічку ще не зібрано. Після запуску scripts/fetch-news.mjs тут з’являться лише реально отримані заголовки.' })
  ]);
  if (!items.length) box.append(h('p', { text: 'У поточному фільтрі новин немає.' }));
  for (const item of items.slice(0, 80)) {
    const where = item.place ? ` · приблизно ${item.place}` : ' · без точки';
    box.append(recordButton(item, `${formatDate(item.date)} · ${item.source || originLabel(item.origin)}${where}`));
  }
  if (items.length > 80) box.append(h('p', { class: 'note', text: `Показано 80 із ${items.length}. Звузьте пошук або дати.` }));
  return box;
}

function renderList() {
  const { records, state } = data;
  const linked = linkedIdSet(records, state.selectedId);
  const rows = records.filter((record) => recordVisible(record, state, linked) && record.kind !== 'країна');
  const box = h('div', {}, [
    h('h2', { text: 'Видимі записи' }),
    h('p', { class: 'note', text: rows.length ? `Записів: ${rows.length}. Країни відкриваються дотиком до заливки.` : 'Нічого не потрапило у фільтр.' })
  ]);
  for (const record of rows) {
    box.append(recordButton(record, `${formatDate(record.date)} · ${TYPE_LABEL[record.type] || record.type} · ${shownConfidence(record)}`));
  }
  return box;
}

function renderHelp() {
  const paragraphs = [
    'Це довідка про рівні ризику й окремі сигнали станом на дату знімка. Вона не передбачає конкретну атаку, не є попередженням поліції і не радить залишати Краків.',
    'Колір країни — туристичний рівень США від 1 до 4, якщо він є у файлі країн. Сірий колір і слова «немає даних» означають, що числового рівня в наборі немає. Це не оцінка «безпечно».',
    'Колір мітки події — це підтвердження: підтверджено, одне джерело або неперевірений сигнал.',
    'Шар «Неофіційні сигнали» зібраний для постів X, каналів Telegram і місцевих новин. На мапі вони завжди підписані як неперевірені.',
    'Шар «Новини» наповнює щоденний скрипт із RSS Google News і GDELT. Заголовок не переписується. Точка з’являється лише тоді, коли в заголовку знайдено місто або країну з довідника.',
    'Дуга з’єднує пов’язані записи й має коротке пояснення, чому зв’язок проведено. Повний текст є в досьє. Фіолетовий пунктир — припущення. Географія не означає спільного виконавця.',
    'Ступені BRAVO і CHARLIE в Польщі — превентивний режим, не повідомлення про атаку в Кракові.',
    'Назви країн на глобусі українські. Підписи вулиць на великому масштабі бере OpenStreetMap місцевою мовою. Контури — узагальнення Natural Earth, не юридичний кордон.',
    'Коефіцієнти вбивств історичні й не включають воєнні втрати. Вони не вимірюють особистий ризик сьогодні. Одним пальцем рухайте мапу, двома змінюйте масштаб.'
  ];
  const box = h('div', {}, [h('h2', { text: 'Як це читати' })]);
  for (const text of paragraphs) box.append(h('p', { class: 'prose', text }));
  const previous = safeHttpUrl(data.meta.previousPage);
  if (previous) box.append(h('p', {}, [h('a', { href: previous, target: '_blank', rel: 'noreferrer noopener' }, ['Попередня таблиця-прототип'])]));
  box.append(h('p', { class: 'note', text: 'Тайли: OpenFreeMap, OpenMapTiles, OpenStreetMap. Межі країн: Natural Earth через world-atlas.' }));
  return box;
}

function renderPanel() {
  const view = {
    details: renderDetails,
    today: renderToday,
    poland: renderPoland,
    news: renderNewsList,
    list: renderList,
    help: renderHelp
  }[data.state.panel] || renderDetails;
  els.panel.replaceChildren(view());
  for (const button of els.tabs.querySelectorAll('.tab')) {
    const on = button.dataset.tab === data.state.panel;
    button.classList.toggle('on', on);
    button.setAttribute('aria-selected', on ? 'true' : 'false');
  }
}

function currentTitle() {
  const { records, newsItems, state } = data;
  if (state.unknown) return state.unknown.name_uk || 'Немає даних';
  return newsItems.find((item) => item.id === state.selectedId)?.title
    || records.find((record) => record.id === state.selectedId)?.title
    || 'Оберіть мітку';
}

function paintPeek() {
  const { records, newsItems, state } = data;
  const record = records.find((item) => item.id === state.selectedId);
  const news = newsItems.find((item) => item.id === state.selectedId);
  const detail = state.unknown
    ? 'немає даних'
    : news
      ? 'новини · одне джерело'
      : record
        ? `${TYPE_LABEL[record.type] || record.type} · ${shownConfidence(record)}`
        : '';
  els.peek.replaceChildren(h('strong', { text: currentTitle() }), h('span', { text: detail }));
}

function paintControls() {
  const { state } = data;
  for (const type of TYPES) {
    const button = data.chips[type];
    const on = state.types.includes(type);
    button.classList.toggle('on', on);
    button.setAttribute('aria-pressed', String(on));
  }
  for (const key of ['unofficial', 'news', 'showCountries', 'showCountryDots', 'persistent', 'futureDates', 'linksOnly']) {
    const button = data.chips[key];
    button.classList.toggle('on', state[key]);
    button.setAttribute('aria-pressed', String(state[key]));
  }
  data.count.textContent = `У фільтрі: ${data.visibleCount || 0}`;
  data.fromLabel.textContent = formatDate(state.from);
  data.toLabel.textContent = formatDate(state.to);
  if (document.activeElement !== data.fromInput) data.fromInput.value = String(dayNumber(state.from));
  if (document.activeElement !== data.toInput) data.toInput.value = String(dayNumber(state.to));
}

function countVisible() {
  const { records, state } = data;
  const linked = linkedIdSet(records, state.selectedId);
  const recordCount = records.filter((record) => recordVisible(record, state, linked)).length;
  const newsCount = data.newsItems.filter((item) => newsVisible(item, state) && item.lat != null).length;
  data.visibleCount = recordCount + newsCount;
}

function paint() {
  countVisible();
  paintMap();
  paintControls();
  paintPeek();
  renderPanel();
  updateMode();
}

function select(id, { flyTo = true, hash = true } = {}) {
  if (!data.records.some((record) => record.id === id) && !data.newsItems.some((item) => item.id === id)) return;
  data.state.selectedId = id;
  data.state.unknown = null;
  data.state.panel = data.newsItems.some((item) => item.id === id) && data.state.panel === 'news' ? 'news' : 'details';
  if (hash) {
    const next = `#${encodeURIComponent(id)}`;
    if (location.hash !== next) history.replaceState(null, '', next);
  }
  els.live.textContent = currentTitle();
  if (mobileQuery.matches && els.sheet.dataset.snap === 'peek') setSnap('half');
  paint();
  if (!flyTo || !map) return;
  const record = data.records.find((item) => item.id === id);
  const news = data.newsItems.find((item) => item.id === id);
  const lon = record?.lon ?? news?.lon;
  const lat = record?.lat ?? news?.lat;
  if (Number.isFinite(lon) && Number.isFinite(lat)) {
    const zoom = map.getZoom();
    fly([lon, lat], zoom < 2.4 ? 3.6 : zoom);
  }
}

function selectUnknown(properties) {
  data.state.unknown = { name_uk: properties.name_uk, name_en: properties.name_en };
  data.state.selectedId = '';
  data.state.panel = 'details';
  if (mobileQuery.matches) setSnap('half');
  els.live.textContent = properties.name_uk || 'Немає даних';
  paint();
}

function chip(id, label, on, toggle) {
  const button = h('button', { type: 'button', class: on ? 'chip on' : 'chip', 'aria-pressed': String(on) }, [label]);
  button.addEventListener('click', toggle);
  data.chips[id] = button;
  return button;
}

function buildShell() {
  const { meta, records, newsItems, state } = data;
  data.chips = {};
  const layers = h('div', { class: 'row' });
  for (const type of TYPES) {
    const count = records.filter((record) => record.type === type && record.kind !== 'країна').length;
    layers.append(chip(type, `${TYPE_LABEL[type]} · ${count}`, state.types.includes(type), () => {
      state.types = state.types.includes(type) ? state.types.filter((item) => item !== type) : [...state.types, type];
      paint();
    }));
  }
  const unofficialCount = records.filter(isUnofficial).length;
  layers.append(chip('unofficial', `Неофіційні сигнали · ${unofficialCount}`, state.unofficial, () => {
    state.unofficial = !state.unofficial;
    paint();
  }));
  layers.append(chip('news', `Новини · ${newsItems.length}`, state.news, () => {
    state.news = !state.news;
    paint();
  }));
  const search = h('input', { type: 'search', placeholder: 'Країна, подія, місто…', 'aria-label': 'Пошук' });
  let timer = 0;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.q = search.value.trim();
      paint();
    }, 80);
  });
  const confidence = h('select', { 'aria-label': 'Підтвердження' });
  for (const name of ['Усі', ...CONFIDENCES]) confidence.append(h('option', { value: name, text: name }));
  confidence.addEventListener('change', () => {
    state.confidence = confidence.value;
    paint();
  });
  const toggles = h('div', { class: 'row' });
  const toggle = (id, label, key) => toggles.append(chip(id, label, state[key], () => {
    state[key] = !state[key];
    paint();
  }));
  toggle('showCountries', 'Країни', 'showCountries');
  toggle('showCountryDots', 'Центри країн', 'showCountryDots');
  toggle('persistent', 'Довідкові шари', 'persistent');
  toggle('futureDates', 'Календар наперед', 'futureDates');
  toggle('linksOnly', 'Лише зв’язки', 'linksOnly');
  data.count = h('span', { class: 'note', text: '' });
  els.filters.replaceChildren(
    layers,
    h('div', { class: 'row' }, [
      h('label', { class: 'field grow' }, ['Пошук', search]),
      h('label', { class: 'field' }, ['Підтвердження', confidence]),
      data.count
    ]),
    toggles
  );
  for (const [id, label] of TABS) {
    const button = h('button', { type: 'button', class: 'tab', role: 'tab', 'data-tab': id, text: label });
    button.addEventListener('click', () => {
      state.panel = id;
      if (id === 'poland') fly([19.4, 51.8], 5.3);
      if (mobileQuery.matches) setSnap('half');
      paint();
    });
    els.tabs.append(button);
  }
  const min = dayNumber(data.bounds.min);
  const max = dayNumber(data.bounds.max);
  const from = h('input', { type: 'range', min: String(min), max: String(max), value: String(dayNumber(state.from)), 'aria-label': 'Початок періоду' });
  const to = h('input', { type: 'range', min: String(min), max: String(max), value: String(dayNumber(state.to)), 'aria-label': 'Кінець періоду' });
  data.fromInput = from;
  data.toInput = to;
  data.fromLabel = h('span', { text: formatDate(state.from) });
  data.toLabel = h('span', { text: formatDate(state.to) });
  const clamp = () => {
    state.from = dateAt(Number(from.value));
    state.to = dateAt(Number(to.value));
    if (state.from > state.to) {
      if (document.activeElement === from) state.to = state.from;
      else state.from = state.to;
    }
    paint();
  };
  from.addEventListener('input', clamp);
  to.addEventListener('input', clamp);
  data.mode = h('span', { text: 'Вигляд: Глобус' });
  els.timeline.replaceChildren(
    h('p', {}, ['Період: ', data.fromLabel, ' — ', data.toLabel]),
    from,
    to,
    h('div', { class: 'scale' }, [h('span', { text: formatDate(data.bounds.min) }), data.mode, h('span', { text: formatDate(data.bounds.max) })])
  );
  const tool = (label, action) => {
    const button = h('button', { type: 'button', class: 'tool', text: label });
    button.addEventListener('click', action);
    return button;
  };
  let globe = true;
  const projection = tool('Плоска карта', () => {
    globe = !globe;
    projection.textContent = globe ? 'Плоска карта' : 'Глобус';
    if (map) {
      try { map.setProjection({ type: globe ? 'globe' : 'mercator' }); } catch { /* залишаємо поточну проєкцію */ }
      updateMode();
    }
  });
  els.tools.replaceChildren(
    tool('+', () => map && map.zoomIn()),
    tool('−', () => map && map.zoomOut()),
    tool('Світ', () => {
      globe = true;
      projection.textContent = 'Плоска карта';
      if (map) try { map.setProjection({ type: 'globe' }); } catch { /* ignore */ }
      fly([12, 18], 1.35);
    }),
    tool('Польща', () => {
      state.panel = 'poland';
      if (mobileQuery.matches) setSnap('half');
      paint();
      fly([19.4, 51.8], 5.3);
    }),
    tool('Вулиці Кракова', () => fly([19.9373, 50.0617], 14.2)),
    projection
  );
  els.asof.textContent = `Знімок ${formatDate(meta.asOf)}, ${meta.zone}. Країн із рівнем: ${data.countries.length}. Сірі території — немає даних.`;
}

function readHash() {
  const id = decodeURIComponent(location.hash.replace(/^#/, ''));
  if (!id) return;
  if (data.records.some((record) => record.id === id) || data.newsItems.some((item) => item.id === id)) {
    data.state.selectedId = id;
  }
}

async function main() {
  try {
    const [meta, countries, stored, editorial, world, centroids, newsFile] = await Promise.all([
      loadJson('data/meta.json'),
      loadJson('data/countries.json'),
      loadJson('data/records.json'),
      loadJson('data/links.json'),
      loadJson('data/world.geojson'),
      loadJson('data/centroids.json'),
      loadJson('data/news.json')
    ]);
    const records = attachLinks(buildRecords(countries, stored, meta), editorial);
    const newsItems = Array.isArray(newsFile.items) ? newsFile.items : [];
    let min = meta.from;
    let max = meta.to;
    for (const item of newsItems) {
      if (item.date && item.date < min) min = item.date;
      if (item.date && item.date > max) max = item.date;
    }
    data = {
      meta,
      countries,
      records,
      newsFile,
      newsItems,
      world,
      centroids,
      byCode: new Map(countries.map((row) => [row.code, row])),
      bounds: { min, max },
      visibleCount: 0,
      state: {
        types: [...TYPES],
        unofficial: true,
        news: true,
        confidence: 'Усі',
        q: '',
        from: meta.from,
        to: meta.to,
        persistent: true,
        futureDates: true,
        showCountries: true,
        showCountryDots: false,
        linksOnly: false,
        selectedId: records.some((record) => record.id === 't-poland') ? 't-poland' : records[0]?.id || '',
        panel: 'details',
        unknown: null
      }
    };
    readHash();
    buildShell();
    paint();
    setupMap(world);
    window.addEventListener('hashchange', () => {
      const id = decodeURIComponent(location.hash.replace(/^#/, ''));
      if (id && id !== data.state.selectedId) select(id, { hash: false });
    });
  } catch (error) {
    els.status.textContent = 'Не вдалося прочитати файли даних.';
    els.panel.replaceChildren(h('p', { text: `Помилка завантаження: ${error.message}` }));
  }
}

main();
