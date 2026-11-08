import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const WINDOW_DAYS = 30;
export const MAX_ITEMS = 200;
const WINDOW_MS = WINDOW_DAYS * 24 * 60 * 60 * 1000;
const FUTURE_SKEW_MS = 36 * 60 * 60 * 1000;

const GOOGLE_QUERIES = [
  ['теракт', 'uk', 'UA', 'UA:uk'],
  ['вибух', 'uk', 'UA', 'UA:uk'],
  ['стрілянина', 'uk', 'UA', 'UA:uk'],
  ['протест', 'uk', 'PL', 'PL:uk'],
  ['кібератака банк', 'uk', 'UA', 'UA:uk'],
  ['Краків', 'uk', 'PL', 'PL:uk'],
  ['Варшава', 'uk', 'PL', 'PL:uk'],
  ['atak terrorystyczny', 'pl', 'PL', 'PL:pl'],
  ['wybuch', 'pl', 'PL', 'PL:pl'],
  ['strzelanina', 'pl', 'PL', 'PL:pl'],
  ['protest Kraków OR Warszawa', 'pl', 'PL', 'PL:pl'],
  ['cyberatak bank', 'pl', 'PL', 'PL:pl'],
  ['terror attack', 'en', 'US', 'US:en'],
  ['explosion attack', 'en', 'US', 'US:en'],
  ['shooting attack', 'en', 'US', 'US:en'],
  ['protest Poland', 'en', 'PL', 'PL:en'],
  ['cyberattack bank', 'en', 'US', 'US:en'],
  ['Krakow OR Kraków OR Warsaw', 'en', 'PL', 'PL:en']
];

const GDELT_QUERIES = [
  'Krakow OR Kraków OR Warsaw OR Warszawa',
  '(attack OR explosion OR shooting) (Poland OR Ukraine)',
  'cyberattack (bank OR banking)',
  'protest (Warsaw OR Krakow OR Poland)'
];

const BLOCKED_ALIASES = new Set([
  'малі',
  'нігер',
  'оман',
  'того',
  'лаос',
  'чад',
  'georgia',
  'guinea',
  'mali',
  'chad',
  'togo',
  'laos',
  'oman',
  'niger'
]);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function decodeXml(value) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function tagText(block, name) {
  const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return match ? decodeXml(match[1]).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
}

function linkFrom(block) {
  const text = tagText(block, 'link');
  if (text.startsWith('http')) return text;
  const attr = block.match(/<link\b[^>]*href=["']([^"']+)["']/i);
  if (attr) return decodeXml(attr[1]).trim();
  const guid = tagText(block, 'guid');
  return guid.startsWith('http') ? guid : '';
}

export function parseRss(xml) {
  const items = [];
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  for (const block of blocks) {
    const sourceMatch = block.match(/<source\b([^>]*)>([\s\S]*?)<\/source>/i);
    const source = sourceMatch ? decodeXml(sourceMatch[2]).replace(/<[^>]+>/g, '').trim() : '';
    let title = tagText(block, 'title');
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3)).trim();
    items.push({ title, link: linkFrom(block), source, pubDate: tagText(block, 'pubDate') });
  }
  return items;
}

export function parseGdeltDate(value) {
  const match = String(value || '').match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!match) return null;
  return new Date(Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5], +match[6]));
}

export function parseGdelt(payload) {
  const articles = Array.isArray(payload?.articles) ? payload.articles : [];
  return articles.map((article) => ({
    title: String(article.title || '').trim(),
    link: String(article.url || '').trim(),
    source: String(article.domain || article.source || '').trim(),
    seen: article.seendate
  }));
}

export function warsawDate(ms) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(ms));
}

export function canonicalTitle(title) {
  return title
    .toLocaleLowerCase('uk')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function itemId(title, date) {
  return `n-${createHash('sha1').update(`${canonicalTitle(title)}|${date}`).digest('hex').slice(0, 12)}`;
}

export function inWindow(published, now = Date.now()) {
  const time = Date.parse(published);
  if (!Number.isFinite(time)) return false;
  return time >= now - WINDOW_MS && time <= now + FUTURE_SKEW_MS;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function containsAlias(text, alias) {
  if (!alias || alias.length < 3) return false;
  if (BLOCKED_ALIASES.has(alias.toLocaleLowerCase('uk'))) return false;
  return patternFor(alias).test(text);
}

function patternFor(alias) {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(alias)}([^\\p{L}\\p{N}]|$)`, 'iu');
}

function pushAlias(list, alias, payload) {
  if (!alias || alias.length < 3) return;
  if (BLOCKED_ALIASES.has(alias.toLocaleLowerCase('uk'))) return;
  list.push({ ...payload, alias, pattern: patternFor(alias) });
}

export function loadGazetteer(centroids, cities) {
  const cityAliases = [];
  for (const city of cities) {
    for (const name of city.names) {
      pushAlias(cityAliases, name, { lat: city.lat, lon: city.lon, place: city.name, country: city.country, precision: 'місто' });
    }
  }
  const countryAliases = [];
  for (const row of centroids) {
    if (row.lat == null || row.lon == null) continue;
    for (const alias of row.aliases || []) {
      pushAlias(countryAliases, alias, {
        lat: row.lat,
        lon: row.lon,
        place: row.name_uk,
        country: row.code,
        precision: 'країна'
      });
    }
  }
  cityAliases.sort((a, b) => b.alias.length - a.alias.length);
  countryAliases.sort((a, b) => b.alias.length - a.alias.length);
  return { cityAliases, countryAliases };
}

export function geocode(title, gazetteer) {
  if (!title || !gazetteer) return null;
  for (const row of gazetteer.cityAliases) {
    if (row.pattern.test(title)) return row;
  }
  for (const row of gazetteer.countryAliases) {
    if (row.pattern.test(title)) return row;
  }
  return null;
}

function safeLink(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
  } catch {
    return '';
  }
  return '';
}

export function makeItem({ title, link, source, published, origin, query, gazetteer }) {
  const cleanTitle = String(title || '').replace(/\s+/g, ' ').trim();
  const href = safeLink(link);
  const time = Date.parse(published);
  if (!cleanTitle || !href || !Number.isFinite(time)) return null;
  const date = warsawDate(time);
  const hit = geocode(cleanTitle, gazetteer);
  return {
    id: itemId(cleanTitle, date),
    title: cleanTitle,
    link: href,
    source: String(source || '').trim() || hostOf(href),
    published: new Date(time).toISOString(),
    date,
    lat: hit ? hit.lat : null,
    lon: hit ? hit.lon : null,
    place: hit ? hit.place : null,
    country: hit ? hit.country : null,
    geocodePrecision: hit ? hit.precision : null,
    confidence: 'одне джерело',
    origin,
    query
  };
}

function hostOf(href) {
  try {
    return new URL(href).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function score(item) {
  let value = 0;
  if (item.lat != null) value += 2;
  if (!item.link.includes('news.google.com')) value += 3;
  return value;
}

export function dedupe(items) {
  const byKey = new Map();
  for (const item of items) {
    const key = `${canonicalTitle(item.title)}|${item.date}`;
    const current = byKey.get(key);
    if (!current || score(item) > score(current)) byKey.set(key, item);
  }
  return [...byKey.values()];
}

export function selectItems(items, now = Date.now()) {
  return dedupe(items.filter((item) => inWindow(item.published, now)))
    .sort((a, b) => Date.parse(b.published) - Date.parse(a.published))
    .slice(0, MAX_ITEMS);
}

async function fetchText(url, timeoutMs = 20000) {
  const response = await fetch(url, {
    headers: {
      accept: 'application/rss+xml, application/xml, application/json, text/xml, */*',
      'user-agent': 'danger-map/1.0 (+https://github.com/D413422/danger-map)'
    },
    signal: AbortSignal.timeout(timeoutMs)
  });
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.body = text.slice(0, 180);
    throw error;
  }
  return text;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function collectNews(gazetteer, pauseMs = 250) {
  const items = [];
  const sources = [];
  for (const [q, hl, gl, ceid] of GOOGLE_QUERIES) {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${hl}&gl=${gl}&ceid=${encodeURIComponent(ceid)}`;
    try {
      const xml = await fetchText(url);
      const parsed = parseRss(xml);
      let kept = 0;
      for (const row of parsed) {
        const item = makeItem({
          title: row.title,
          link: row.link,
          source: row.source,
          published: row.pubDate,
          origin: 'google-news',
          query: q,
          gazetteer
        });
        if (item) {
          items.push(item);
          kept += 1;
        }
      }
      sources.push({ name: `Google News: ${q}`, ok: true, received: kept, error: null });
    } catch (error) {
      sources.push({ name: `Google News: ${q}`, ok: false, received: 0, error: error.message || 'помилка' });
    }
    await sleep(pauseMs);
  }
  for (const q of GDELT_QUERIES) {
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=ArtList&format=json&maxrecords=25&timespan=7d`;
    await sleep(6000);
    try {
      let text;
      try {
        text = await fetchText(url);
      } catch (error) {
        await sleep(7000);
        text = await fetchText(url);
      }
      const trimmed = text.trim();
      if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) throw new Error('відповідь не JSON');
      const parsed = parseGdelt(JSON.parse(trimmed));
      let kept = 0;
      for (const row of parsed) {
        const when = parseGdeltDate(row.seen);
        const item = makeItem({
          title: row.title,
          link: row.link,
          source: row.source,
          published: when ? when.toISOString() : '',
          origin: 'gdelt',
          query: q,
          gazetteer
        });
        if (item) {
          items.push(item);
          kept += 1;
        }
      }
      sources.push({ name: `GDELT: ${q}`, ok: true, received: kept, error: null });
    } catch (error) {
      sources.push({ name: `GDELT: ${q}`, ok: false, received: 0, error: error.message || 'помилка' });
    }
    await sleep(pauseMs);
  }
  return { items, sources };
}

export function buildFile({ previous, collected, now = new Date() }) {
  const prior = Array.isArray(previous?.items) ? previous.items : [];
  const items = selectItems([...prior, ...collected.items], now.getTime());
  return {
    generatedAt: now.toISOString(),
    windowDays: WINDOW_DAYS,
    note: 'Кожен запис скопійовано з публічного RSS Google News або GDELT DOC. Скрипт нічого не дописує від себе. Усі записи мають мітку «одне джерело». Геоточка, якщо є, приблизна: її взято зі згадки міста чи країни в заголовку, а не з місця події.',
    sources: collected.sources,
    items
  };
}

function signatures(file) {
  return JSON.stringify(
    (file.items || []).map((item) => [item.id, item.link, item.lat, item.lon, item.title, item.published])
  );
}

export async function main() {
  const centroids = JSON.parse(fs.readFileSync(path.join(root, 'data/centroids.json'), 'utf8'));
  const cities = JSON.parse(fs.readFileSync(path.join(root, 'scripts/gazetteer.json'), 'utf8')).cities;
  const gazetteer = loadGazetteer(centroids, cities);
  const newsPath = path.join(root, 'data/news.json');
  let previous = { items: [] };
  if (fs.existsSync(newsPath)) {
    try {
      previous = JSON.parse(fs.readFileSync(newsPath, 'utf8'));
    } catch {
      previous = { items: [] };
    }
  }
  const collected = await collectNews(gazetteer);
  const next = buildFile({ previous, collected });
  const changed = !fs.existsSync(newsPath) || signatures(previous) !== signatures(next) || previous.generatedAt !== next.generatedAt;
  const temp = `${newsPath}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`);
  fs.renameSync(temp, newsPath);
  const ok = next.sources.filter((source) => source.ok).length;
  console.log(`новини: ${next.items.length}; джерел ок: ${ok}/${next.sources.length}; файл ${changed ? 'оновлено' : 'без змін у записах'}`);
  for (const source of next.sources) {
    if (!source.ok) console.log(`  помилка: ${source.name}: ${source.error}`);
  }
}

const isDirect = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirect) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
