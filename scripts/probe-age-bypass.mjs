// probe: can an anonymous InnerTube "next" call get past the age gate on PYQZUDEGxto?
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function findAll(obj, key, acc = []) {
  if (obj && typeof obj === 'object') { for (const [k, v] of Object.entries(obj)) { if (k === key) acc.push(v); findAll(v, key, acc); } }
  return acc;
}
async function attempt(label, ctx, extra, useAlso = false) {
  const body = { videoId: 'PYQZUDEGxto', contentCheckOk: true, racyCheckOk: true, ...extra };
  const res = await fetch(`https://www.youtube.com/youtubei/v1/next?prettyPrint=false`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
    body: JSON.stringify({ context: { client: ctx }, ...body }),
  });
  if (!res.ok) { console.log(label, '→ HTTP', res.status); return; }
  const j = await res.json();
  const off = findAll(j, 'messageRenderer').map((m) => [m.text?.simpleText, ...(m.text?.runs ?? []).map((r) => r.text)].filter(Boolean).join(' ')).join(' ');
  const token = findAll(j, 'continuationCommand').map((c) => c.token).find(Boolean);
  console.log(label, '→ token:', token ? 'YES' : 'no', '| off-msg:', off ? JSON.stringify(off.slice(0, 60)) : 'none', '| keys:', Object.keys(j).slice(0, 6).join(','));
  return token;
}

const WEB = { clientName: 'WEB', clientVersion: '2.20240401.00.00', hl: 'en', gl: 'KE' };
const ANDROID = { clientName: 'ANDROID', clientVersion: '19.09.37', androidSdkVersion: 30, hl: 'en', gl: 'KE' };
const TVL = { clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER', clientVersion: '2.0', hl: 'en', gl: 'US' };
const IOS = { clientName: 'IOS', clientVersion: '19.09.3', deviceModel: 'iPhone14,3', hl: 'en', gl: 'US' };

await attempt('A WEB + checkOk', WEB, {});
await attempt('B ANDROID + checkOk', ANDROID, {});
await attempt('C TVHTML5 embed', TVL, {});
await attempt('D IOS + checkOk', IOS, {});
// try player first (to see gate state), then next
const p = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA }, body: JSON.stringify({ context: { client: ANDROID }, videoId: 'PYQZUDEGxto', contentCheckOk: true, racyCheckOk: true }) });
const pj = await p.json();
console.log('E player(ANDROID) status:', pj.playabilityStatus?.status, '|', (pj.playabilityStatus?.reason ?? '').slice(0, 80));
