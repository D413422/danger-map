import fs from 'node:fs';
import path from 'node:path';

const upload = process.argv[2];
const outDir = process.argv[3];
if (!upload || !outDir) {
  console.error('usage: node scripts/extract-data.mjs <canvas-source> <out-dir>');
  process.exit(1);
}

const src = fs.readFileSync(upload, 'utf8');
const start = src.indexOf('const META=');
const end = src.indexOf('// Hand-generalised geography');
if (start < 0 || end < 0) {
  console.error('data zone markers not found');
  process.exit(1);
}

let chunk = src.slice(start, end);
chunk = chunk.replace(/^type .*$/gm, '');
chunk = chunk.replace(
  /const (META|COUNTRY_DATA|INCIDENTS|UPCOMING|THREAT_LEVELS|LOCAL_STATS|X_SIGNALS|LINKS|TODAY_IMPORTANT)\s*:[^=]*=/g,
  'const $1 ='
);

const data = new Function(
  `${chunk}\nreturn {META,COUNTRY_DATA,INCIDENTS,UPCOMING,THREAT_LEVELS,LOCAL_STATS,X_SIGNALS,LINKS,TODAY_IMPORTANT};`
)();

function recordOut(r) {
  const out = {
    id: r.id,
    title: r.title,
    date: r.date,
    ...(r.endDate ? { endDate: r.endDate } : {}),
    dateKind: r.dateKind,
    place: r.place,
    lat: r.lat,
    lon: r.lon,
    type: r.type,
    confidence: r.confidence,
    description: r.description,
    sources: r.sources,
    ...(r.country ? { country: r.country } : {}),
    kind: r.kind,
    sourceKind: r.sourceKind,
    links: (r.links || []).map((l) => ({
      id: l.id,
      reason: l.reason,
      relation: l.relation,
      source: l.source,
      speculative: !!l.speculative
    })),
    ...(r.avoid ? { avoid: r.avoid } : {})
  };
  return out;
}

const countries = data.COUNTRY_DATA.map((c) => ({
  code: c[0],
  name: c[1],
  lat: c[2],
  lon: c[3],
  advisory: c[4],
  notes: c[5],
  homicidePer100k: c[6],
  homicideYear: c[7]
}));

const records = [
  ...data.INCIDENTS,
  ...data.UPCOMING,
  ...data.THREAT_LEVELS,
  ...data.LOCAL_STATS,
  ...data.X_SIGNALS
].map(recordOut);

const links = data.LINKS.map((l) => ({
  from: l.from,
  to: l.to,
  reason: l.reason,
  relation: l.relation,
  source: l.source,
  speculative: !!l.speculative
}));

const meta = {
  asOf: data.META.asOf,
  zone: data.META.zone,
  from: data.META.from,
  to: data.META.to,
  advisory: data.META.advisory,
  homicide: data.META.homicide,
  previousPage: data.META.previousPage,
  todayImportant: data.TODAY_IMPORTANT
};

fs.mkdirSync(outDir, { recursive: true });
const write = (name, value) => {
  fs.writeFileSync(path.join(outDir, name), `${JSON.stringify(value, null, 2)}\n`);
};
write('countries.json', countries);
write('records.json', records);
write('links.json', links);
write('meta.json', meta);

console.log(
  JSON.stringify(
    {
      countries: countries.length,
      records: records.length,
      links: links.length,
      today: meta.todayImportant
    },
    null,
    2
  )
);
