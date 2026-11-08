import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDeaths, parseWikiDate, parseWikiIncidents } from './build-history.mjs';
import { isSecurityRelevant, parseTelegram } from './fetch-social.mjs';

const sample = `{|
! Date !! Dead !! Injured !! Location !! Description
|-
|January 10
|style="background:#fff;"|4
|3
|[[Palopo]], [[Indonesia]]
|'''[[2004 Palopo cafe bombing]]''': A bomb killed four people.
|-
|January 14
|4 (+1)
|12
|[[Gaza Strip|Gaza]], [[Israel]]
|'''[[2004 Erez Crossing bombing]]''': A bombing.
|}`;

test('таблиця Вікіпедії дає дату, місце, назву і загиблих', () => {
  const rows = parseWikiIncidents(sample, 2004);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].date, '2004-01-10');
  assert.equal(rows[0].place, 'Palopo, Indonesia');
  assert.equal(rows[0].title, '2004 Palopo cafe bombing');
  assert.equal(rows[0].deaths, 4);
  assert.equal(parseWikiDate('14 January', 2004), '2004-01-14');
  assert.equal(parseDeaths('4 (+1)'), 4);
});

test('фільтр безпеки і розбір Telegram не вигадують дописи', () => {
  assert.equal(isSecurityRelevant('Стрілянина в центрі'), true);
  assert.equal(isSecurityRelevant('рецепт борщу'), false);
  const html = `data-post="bbcrussian/1" <time datetime="2026-11-08T12:00:00+00:00"></time><div class="js-message_text" dir="auto">Вибух у місті</div>`;
  const items = parseTelegram(html, { username: 'bbcrussian', name: 'BBC' });
  assert.equal(items.length, 1);
  assert.equal(items[0].url, 'https://t.me/bbcrussian/1');
  assert.equal(items[0].platform, 'telegram');
  assert.equal(parseTelegram('<html></html>', { username: 'x', name: 'x' }).length, 0);
});
