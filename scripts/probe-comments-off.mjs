// quick probe: does InnerTube return a "comments turned off" messageRenderer for the broken short?
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
const probe = async (id) => {
  const first = await yt({ videoId: id });
  const off = findAll(first, 'messageRenderer')
    .map((m) => [m.text?.simpleText, ...(m.text?.runs ?? []).map((r) => r.text)].filter(Boolean).join(' '))
    .join(' ');
  const token = findAll(first, 'continuationCommand').map((c) => c.token).find(Boolean);
  console.log(id, '| comments-off message:', off ? JSON.stringify(off.slice(0, 120)) : '(none)', '| continuation token:', token ? 'yes' : 'NO');
};
await probe('pYETG1LuuP8');   // the short with comments disabled (user report)
await probe('K2uUtj_N1p0');   // the other seeded video, for contrast
