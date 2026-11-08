export const TYPES = ['терор', 'війни', 'кримінал', 'кібер/банки', 'протести', 'політика'];

export const TYPE_LABEL = {
  'терор': 'тероризм',
  'війни': 'війни',
  'кримінал': 'кримінал',
  'кібер/банки': 'кібер/банки',
  'протести': 'протести',
  'політика': 'політика'
};

export const CONFIDENCES = ['неперевірений сигнал', 'одне джерело', 'підтверджено'];

export const RISK_COLOR = {
  1: '#2f9d6e',
  2: '#e0b423',
  3: '#e07a32',
  4: '#d4534c',
  0: '#5c6862'
};

export const RISK_LABEL = {
  1: 'звичайна обережність',
  2: 'підвищена обережність',
  3: 'переглянути поїздку',
  4: 'не подорожувати',
  0: 'немає даних'
};

export const UNOFFICIAL_SOURCES = new Set(['X', 'telegram', 'неофіційне', 'місцеві новини']);

const DAY = 86400000;

export function dayNumber(iso) {
  return Math.round(Date.parse(`${iso}T12:00:00Z`) / DAY);
}

export function dateAt(day) {
  return new Date(day * DAY).toISOString().slice(0, 10);
}

export function isUnofficial(record) {
  return UNOFFICIAL_SOURCES.has(record.sourceKind);
}

export function shownConfidence(record) {
  return isUnofficial(record) ? 'неперевірений сигнал' : record.confidence;
}

export function countryRecord(row, meta) {
  const level = row.advisory == null
    ? 'Власного туристичного рейтингу США немає.'
    : `Туристичний рівень США ${row.advisory} із 4. `;
  const homicide = row.homicidePer100k == null
    ? ' Загального коефіцієнта вбивств UK не внесено.'
    : ` Умисні вбивства: ${row.homicidePer100k} на 100 тис., ${row.homicideYear} рік; UNODC через вторинну таблицю, без воєнних втрат. Це не вимір нинішнього персонального ризику.`;
  return {
    id: `c-${row.code}`,
    title: row.name,
    date: meta.asOf,
    dateKind: 'дата знімка рекомендації, не початок небезпеки',
    place: row.name,
    lat: row.lat,
    lon: row.lon,
    type: 'політика',
    confidence: 'підтверджено',
    description: `${level}${row.notes}${homicide}`,
    sources: [
      row.code === 'US'
        ? 'https://www.gov.uk/foreign-travel-advice/usa/safety-and-security'
        : meta.advisory,
      meta.homicide
    ],
    country: row.code,
    kind: 'країна',
    sourceKind: 'офіційне',
    links: [],
    advisory: row.advisory
  };
}

export function buildRecords(countries, records, meta) {
  return [...countries.map((row) => countryRecord(row, meta)), ...records.map((row) => ({ ...row, links: [...(row.links || [])] }))];
}

function pushLink(record, link) {
  const key = `${link.id}|${link.relation}|${link.reason}`;
  if (record.links.some((item) => `${item.id}|${item.relation}|${item.reason}` === key)) return;
  record.links.push(link);
}

export function attachLinks(records, editorial) {
  const byId = new Map(records.map((record) => [record.id, record]));
  const edges = editorial.map((edge) => ({ ...edge }));
  for (const record of records) {
    if (record.kind === 'країна' || !record.country || !byId.has(`c-${record.country}`)) continue;
    edges.push({
      from: record.id,
      to: `c-${record.country}`,
      reason: `Географічний контекст: ${record.place}. Не означає спільного виконавця, причинного зв’язку чи загрози всій країні.`,
      relation: 'географія',
      source: record.sources[0],
      speculative: false
    });
  }
  for (const edge of edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) continue;
    const link = {
      reason: edge.reason,
      relation: edge.relation,
      source: edge.source,
      speculative: !!edge.speculative
    };
    pushLink(from, { ...link, id: edge.to });
    pushLink(to, { ...link, id: edge.from });
  }
  return records;
}

function isPersistent(record) {
  return record.kind === 'країна' || record.kind === 'режим' || record.kind === 'локально';
}

export function recordVisible(record, state, linked) {
  if (record.kind === 'країна' && !state.showCountryDots) return false;
  if (record.type && !state.types.includes(record.type)) return false;
  if (isUnofficial(record) && !state.unofficial) return false;
  if (state.confidence !== 'Усі' && shownConfidence(record) !== state.confidence) return false;
  if (state.q) {
    const blob = `${record.title} ${record.place} ${record.description}`.toLocaleLowerCase('uk');
    if (!blob.includes(state.q.toLocaleLowerCase('uk'))) return false;
  }
  if (state.linksOnly && record.id !== state.selectedId && !linked.has(record.id)) return false;
  if (isPersistent(record) && state.persistent) {
    if (!record.endDate) return record.date <= state.to;
    return record.date <= state.to && record.endDate >= state.from;
  }
  if (record.kind === 'календар' && state.futureDates) return (record.endDate || record.date) >= state.from;
  const end = record.endDate || record.date;
  return record.date <= state.to && end >= state.from;
}

export function newsVisible(item, state) {
  if (!state.news) return false;
  if (state.linksOnly) return item.id === state.selectedId;
  if (state.confidence !== 'Усі' && item.confidence !== state.confidence) return false;
  if (state.q) {
    const blob = `${item.title} ${item.source || ''} ${item.place || ''} ${item.query || ''}`.toLocaleLowerCase('uk');
    if (!blob.includes(state.q.toLocaleLowerCase('uk'))) return false;
  }
  return item.date >= state.from && item.date <= state.to;
}

export function linkedIdSet(records, selectedId) {
  const selected = records.find((record) => record.id === selectedId);
  return new Set((selected?.links || []).map((link) => link.id));
}

export function visibleRecords(records, state) {
  const linked = linkedIdSet(records, state.selectedId);
  return records.filter((record) => recordVisible(record, state, linked));
}

function toVec(lon, lat) {
  const lambda = (lon * Math.PI) / 180;
  const phi = (lat * Math.PI) / 180;
  return [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi)];
}

function fromVec(vector) {
  const lat = (Math.atan2(vector[2], Math.hypot(vector[0], vector[1])) * 180) / Math.PI;
  const lon = (Math.atan2(vector[1], vector[0]) * 180) / Math.PI;
  return [lon, lat];
}

function slerp(a, b, t) {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  dot = Math.min(1, Math.max(-1, dot));
  const omega = Math.acos(dot);
  if (omega < 1e-6) return a.slice();
  const scale = Math.sin(omega);
  const f1 = Math.sin((1 - t) * omega) / scale;
  const f2 = Math.sin(t * omega) / scale;
  return [a[0] * f1 + b[0] * f2, a[1] * f1 + b[1] * f2, a[2] * f1 + b[2] * f2];
}

export function geodesic(start, end, steps = 72) {
  const a = toVec(start[0], start[1]);
  const b = toVec(end[0], end[1]);
  const line = [];
  for (let i = 0; i <= steps; i += 1) line.push(fromVec(slerp(a, b, i / steps)));
  const parts = [[]];
  for (const point of line) {
    const previous = parts.at(-1).at(-1);
    if (previous && Math.abs(point[0] - previous[0]) > 180) parts.push([]);
    parts.at(-1).push(point);
  }
  return parts.filter((part) => part.length > 1);
}

export function arcCollection(selected, records) {
  if (!selected) return { type: 'FeatureCollection', features: [] };
  const byId = new Map(records.map((record) => [record.id, record]));
  const features = [];
  for (const link of selected.links || []) {
    const other = byId.get(link.id);
    if (!other) continue;
    const why = link.reason.length > 110 ? `${link.reason.slice(0, 107)}…` : link.reason;
    features.push({
      type: 'Feature',
      geometry: { type: 'MultiLineString', coordinates: geodesic([selected.lon, selected.lat], [other.lon, other.lat]) },
      properties: {
        id: link.id,
        relation: link.relation,
        speculative: !!link.speculative,
        why: link.speculative ? `припущення · ${why}` : why
      }
    });
  }
  return { type: 'FeatureCollection', features };
}

export function safeHttpUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
  } catch {
    return null;
  }
  return null;
}

export function formatDate(iso) {
  if (!iso) return '';
  const [year, month, day] = iso.split('-').map(Number);
  const months = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];
  if (!year || !month || !day) return iso;
  return `${day} ${months[month - 1]} ${year}`;
}
