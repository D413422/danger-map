import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../data/${name}`, import.meta.url), 'utf8'));
const meta = read('meta.json');
const countries = read('countries.json');
const records = read('records.json');
const links = read('links.json');
const world = read('world.geojson');

const TYPES = new Set(['терор', 'війни', 'кримінал', 'кібер/банки', 'протести', 'політика']);
const CONFIDENCE = new Set(['неперевірений сигнал', 'одне джерело', 'підтверджено']);
const RELATIONS = new Set(['географія', 'контекст', 'офіційний режим']);

test('країни, записи, зв’язки і мета мають стабільну форму', () => {
  assert.equal(typeof meta.asOf, 'string');
  assert.ok(meta.todayImportant.length > 0);
  const codes = new Set();
  for (const row of countries) {
    assert.match(row.code, /^[A-Z]{2}$/);
    assert.equal(codes.has(row.code), false);
    codes.add(row.code);
    assert.equal(typeof row.name, 'string');
    assert.equal(typeof row.lat, 'number');
    assert.equal(typeof row.lon, 'number');
    assert.ok(row.advisory == null || [1, 2, 3, 4].includes(row.advisory));
    assert.equal(typeof row.notes, 'string');
  }
  const ids = new Set(records.map((record) => record.id));
  for (const record of records) {
    for (const key of ['id', 'title', 'date', 'dateKind', 'place', 'lat', 'lon', 'type', 'confidence', 'description', 'sources', 'kind', 'sourceKind', 'links']) {
      assert.ok(record[key] !== undefined, `${record.id} без ${key}`);
    }
    assert.ok(TYPES.has(record.type), record.type);
    assert.ok(CONFIDENCE.has(record.confidence), record.confidence);
    assert.ok(Array.isArray(record.sources) && record.sources.length > 0);
    assert.ok(Array.isArray(record.links));
    assert.match(record.date, /^\d{4}-\d{2}-\d{2}$/);
  }
  for (const id of meta.todayImportant) assert.ok(ids.has(id), id);
  for (const link of links) {
    assert.ok(ids.has(link.from), link.from);
    assert.ok(ids.has(link.to), link.to);
    assert.ok(RELATIONS.has(link.relation));
    assert.equal(typeof link.reason, 'string');
    assert.equal(typeof link.source, 'string');
    assert.equal(typeof link.speculative, 'boolean');
  }
});

test('усі країни світу мають українську назву, а коди з досьє лягають на полігони', () => {
  assert.ok(world.features.length >= 200);
  const isos = new Set();
  for (const feature of world.features) {
    const props = feature.properties;
    assert.match(props.name_uk, /[А-Яа-яІіЇїЄєҐґ]/u, props.name_en);
    assert.ok(feature.geometry);
    if (props.iso_a2) isos.add(props.iso_a2);
  }
  for (const row of countries) assert.ok(isos.has(row.code), row.code);
  assert.ok(isos.has('XK'));
});
