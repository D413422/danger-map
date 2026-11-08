import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { geocode, inWindow, loadGazetteer, warsawDate } from './fetch-news.mjs';

export const SOCIAL_WINDOW_DAYS = 7;
const WINDOW_MS = SOCIAL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const SECURITY_KEYWORDS = [
  'attack', 'attacks', 'explosion', 'explosions', 'shooting', 'protest', 'protests',
  'evacuation', 'evacuate', 'cyberattack', 'cyber attack', 'bank outage',
  'вибух', 'вибухи', 'стрілян', 'протест', 'евакуац', 'кібератак',
  'wybuch', 'strzelanin', 'ewakuacj', 'zamach', 'atak',
  'взрыв', 'стрельб', 'эвакуац', 'кибератак'
];

const keywordPattern = new RegExp(SECURITY_KEYWORDS.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i');

export function isSecurityRelevant(text) {
  return keywordPattern.test(String(text || ''));
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseTelegram(html, channel) {
  const items = [];
  const blocks = String(html).split('data-post="').slice(1);
  for (const block of blocks) {
    const post = block.match(/^([^"]+)"/);
    const time = block.match(/<time[^>]*datetime="([^"]+)"/i);
    const textMatch = block.match(/js-message_text"[^>]*>([\s\S]*?)<\/div>/i);
    if (!post || !time || !textMatch) continue;
    const text = stripHtml(textMatch[1]).slice(0, 400);
    if (!text || !isSecurityRelevant(text)) continue;
    items.push({
      text,
      url: `https://t.me/${post[1]}`,
      platform: 'telegram',
      author: channel.name || channel.username,
      published: new Date(time[1]).toISOString()
    });
  }
  return items.filter((item) => Number.isFinite(Date.parse(item.published)));
}

function socialId(url) {
  return `s-${createHash('sha1').update(url).digest('hex').slice(0, 12)}`;
}

function finishItem(raw, gazetteer) {
  const publishedMs = Date.parse(raw.published);
  if (!raw.text || !raw.url || !Number.isFinite(publishedMs)) return null;
  if (!inWindow(new Date(publishedMs).toISOString(), Date.now()) && publishedMs < Date.now() - WINDOW_MS) return null;
  const hit = geocode(raw.text, gazetteer);
  return {
    id: socialId(raw.url),
    text: raw.text.slice(0, 400),
    url: raw.url,
    platform: raw.platform,
    author: raw.author || '',
    published: new Date(publishedMs).toISOString(),
    date: warsawDate(publishedMs),
    geocode: hit ? { lat: hit.lat, lon: hit.lon, place: hit.place, country: hit.country, precision: hit.precision } : null,
    confidence: 'неперевірений сигнал'
  };
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; danger-map/1.0; +https://github.com/D413422/danger-map)',
      accept: 'text/html, application/json, application/atom+xml, */*'
    },
    signal: AbortSignal.timeout(25000)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return text;
}

function decodeXml(value) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}

export function parseAtom(xml) {
  const items = [];
  for (const entry of xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || []) {
    const title = decodeXml((entry.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
    const link = (entry.match(/<link[^>]*href="([^"]+)"/i) || [])[1] || '';
    const updated = (entry.match(/<(?:updated|published)>([^<]+)/i) || [])[1] || '';
    const author = decodeXml((entry.match(/<name>([^<]+)/i) || [])[1] || '');
    items.push({ title: stripHtml(title), link, published: updated, author });
  }
  return items;
}

async function collectTelegram(channels) {
  const items = [];
  const sources = [];
  for (const channel of channels) {
    const url = `https://t.me/s/${channel.username}`;
    try {
      const html = await fetchText(url);
      if (!html.includes('tgme_widget_message_text')) throw new Error('канал без публічної стрічки');
      const parsed = parseTelegram(html, channel);
      items.push(...parsed);
      sources.push({ name: `Telegram @${channel.username}`, platform: 'telegram', ok: true, received: parsed.length, error: null });
    } catch (error) {
      sources.push({ name: `Telegram @${channel.username}`, platform: 'telegram', ok: false, received: 0, error: error.message });
    }
  }
  return { items, sources };
}

async function collectReddit() {
  const subs = [
    ['worldnews', 'attack OR explosion OR shooting OR protest OR evacuation OR cyberattack'],
    ['europe', 'attack OR explosion OR shooting OR protest'],
    ['poland', 'wybuch OR strzelanina OR ewakuacja OR protest OR atak'],
    ['krakow', 'wybuch OR strzelanina OR ewakuacja OR protest'],
    ['ukraine', 'attack OR explosion OR strike OR missile OR drone']
  ];
  const items = [];
  const sources = [];
  for (const [sub, q] of subs) {
    const url = `https://www.reddit.com/r/${sub}/search.rss?q=${encodeURIComponent(q)}&restrict_sr=1&sort=new&t=week`;
    try {
      const xml = await fetchText(url);
      let received = 0;
      for (const entry of parseAtom(xml)) {
        const text = entry.title;
        if (!text || !isSecurityRelevant(text) || !entry.link.startsWith('http')) continue;
        items.push({
          text: text.slice(0, 400),
          url: entry.link,
          platform: 'reddit',
          author: entry.author || `r/${sub}`,
          published: entry.published
        });
        received += 1;
      }
      sources.push({ name: `Reddit r/${sub}`, platform: 'reddit', ok: true, received, error: null });
    } catch (error) {
      sources.push({ name: `Reddit r/${sub}`, platform: 'reddit', ok: false, received: 0, error: error.message });
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return { items, sources };
}

async function collectMastodon() {
  const tags = ['explosion', 'protest', 'ukraine', 'krakow'];
  const items = [];
  const sources = [];
  for (const tag of tags) {
    const url = `https://mastodon.social/api/v1/timelines/tag/${encodeURIComponent(tag)}?limit=40`;
    try {
      const payload = JSON.parse(await fetchText(url));
      let received = 0;
      for (const status of Array.isArray(payload) ? payload : []) {
        const text = stripHtml(status.content || status.spoiler_text || '');
        if (!text || !isSecurityRelevant(text) || !status.url) continue;
        items.push({
          text: text.slice(0, 400),
          url: status.url,
          platform: 'mastodon',
          author: status.account?.acct || '',
          published: status.created_at
        });
        received += 1;
      }
      sources.push({ name: `Mastodon #${tag}`, platform: 'mastodon', ok: true, received, error: null });
    } catch (error) {
      sources.push({ name: `Mastodon #${tag}`, platform: 'mastodon', ok: false, received: 0, error: error.message });
    }
  }
  return { items, sources };
}

async function collectBluesky() {
  const queries = ['explosion attack', 'protest evacuation', 'Krakow OR Warsaw shooting', 'cyberattack bank'];
  const items = [];
  const sources = [];
  for (const q of queries) {
    const url = `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(q)}&limit=25`;
    try {
      const payload = JSON.parse(await fetchText(url));
      let received = 0;
      for (const post of payload.posts || []) {
        const text = post.record?.text || '';
        if (!text || !isSecurityRelevant(text)) continue;
        const author = post.author?.handle || '';
        const uri = post.uri || '';
        const rkey = uri.split('/').pop();
        if (!author || !rkey) continue;
        items.push({
          text: text.slice(0, 400),
          url: `https://bsky.app/profile/${author}/post/${rkey}`,
          platform: 'bluesky',
          author,
          published: post.indexedAt || post.record?.createdAt
        });
        received += 1;
      }
      sources.push({ name: `Bluesky ${q}`, platform: 'bluesky', ok: true, received, error: null });
    } catch (error) {
      sources.push({ name: `Bluesky ${q}`, platform: 'bluesky', ok: false, received: 0, error: error.message });
    }
  }
  return { items, sources };
}

export function dedupeSocial(items) {
  const byUrl = new Map();
  for (const item of items) {
    if (!byUrl.has(item.url)) byUrl.set(item.url, item);
  }
  return [...byUrl.values()].sort((a, b) => Date.parse(b.published) - Date.parse(a.published)).slice(0, 400);
}

export function pruneX(file, now = Date.now()) {
  const items = Array.isArray(file) ? file : (file?.items || []);
  return items.filter((item) => {
    const time = Date.parse(item.published);
    return Number.isFinite(time) && time >= now - WINDOW_MS && time <= now + 36 * 60 * 60 * 1000;
  });
}

export async function main() {
  const centroids = JSON.parse(fs.readFileSync(path.join(root, 'data/centroids.json'), 'utf8'));
  const cities = JSON.parse(fs.readFileSync(path.join(root, 'scripts/gazetteer.json'), 'utf8')).cities;
  const gazetteer = loadGazetteer(centroids, cities);
  const channels = JSON.parse(fs.readFileSync(path.join(root, 'data/sources/telegram.json'), 'utf8'));
  const collected = [];
  const sources = [];
  for (const part of [await collectTelegram(channels), await collectReddit(), await collectMastodon(), await collectBluesky()]) {
    collected.push(...part.items);
    sources.push(...part.sources);
  }
  const now = new Date();
  const items = dedupeSocial(
    collected.map((item) => finishItem(item, gazetteer)).filter(Boolean)
      .filter((item) => Date.parse(item.published) >= now.getTime() - WINDOW_MS)
  );
  const social = {
    generatedAt: now.toISOString(),
    windowDays: SOCIAL_WINDOW_DAYS,
    note: 'Неофіційні сигнали з публічних сторінок. Кожен запис має мітку «неперевірений сигнал». Текст — уривок джерела, не переказ.',
    sources,
    items
  };
  fs.writeFileSync(path.join(root, 'data/social.json'), `${JSON.stringify(social, null, 2)}\n`);
  const xPath = path.join(root, 'data/x_signals.json');
  const previous = fs.existsSync(xPath) ? JSON.parse(fs.readFileSync(xPath, 'utf8')) : { items: [] };
  const xFile = {
    generatedAt: previous.generatedAt || null,
    windowDays: SOCIAL_WINDOW_DAYS,
    note: 'Пости X додаються окремо. Цей скрипт лише відкидає записи старші за 7 днів і нічого не вигадує.',
    items: pruneX(previous, now.getTime())
  };
  fs.writeFileSync(xPath, `${JSON.stringify(xFile, null, 2)}\n`);
  const ok = sources.filter((source) => source.ok).length;
  console.log(`соцсигнали: ${items.length}; джерел ок: ${ok}/${sources.length}; X залишилось ${xFile.items.length}`);
  for (const source of sources) if (!source.ok) console.log(`  помилка: ${source.name}: ${source.error}`);
}

const isDirect = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirect) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
