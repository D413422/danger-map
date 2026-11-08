import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { feature } from 'topojson-client';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const topoPath = process.argv[2];
const isoPath = process.argv[3];
if (!topoPath || !isoPath) {
  console.error('usage: node scripts/build-world.mjs <countries-50m.json> <iso.json>');
  console.error('topojson-client must be installed (npm install topojson-client)');
  process.exit(1);
}

const names = JSON.parse(fs.readFileSync(path.join(root, 'scripts/names-uk.json'), 'utf8'));
const countries = JSON.parse(fs.readFileSync(path.join(root, 'data/countries.json'), 'utf8'));
const topo = JSON.parse(fs.readFileSync(topoPath, 'utf8'));
const isoRows = JSON.parse(fs.readFileSync(isoPath, 'utf8'));
const isoByNumeric = new Map(isoRows.map((row) => [String(row['country-code']).padStart(3, '0'), row['alpha-2']]));

const EXTRA = {
  PL: ['Polska', 'Польщі', 'Польщу', 'Польщею', 'в Польщі'],
  UA: ['Ukraine', 'України', 'Україні', 'Україну'],
  RU: ['Russia', 'Rosja', 'Росії', 'Росію', 'Росії'],
  DE: ['Germany', 'Niemcy', 'Німеччини', 'Німеччині', 'Німеччину'],
  FR: ['France', 'Francja', 'Франції', 'Францію'],
  GB: ['United Kingdom', 'Britain', 'UK', 'Wielka Brytania', 'Британія', 'Британії'],
  US: ['United States', 'USA', 'U.S.', 'Stany Zjednoczone', 'США'],
  IL: ['Israel', 'Izrael', 'Ізраїлю', 'Ізраїлі'],
  PS: ['Palestine', 'Gaza', 'Газа', 'Гази', 'Палестина', 'Палестини'],
  IR: ['Iran', 'Ірану', 'Ірані'],
  IQ: ['Iraq', 'Irak', 'Іраку', 'Іраці'],
  SY: ['Syria', 'Syria', 'Сирії', 'Сирію'],
  LB: ['Lebanon', 'Liban', 'Лівану', 'Лівані'],
  TR: ['Turkey', 'Türkiye', 'Turcja', 'Туреччини', 'Туреччині'],
  BY: ['Belarus', 'Białoruś', 'Білорусі', 'Білорусь'],
  CZ: ['Czechia', 'Czech Republic', 'Czechy', 'Чехії', 'Чехію'],
  SK: ['Slovakia', 'Słowacja', 'Словаччини', 'Словаччині'],
  HU: ['Hungary', 'Węgry', 'Угорщини', 'Угорщині'],
  RO: ['Romania', 'Rumunia', 'Румунії', 'Румунію'],
  MD: ['Moldova', 'Mołdawia', 'Молдови', 'Молдові'],
  LT: ['Lithuania', 'Litwa', 'Литви', 'Литві'],
  LV: ['Latvia', 'Łotwa', 'Латвії', 'Латвію'],
  EE: ['Estonia', 'Estonia', 'Естонії', 'Естонію'],
  AT: ['Austria', 'Австрії', 'Австрію'],
  CH: ['Switzerland', 'Szwajcaria', 'Швейцарії', 'Швейцарію'],
  IT: ['Italy', 'Włochy', 'Італії', 'Італію'],
  ES: ['Spain', 'Hiszpania', 'Іспанії', 'Іспанію'],
  PT: ['Portugal', 'Portugalia', 'Португалії', 'Португалію'],
  NL: ['Netherlands', 'Holland', 'Holandia', 'Нідерландів', 'Нідерландах'],
  BE: ['Belgium', 'Belgia', 'Бельгії', 'Бельгію'],
  SE: ['Sweden', 'Szwecja', 'Швеції', 'Швецію'],
  NO: ['Norway', 'Norwegia', 'Норвегії', 'Норвегію'],
  FI: ['Finland', 'Finlandia', 'Фінляндії', 'Фінляндію'],
  DK: ['Denmark', 'Dania', 'Данії', 'Данію'],
  GR: ['Greece', 'Grecja', 'Греції', 'Грецію'],
  CN: ['China', 'Chiny', 'Китаю', 'Китаї'],
  JP: ['Japan', 'Japonia', 'Японії', 'Японію'],
  KR: ['South Korea', 'Korea Południowa'],
  KP: ['North Korea', 'Korea Północna'],
  IN: ['India', 'Indie', 'Індії', 'Індію'],
  PK: ['Pakistan', 'Пакистану', 'Пакистані'],
  AF: ['Afghanistan', 'Afganistan', 'Афганістану', 'Афганістані'],
  EG: ['Egypt', 'Egipt', 'Єгипту', 'Єгипті'],
  ZA: ['South Africa', 'RPA'],
  BR: ['Brazil', 'Brazylia', 'Бразилії', 'Бразилію'],
  MX: ['Mexico', 'Meksyk', 'Мексики', 'Мексиці'],
  CA: ['Canada', 'Kanada', 'Канади', 'Канаді'],
  AU: ['Australia', 'Австралії', 'Австралію'],
  AE: ['UAE', 'United Arab Emirates', 'ОАЕ'],
  SA: ['Saudi Arabia', 'Arabia Saudyjska'],
  YE: ['Yemen', 'Jemen', 'Ємену', 'Ємені'],
  JO: ['Jordan', 'Jordania', 'Йорданії', 'Йорданію'],
  GE: ['Gruzja', 'Грузії', 'Грузію', 'Tbilisi'],
  AM: ['Armenia', 'Вірменії', 'Вірменію'],
  AZ: ['Azerbaijan', 'Azerbejdżan', 'Азербайджану', 'Азербайджані'],
  RS: ['Serbia', 'Сербії', 'Сербію'],
  BA: ['Bosnia', 'Bośnia', 'Боснії'],
  XK: ['Kosovo', 'Kosowa', 'Косово', 'Косова'],
  MK: ['North Macedonia', 'Macedonia', 'Македонія', 'Македонії']
};

function roundCoord(pair) {
  pair[0] = Math.round(pair[0] * 1000) / 1000;
  pair[1] = Math.round(pair[1] * 1000) / 1000;
}

function walk(coords) {
  if (typeof coords[0] === 'number') {
    roundCoord(coords);
    return;
  }
  for (const part of coords) walk(part);
}

function ringArea(ring) {
  let area = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return area / 2;
}

function ringCentroid(ring) {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    const cross = x1 * y2 - x2 * y1;
    area += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  area *= 0.5;
  if (Math.abs(area) < 1e-8) {
    let sx = 0;
    let sy = 0;
    const n = Math.max(1, ring.length - 1);
    for (let i = 0; i < n; i += 1) {
      sx += ring[i][0];
      sy += ring[i][1];
    }
    return [sx / n, sy / n];
  }
  return [cx / (6 * area), cy / (6 * area)];
}

function unwrapRing(ring) {
  const lons = ring.map((pair) => pair[0]);
  const span = Math.max(...lons) - Math.min(...lons);
  if (span <= 180) return ring;
  return ring.map(([lon, lat]) => [lon < 0 ? lon + 360 : lon, lat]);
}

function wrapLon(lon) {
  let value = lon;
  while (value > 180) value -= 360;
  while (value < -180) value += 360;
  return value;
}

function largestRing(geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  let best = null;
  let bestArea = -1;
  for (const polygon of polygons) {
    const ring = polygon[0];
    if (!ring || ring.length < 4) continue;
    const area = Math.abs(ringArea(unwrapRing(ring)));
    if (area > bestArea) {
      bestArea = area;
      best = ring;
    }
  }
  return best;
}

function isoFor(geometry) {
  const name = geometry.properties.name;
  const named = names[name];
  if (named?.iso) return named.iso;
  if (geometry.id == null) return '';
  const numeric = String(geometry.id).padStart(3, '0');
  return isoByNumeric.get(numeric) || '';
}

const collection = feature(topo, topo.objects.countries);
const missingNames = [];
const seenIso = new Map();

for (const item of collection.features) {
  const name = item.properties.name;
  const entry = names[name];
  if (!entry) missingNames.push(name);
  const iso = isoFor(item);
  walk(item.geometry.coordinates);
  const ring = largestRing(item.geometry);
  const [rawLon, rawLat] = ring ? ringCentroid(unwrapRing(ring)) : [0, 0];
  const lon = wrapLon(rawLon);
  const lat = Math.max(-85, Math.min(85, rawLat));
  item.properties = {
    name_en: name,
    name_uk: entry ? entry.uk : name,
    iso_a2: iso,
    label_lon: Math.round(lon * 1000) / 1000,
    label_lat: Math.round(lat * 1000) / 1000
  };
  delete item.id;
  if (iso) {
    if (!seenIso.has(iso)) seenIso.set(iso, []);
    seenIso.get(iso).push(name);
  }
}

if (missingNames.length) {
  console.error('missing Ukrainian names:', missingNames.join(', '));
  process.exit(1);
}

const wanted = new Set(countries.map((row) => row.code));
const absent = [...wanted].filter((code) => !seenIso.has(code));
if (absent.length) {
  console.error('country codes without a polygon:', absent.join(', '));
  process.exit(1);
}

const centroids = collection.features.map((item) => {
  const code = item.properties.iso_a2 || null;
  const aliases = new Set([item.properties.name_uk, item.properties.name_en]);
  for (const alias of EXTRA[code] || []) aliases.add(alias);
  return {
    code,
    name_uk: item.properties.name_uk,
    name_en: item.properties.name_en,
    lat: item.properties.label_lat,
    lon: item.properties.label_lon,
    aliases: [...aliases].filter(Boolean)
  };
});

fs.writeFileSync(path.join(root, 'data/world.geojson'), `${JSON.stringify(collection)}\n`);
fs.writeFileSync(path.join(root, 'data/centroids.json'), `${JSON.stringify(centroids, null, 2)}\n`);

const size = fs.statSync(path.join(root, 'data/world.geojson')).size;
console.log(
  JSON.stringify(
    {
      features: collection.features.length,
      withIso: [...seenIso.keys()].length,
      bytes: size,
      sample: {
        PL: centroids.find((row) => row.code === 'PL'),
        RU: centroids.find((row) => row.code === 'RU'),
        US: centroids.find((row) => row.code === 'US'),
        XK: centroids.find((row) => row.code === 'XK')
      }
    },
    null,
    2
  )
);
