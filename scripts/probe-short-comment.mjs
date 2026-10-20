// probe: list live public comments for a YouTube short + the account's linked YouTube handles from DB
import pg from 'pg';
import { readFileSync } from 'fs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const YT_CTX = { client: { clientName: 'WEB', clientVersion: '2.20240401.00.00', hl: 'en', gl: 'KE' } };
async function yt(body, endpoint = 'next') {
  const res = await fetch(`https://www.youtube.com/youtubei/v1/${endpoint}?prettyPrint=false`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA }, body: JSON.stringify({ context: YT_CTX, ...body }) });
  if (!res.ok) throw new Error(`YouTube unavailable [${res.status}]`);
  return res.json();
}
function findAll(obj, key, acc = []) {
  if (obj && typeof obj === 'object') { for (const [k, v] of Object.entries(obj)) { if (k === key) acc.push(v); findAll(v, key, acc); } }
  return acc;
}

const VIDEO = 'PYQZUDEGxto';
let first = await yt({ videoId: VIDEO });
const off = findAll(first, 'messageRenderer')
  .map((m) => [m.text?.simpleText, ...(m.text?.runs ?? []).map((r) => r.text)].filter(Boolean).join(' '))
  .join(' ');
console.log('comments-off message:', off ? JSON.stringify(off) : '(none)');
let token = findAll(first, 'continuationCommand').map((c) => c.token).find(Boolean);
const sections = findAll(first, 'itemSectionRenderer').find((s) => s.sectionIdentifier === 'comment-item-section');
if (sections) token = findAll(sections, 'continuationCommand')[0]?.token ?? token;
const panel = findAll(first, 'engagementPanelSectionListRenderer').find((p) => String(p.panelIdentifier).includes('comment'));
if (!sections && panel) token = findAll(panel, 'continuationCommand')[0]?.token ?? token;
console.log('continuation token:', token ? 'yes' : 'NO');
const out = [];
for (let i = 0; i < 5 && token; i++) {
  const j = await yt({ continuation: token });
  for (const p of findAll(j, 'commentEntityPayload')) out.push({ handle: String(p.author?.displayName ?? '').replace(/^@/, ''), name: p.author?.displayName ?? '', text: p.properties?.content?.content ?? '' });
  const next = findAll(j, 'continuationItemRenderer').map((c) => findAll(c, 'continuationCommand')[0]?.token).filter(Boolean);
  token = next[next.length - 1];
}
console.log(`total public comments: ${out.length}`);
out.forEach((c, i) => console.log(`${i + 1}. @${c.handle}: "${c.text}"`));

// who does the account have linked?
const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)
    .filter((l) => /^[A-Z_]\w*=/.test(l)).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim()]; })
);
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const h = await c.query("select u.username, sh.platform, sh.handle from social_handles sh join profiles u on u.id = sh.user_id order by u.username, sh.created_at");
console.log('LINKED HANDLES:', JSON.stringify(h.rows));
await c.end();
