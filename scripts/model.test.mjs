import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { attachLinks, buildRecords, geodesic, newsVisible, recordVisible, shownConfidence } from '../js/model.js';

const meta = JSON.parse(fs.readFileSync(new URL('../data/meta.json', import.meta.url), 'utf8'));
const countries = JSON.parse(fs.readFileSync(new URL('../data/countries.json', import.meta.url), 'utf8'));
const stored = JSON.parse(fs.readFileSync(new URL('../data/records.json', import.meta.url), 'utf8'));
const links = JSON.parse(fs.readFileSync(new URL('../data/links.json', import.meta.url), 'utf8'));

function state(patch = {}) {
  return {
    types: ['терор', 'війни', 'кримінал', 'кібер/банки', 'протести', 'політика'],
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
    selectedId: 't-poland',
    ...patch
  };
}

test('країни стають записами, а зв’язки йдуть в обидва боки', () => {
  const records = attachLinks(buildRecords(countries, stored, meta), links);
  const poland = records.find((record) => record.id === 'c-PL');
  assert.equal(poland.kind, 'країна');
  assert.match(poland.description, /Туристичний рівень США 1 із 4/);
  const us = records.find((record) => record.id === 'c-US');
  assert.equal(us.advisory, null);
  assert.match(us.description, /Власного туристичного рейтингу США немає/);
  const gb = records.find((record) => record.id === 'c-GB');
  assert.match(gb.description, /коефіцієнта вбивств UK не внесено/);
  const warsaw = records.find((record) => record.id === 'u-warsaw');
  assert.ok(warsaw.links.some((link) => link.id === 't-poland' && link.relation === 'офіційний режим' && link.speculative === false));
  const threat = records.find((record) => record.id === 't-poland');
  assert.ok(threat.links.some((link) => link.id === 'u-warsaw'));
  assert.ok(warsaw.links.some((link) => link.id === 'c-PL' && link.relation === 'географія'));
  const arkea = records.find((record) => record.id === 'i-arkea');
  assert.ok(arkea.links.some((link) => link.id === 'i-binance'));
});

test('режим Польщі лишається в зрізі, а неофіційний сигнал ховається без шару', () => {
  const records = attachLinks(buildRecords(countries, [
    ...stored,
    {
      id: 'x-1',
      title: 'Чутка в телеграмі',
      date: '2026-11-08',
      dateKind: 'час допису',
      place: 'Краків',
      lat: 50.06,
      lon: 19.94,
      type: 'терор',
      confidence: 'підтверджено',
      description: 'Неперевірено.',
      sources: ['https://example.com/post'],
      kind: 'X',
      sourceKind: 'X',
      links: []
    }
  ], meta), links);
  const current = state();
  const threat = records.find((record) => record.id === 't-poland');
  assert.equal(recordVisible(threat, current, new Set()), true);
  assert.equal(recordVisible(threat, state({ from: '2027-01-01', to: '2027-01-07' }), new Set()), false);
  const rumor = records.find((record) => record.id === 'x-1');
  assert.equal(shownConfidence(rumor), 'неперевірений сигнал');
  assert.equal(recordVisible(rumor, current, new Set()), true);
  assert.equal(recordVisible(rumor, state({ unofficial: false }), new Set()), false);
  assert.equal(recordVisible(rumor, state({ types: ['кримінал'] }), new Set()), false);
  const market = records.find((record) => record.id === 'u-krakow');
  assert.equal(recordVisible(market, state({ to: '2026-11-01', futureDates: true }), new Set()), true);
  assert.equal(recordVisible(market, state({ to: '2026-11-01', from: '2026-10-10', futureDates: false }), new Set()), false);
});

test('новина поза вікном шкали не потрапляє на шар', () => {
  const item = {
    id: 'n-1',
    title: 'Тест',
    source: 'Приклад',
    place: 'Краків',
    query: 'Краків',
    date: '2026-09-01',
    confidence: 'одне джерело'
  };
  assert.equal(newsVisible(item, state()), false);
  item.date = '2026-11-07';
  assert.equal(newsVisible(item, state()), true);
  assert.equal(newsVisible(item, state({ news: false })), false);
  assert.equal(newsVisible(item, state({ confidence: 'підтверджено' })), false);
});

test('геодезична дуга Краків—Варшава лежить між містами', () => {
  const parts = geodesic([19.94, 50.06], [21.01, 52.23], 8);
  assert.equal(parts.length, 1);
  assert.ok(parts[0].length > 2);
  for (const [lon, lat] of parts[0]) {
    assert.ok(lon > 19.5 && lon < 21.4);
    assert.ok(lat > 49.8 && lat < 52.5);
  }
});
