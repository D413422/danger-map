import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  buildFile,
  containsAlias,
  dedupe,
  geocode,
  inWindow,
  loadGazetteer,
  makeItem,
  parseGdelt,
  parseGdeltDate,
  parseRss,
  selectItems
} from './fetch-news.mjs';

const NOW = Date.parse('2026-11-08T12:00:00Z');
const centroids = JSON.parse(fs.readFileSync(new URL('../data/centroids.json', import.meta.url), 'utf8'));
const cities = JSON.parse(fs.readFileSync(new URL('./gazetteer.json', import.meta.url), 'utf8')).cities;
const gazetteer = loadGazetteer(centroids, cities);

const rss = `<?xml version="1.0"?>
<rss><channel>
<item>
  <title>Стрілянина у Кракові - Przykład</title>
  <link>https://example.com/krakow-shooting</link>
  <pubDate>Sat, 07 Nov 2026 10:00:00 GMT</pubDate>
  <source url="https://example.com">Przykład</source>
</item>
<item>
  <title>малі протести в місті</title>
  <link>https://example.com/small</link>
  <pubDate>Fri, 06 Nov 2026 10:00:00 GMT</pubDate>
  <source>Місцева</source>
</item>
<item>
  <title>Стара подія</title>
  <link>https://example.com/old</link>
  <pubDate>Mon, 01 Sep 2026 10:00:00 GMT</pubDate>
  <source>Архів</source>
</item>
</channel></rss>`;

test('RSS розбирається, а порожній канал не вигадує записи', () => {
  const parsed = parseRss(rss);
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].title, 'Стрілянина у Кракові');
  assert.equal(parsed[0].source, 'Przykład');
  assert.equal(parseRss('<rss><channel></channel></rss>').length, 0);
  assert.equal(parseGdelt({ articles: null }).length, 0);
  assert.equal(parseGdeltDate('20261107T100000Z').toISOString(), '2026-11-07T10:00:00.000Z');
});

test('геокод бере Краків із заголовка і не чіпляє слово «малі»', () => {
  const krakow = geocode('Стрілянина у Кракові', gazetteer);
  assert.equal(krakow.place, 'Краків');
  assert.equal(krakow.country, 'PL');
  assert.equal(krakow.precision, 'місто');
  assert.equal(geocode('малі протести в місті', gazetteer), null);
  assert.equal(containsAlias('малі протести', 'Малі'), false);
  const poland = geocode('Новий режим у Польщі', gazetteer);
  assert.equal(poland.country, 'PL');
  assert.equal(poland.precision, 'країна');
});

test('вікно 30 днів, дедуп і відсутність вигаданих записів', () => {
  const fresh = makeItem({
    title: 'Стрілянина у Кракові',
    link: 'https://news.google.com/rss/articles/abc',
    source: 'Przykład',
    published: '2026-11-07T10:00:00Z',
    origin: 'google-news',
    query: 'стрілянина',
    gazetteer
  });
  const direct = makeItem({
    title: 'Стрілянина у Кракові',
    link: 'https://example.com/krakow-shooting',
    source: 'Przykład',
    published: '2026-11-07T11:00:00Z',
    origin: 'gdelt',
    query: 'shooting',
    gazetteer
  });
  const old = makeItem({
    title: 'Стара подія',
    link: 'https://example.com/old',
    source: 'Архів',
    published: '2026-09-01T10:00:00Z',
    origin: 'gdelt',
    query: 'теракт',
    gazetteer
  });
  const broken = makeItem({ title: '', link: 'https://example.com/x', published: '2026-11-07T10:00:00Z', source: 'x', origin: 'gdelt', query: 'x', gazetteer });
  assert.equal(broken, null);
  assert.equal(fresh.confidence, 'одне джерело');
  assert.equal(fresh.place, 'Краків');
  assert.equal(inWindow(old.published, NOW), false);
  const chosen = selectItems([fresh, direct, old], NOW);
  assert.equal(chosen.length, 1);
  assert.equal(chosen[0].link, 'https://example.com/krakow-shooting');
  const file = buildFile({ previous: { items: [old] }, collected: { items: [], sources: [] }, now: new Date(NOW) });
  assert.deepEqual(file.items, []);
  assert.equal(dedupe([fresh, direct])[0].link, 'https://example.com/krakow-shooting');
});
