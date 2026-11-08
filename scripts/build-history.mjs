import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { geocode, loadGazetteer } from './fetch-news.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'data/history');
const FIRST_YEAR = 2004;

const UCDP_ISO = {
  'DR Congo (Zaire)': 'CD',
  'Myanmar (Burma)': 'MM',
  'Yemen (North Yemen)': 'YE',
  'Russia (Soviet Union)': 'RU',
  'Ivory Coast': 'CI',
  'Kingdom of eSwatini (Swaziland)': 'SZ',
  'Cambodia (Kampuchea)': 'KH',
  'Zimbabwe (Rhodesia)': 'ZW',
  'Madagascar (Malagasy)': 'MG',
  'Central African Republic': 'CF',
  'South Sudan': 'SS',
  'United States of America': 'US',
  'United Kingdom': 'GB',
  'United Arab Emirates': 'AE',
  'South Africa': 'ZA',
  'Papua New Guinea': 'PG',
  'Sri Lanka': 'LK',
  'Burkina Faso': 'BF',
  'El Salvador': 'SV',
  'Costa Rica': 'CR',
  'Saudi Arabia': 'SA',
  'Sierra Leone': 'SL',
  'Bosnia-Herzegovina': 'BA',
  'Serbia (Yugoslavia)': 'RS',
  'North Macedonia': 'MK',
  'Solomon Islands': 'SB'
};

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12
};

export function stripWiki(value) {
  return String(value || '')
    .replace(/<ref\b[^>]*\/>/gi, ' ')
    .replace(/<ref\b[\s\S]*?<\/ref>/gi, ' ')
    .replace(/\{\{[\s\S]*?\}\}/g, ' ')
    .replace(/\[\[(?:[^|\]]+\|)?([^\]]+)\]\]/g, '$1')
    .replace(/'''?/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseDeaths(value) {
  const clean = stripWiki(value).replace(/,/g, '');
  const tail = clean.split('|').pop() || clean;
  const match = tail.match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

export function parseWikiDate(value, fallbackYear) {
  const clean = stripWiki(value);
  let match = clean.match(/\b(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?/);
  if (match && MONTHS[match[2].toLowerCase()]) {
    const year = Number(match[3] || fallbackYear);
    return isoDate(year, MONTHS[match[2].toLowerCase()], Number(match[1]));
  }
  match = clean.match(/\b([A-Za-z]+)\s+(\d{1,2})(?:\s*[–-]\s*\d{1,2})?(?:,\s*(\d{4}))?/);
  if (match && MONTHS[match[1].toLowerCase()]) {
    const year = Number(match[3] || fallbackYear);
    return isoDate(year, MONTHS[match[1].toLowerCase()], Number(match[2]));
  }
  return null;
}

function isoDate(year, month, day) {
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function splitCells(line) {
  return line.split(/\|\||!!/).map((cell) => cell.trim()).filter((cell) => cell.length);
}

export function parseWikiIncidents(wikitext, year) {
  const events = [];
  for (const chunk of String(wikitext || '').split('{|')) {
    const head = chunk.slice(0, 700);
    if (!/date/i.test(head) || !/dead|kill|fatal|casualt/i.test(head)) continue;
    const body = chunk.split('\n|}')[0];
    let headers = [];
    let cells = [];
    let headerLocked = false;
    const flush = () => {
      const incident = incidentFromRow(headers, cells, year);
      if (incident) events.push(incident);
      cells = [];
    };
    for (const line of body.split('\n')) {
      if (line.startsWith('|-')) {
        flush();
        continue;
      }
      if (line.startsWith('!') && !headerLocked) {
        let text = line.replace(/^!+/, '').trim();
        const pieces = text.includes('!!') ? text.split('!!') : [text];
        headers.push(...pieces.map((piece) => {
          const pipe = piece.lastIndexOf('|');
          return (pipe >= 0 ? piece.slice(pipe + 1) : piece).trim();
        }));
        continue;
      }
      if (line.startsWith('|')) {
        headerLocked = true;
        cells.push(...splitCells(line.slice(1)));
      } else if (cells.length) {
        cells[cells.length - 1] = `${cells[cells.length - 1]} ${line}`.trim();
      }
    }
    flush();
  }
  return events;
}

function columnIndex(headers, pattern) {
  return headers.findIndex((header) => pattern.test(stripWiki(header)));
}

function incidentFromRow(headers, cells, year) {
  if (!headers.length || cells.length < 2) return null;
  const dateIndex = columnIndex(headers, /^date/i);
  const deathIndex = columnIndex(headers, /dead|killed|fatal|casualt/i);
  const placeIndex = columnIndex(headers, /location|city|country/i);
  const textIndex = columnIndex(headers, /desc|detail|incident|summary/i);
  const articleIndex = columnIndex(headers, /^article/i);
  if (dateIndex < 0 || placeIndex < 0) return null;
  const date = parseWikiDate(cells[dateIndex] || '', year);
  const place = stripWiki(cells[placeIndex] || '');
  if (!date || date.slice(0, 4) !== String(year) || !place) return null;
  const rawText = (articleIndex >= 0 ? cells[articleIndex] : '') || cells[textIndex] || '';
  const linked = String(rawText).match(/'''\[\[([^\]|#]+)/) || String(rawText).match(/\[\[([^\]|#]+)/);
  const title = stripWiki(linked ? linked[1].replace(/_/g, ' ') : rawText).slice(0, 180);
  if (!title) return null;
  const deaths = deathIndex >= 0 ? parseDeaths(cells[deathIndex]) : null;
  const slug = linked ? encodeURIComponent(linked[1].trim().replace(/ /g, '_')) : '';
  return {
    date,
    place,
    title,
    deaths,
    sourceUrl: slug
      ? `https://en.wikipedia.org/wiki/${slug}`
      : `https://en.wikipedia.org/wiki/List_of_terrorist_incidents_in_${year}`
  };
}

function violenceType(code) {
  return String(code) === '3' ? 'терор' : 'війни';
}

function clip(value, max = 180) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function recordFromUcdp(row, source, sourceUrl) {
  const year = Number(row.year);
  if (!Number.isFinite(year) || year < FIRST_YEAR) return null;
  const lat = Number(row.latitude);
  const lon = Number(row.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const date = String(row.date_start || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const deaths = Number(row.best);
  const title = clip(row.source_headline) || clip(`${row.where_description || row.country}: ${row.side_a || ''} — ${row.side_b || ''}`);
  if (!title) return null;
  return {
    id: `${String(source).includes('Candidate') ? 'ucdpc' : 'ucdp'}-${row.id}`,
    date,
    lat: Math.round(lat * 1000) / 1000,
    lon: Math.round(lon * 1000) / 1000,
    country: row._iso || '',
    type: violenceType(row.type_of_violence),
    ...(Number.isFinite(deaths) ? { deaths } : {}),
    title,
    source,
    sourceUrl,
    confidence: 'підтверджено'
  };
}

async function* csvObjects(stream) {
  let header = null;
  let field = '';
  let row = [];
  let quoted = false;
  for await (const chunk of stream) {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      if (quoted) {
        if (char === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 1;
          } else quoted = false;
        } else field += char;
        continue;
      }
      if (char === '"') quoted = true;
      else if (char === ',') {
        row.push(field);
        field = '';
      } else if (char === '\n') {
        row.push(field.replace(/\r$/, ''));
        field = '';
        if (!header) header = row;
        else if (row.length > 1) {
          const item = {};
          for (let c = 0; c < header.length; c += 1) item[header[c]] = row[c] ?? '';
          yield item;
        }
        row = [];
      } else if (char !== '\r') field += char;
    }
  }
}

function isoMap(centroids) {
  const map = new Map();
  for (const row of centroids) {
    if (row.code && row.name_en) map.set(row.name_en, row.code);
  }
  for (const [name, code] of Object.entries(UCDP_ISO)) map.set(name, code);
  return map;
}

function addHeat(heat, record) {
  const key = record.date.slice(0, 7);
  if (!heat.has(key)) heat.set(key, new Map());
  const cells = heat.get(key);
  const lat = Math.floor(record.lat);
  const lon = Math.floor(record.lon);
  const id = `${lat}|${lon}`;
  const cell = cells.get(id) || [lat + 0.5, lon + 0.5, 0, 0];
  cell[2] += 1;
  cell[3] += record.deaths || 0;
  cells.set(id, cell);
}

async function readZipCsv(zipPath, entry) {
  const child = spawn('unzip', ['-p', zipPath, entry], { stdio: ['ignore', 'pipe', 'inherit'] });
  const rows = [];
  for await (const row of csvObjects(child.stdout)) rows.push(row);
  const code = await new Promise((resolve) => child.on('close', resolve));
  if (code !== 0) throw new Error(`unzip ${entry} завершився з кодом ${code}`);
  return rows;
}

async function readCsvFile(file) {
  const rows = [];
  for await (const row of csvObjects(fs.createReadStream(file))) rows.push(row);
  return rows;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'danger-map/1.0 (https://github.com/D413422/danger-map)' }
  });
  if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
  return response.json();
}

async function wikiPages(year) {
  const main = `List_of_terrorist_incidents_in_${year}`;
  const pages = [main];
  try {
    const first = await fetchJson(`https://en.wikipedia.org/w/api.php?action=parse&page=${main}&prop=wikitext&format=json&redirects=1`);
    const text = first?.parse?.wikitext?.['*'] || '';
    const extras = [...text.matchAll(/\[\[(List of terrorist incidents in [^\]|#]+)\]\]/g)]
      .map((match) => match[1].replace(/ /g, '_'))
      .filter((title) => title !== main);
    return [text, [...new Set(extras)]];
  } catch (error) {
    console.log(`wikipedia ${year}: ${error.message}`);
    return ['', []];
  }
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'danger-map/1.0 (https://github.com/D413422/danger-map)' }
  });
  if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
  return response.text();
}

function homicideSeries(csv, iso3to2) {
  const series = {};
  const lines = csv.split(/\n/);
  const header = lines[0].split(',');
  const codeIndex = header.indexOf('code');
  const yearIndex = header.indexOf('year');
  const valueIndex = header.findIndex((name) => name.startsWith('value'));
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cells = line.split(',');
    const iso = iso3to2.get(cells[codeIndex]);
    const year = Number(cells[yearIndex]);
    const rate = Number(cells[valueIndex]);
    if (!iso || year < FIRST_YEAR || !Number.isFinite(rate)) continue;
    if (!series[iso]) series[iso] = [];
    series[iso].push({ year, rate: Math.round(rate * 1000) / 1000 });
  }
  for (const rows of Object.values(series)) rows.sort((a, b) => a.year - b.year);
  return series;
}

async function main() {
  const zipPath = process.argv[2] || '/tmp/ucdp/ged261-csv.zip';
  const candidatePath = process.argv[3] || '/tmp/ucdp/candidate-2026.csv';
  const centroids = JSON.parse(fs.readFileSync(path.join(root, 'data/centroids.json'), 'utf8'));
  const cities = JSON.parse(fs.readFileSync(path.join(root, 'scripts/gazetteer.json'), 'utf8')).cities;
  const gazetteer = loadGazetteer(centroids, cities);
  const isoByName = isoMap(centroids);
  const buckets = new Map();
  const heat = new Map();
  const unmapped = new Map();
  const counts = { ucdp: 0, candidate: 0, wikipedia: 0, wikiSkipped: 0 };

  console.log('читаю GED 26.1…');
  const gedUrl = 'https://ucdp.uu.se/downloads/ged/ged261-csv.zip';
  const unzip = spawn('unzip', ['-p', zipPath, 'GEDEvent_v26_1.csv']);
  const unzipDone = new Promise((resolve) => unzip.on('close', resolve));
  for await (const row of csvObjects(unzip.stdout)) {
    row._iso = isoByName.get(row.country) || '';
    if (!row._iso && row.country) unmapped.set(row.country, (unmapped.get(row.country) || 0) + 1);
    const record = recordFromUcdp(row, 'UCDP GED 26.1', gedUrl);
    if (!record) continue;
    const year = record.date.slice(0, 4);
    if (!buckets.has(year)) buckets.set(year, []);
    buckets.get(year).push(record);
    addHeat(heat, record);
    counts.ucdp += 1;
  }
  if (await unzipDone !== 0) throw new Error('unzip GED завершився з помилкою');

  if (fs.existsSync(candidatePath)) {
    console.log('читаю candidate events…');
    const candidateUrl = 'https://ucdp.uu.se/downloads/candidateged/GEDEvent_v26_01_26_09.csv';
    for (const row of await readCsvFile(candidatePath)) {
      if (Number(row.year) < 2026) continue;
      row._iso = isoByName.get(row.country) || '';
      const record = recordFromUcdp(row, 'UCDP Candidate 26.0.9 (січень–вересень 2026)', candidateUrl);
      if (!record) continue;
      const year = record.date.slice(0, 4);
      if (!buckets.has(year)) buckets.set(year, []);
      buckets.get(year).push(record);
      addHeat(heat, record);
      counts.candidate += 1;
    }
  }

  const thisYear = new Date().getUTCFullYear();
  for (let year = FIRST_YEAR; year <= thisYear; year += 1) {
    const [mainText, extras] = await wikiPages(year);
    const texts = [mainText];
    for (const title of extras.slice(0, 14)) {
      try {
        const page = await fetchJson(`https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&format=json&redirects=1`);
        texts.push(page?.parse?.wikitext?.['*'] || '');
      } catch (error) {
        console.log(`wikipedia ${title}: ${error.message}`);
      }
    }
    let added = 0;
    for (const text of texts) {
      for (const incident of parseWikiIncidents(text, year)) {
        const tail = incident.place.split(',').pop();
        const hit = geocode(incident.place, gazetteer) || geocode(tail, gazetteer) || geocode(incident.title, gazetteer);
        if (!hit) {
          counts.wikiSkipped += 1;
          continue;
        }
        const record = {
          id: `wiki-${year}-${counts.wikipedia + added + 1}`,
          date: incident.date,
          lat: hit.lat,
          lon: hit.lon,
          country: hit.country || '',
          type: 'терор',
          ...(incident.deaths != null ? { deaths: incident.deaths } : {}),
          title: incident.title,
          source: 'Wikipedia: List of terrorist incidents',
          sourceUrl: incident.sourceUrl,
          confidence: 'підтверджено'
        };
        if (!buckets.has(String(year))) buckets.set(String(year), []);
        buckets.get(String(year)).push(record);
        addHeat(heat, record);
        added += 1;
      }
    }
    counts.wikipedia += added;
    console.log(`wikipedia ${year}: ${added}`);
  }

  fs.mkdirSync(outDir, { recursive: true });
  const years = [];
  for (const [year, rows] of [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    rows.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    const file = path.join(outDir, `${year}.json`);
    fs.writeFileSync(file, JSON.stringify(rows));
    const bytes = fs.statSync(file).size;
    const bySource = {};
    for (const row of rows) bySource[row.source] = (bySource[row.source] || 0) + 1;
    years.push({ year: Number(year), events: rows.length, bytes, sources: bySource });
    console.log(`${year}: ${rows.length} подій, ${bytes} байт`);
  }

  const heatOut = {};
  for (const [month, cells] of heat.entries()) heatOut[month] = [...cells.values()];
  const heatFile = path.join(outDir, 'heat.json');
  fs.writeFileSync(heatFile, JSON.stringify(heatOut));

  console.log('читаю ряд UNODC…');
  const [homicideCsv, isoRows] = await Promise.all([
    fetchText('https://ourworldindata.org/grapher/homicide-rate-unodc.csv?v=1&csvType=full&useColumnShortNames=true'),
    fetchJson('https://raw.githubusercontent.com/lukes/ISO-3166-Countries-with-Regional-Codes/master/all/all.json')
  ]);
  const iso3to2 = new Map(isoRows.map((row) => [row['alpha-3'], row['alpha-2']]));
  const homicide = {
    generatedAt: new Date().toISOString(),
    source: 'UNODC, intentional homicide rate per 100,000. Ряд опубліковано на dataunodc.un.org і передруковано Our World in Data (CC BY), з їхнім округленням.',
    sourceUrl: 'https://dataunodc.un.org/dp-intentional-homicide-victims',
    tableUrl: 'https://ourworldindata.org/grapher/homicide-rate-unodc',
    series: homicideSeries(homicideCsv, iso3to2)
  };
  fs.writeFileSync(path.join(root, 'data/homicide.json'), `${JSON.stringify(homicide)}\n`);

  const index = {
    generatedAt: new Date().toISOString(),
    from: `${FIRST_YEAR}-01-01`,
    to: years.length ? `${years[years.length - 1].year}-12-31` : null,
    ged: {
      version: '26.1',
      url: gedUrlSafe(),
      license: 'CC BY 4.0',
      citation: 'Davies, Shawn, Therése Pettersson & Magnus Öberg (2026) Organized violence 1989–2025, and violent political protests. Journal of Peace Research. Sundberg, Ralph & Erik Melander (2013) Introducing the UCDP Georeferenced Event Dataset. Journal of Peace Research 50(4).'
    },
    candidate: {
      version: '26.0.9',
      coverage: 'січень–вересень 2026',
      url: 'https://ucdp.uu.se/downloads/candidateged/GEDEvent_v26_01_26_09.csv'
    },
    wikipedia: 'https://en.wikipedia.org/wiki/List_of_terrorist_incidents_in_2004',
    gtd: 'Global Terrorism Database не включено: ліцензія забороняє розповсюдження. Посилання: https://www.start.umd.edu/gtd/',
    counts,
    unmappedCountries: [...unmapped.entries()].sort((a, b) => b[1] - a[1]),
    heatBytes: fs.statSync(heatFile).size,
    homicideBytes: fs.statSync(path.join(root, 'data/homicide.json')).size,
    years
  };
  fs.writeFileSync(path.join(outDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  const totalBytes = years.reduce((sum, year) => sum + year.bytes, 0) + index.heatBytes + index.homicideBytes;
  console.log(JSON.stringify({ counts, years: years.length, totalBytes, unmapped: index.unmappedCountries.length }, null, 2));
}

function gedUrlSafe() {
  return 'https://ucdp.uu.se/downloads/ged/ged261-csv.zip';
}

const isDirect = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirect) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
