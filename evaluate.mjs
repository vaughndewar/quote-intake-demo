// Measure the reader on the labelled synthetic requests.
// Usage: node evaluate.mjs [DIR]   (DIR holds extractor.js and samples.json; default: ./web)
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const argDir = process.argv.slice(2).find((a) => !a.startsWith('--'));
const dir = resolve(argDir || resolve(here, 'web'));
const QuoteReader = createRequire(import.meta.url)(resolve(dir, 'extractor.js'));
const data = JSON.parse(readFileSync(resolve(dir, 'samples.json'), 'utf8'));
const ctx = { catalogue: data.catalogue, today: data.demo_today };
const r = QuoteReader.evaluate(data.samples, ctx);
const pct = (a, b) => (b ? (100 * a / b).toFixed(1) : '0.0') + '%';

console.log(`Requests: ${r.total.n}`);
console.log(`Decision correct: ${r.total.correct} (${pct(r.total.correct, r.total.n)}) | handed to a person: ${r.total.handed} | wrong: ${r.total.wrong} (marked ready when it was not: ${r.total.falseReady}; sent for follow-up when it was ready: ${r.total.falseFollow})`);
console.log('Fields:', Object.entries(r.fields).map(([f, n]) => `${f} ${pct(n, r.total.n)}`).join(' | '));
for (const [cat, c] of Object.entries(r.byCategory)) console.log(`  ${cat.padEnd(11)} n=${String(c.n).padStart(2)} correct ${c.correct} handed ${c.handed} wrong ${c.wrong}`);
if (process.argv.includes('--misses')) for (const m of r.misses) console.log(`\n[${m.id} ${m.category}] ${m.field}: expected ${JSON.stringify(m.expected)} got ${JSON.stringify(m.got)}\n  ${m.text.replace(/\n/g, ' / ')}`);
