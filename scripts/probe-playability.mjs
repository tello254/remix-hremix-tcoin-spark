// definitive probe: anonymous player response — age gate says LOGIN_REQUIRED/"confirm your age"
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const CTX = { client: { clientName: 'WEB', clientVersion: '2.20240401.00.00', hl: 'en', gl: 'KE' } };

async function status(id) {
  const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ context: CTX, videoId: id, contentCheckOk: true, racyCheckOk: true }),
  });
  const j = await res.json();
  const ps = j.playabilityStatus ?? {};
  const line = `${id}: ${ps.status} | ${(ps.reason ?? 'no reason')}`;
  console.log(line);
}
await status('PYQZUDEGxto');   // the problem short
await status('pYETG1LuuP8');   // control — comments visible
await status('K2uUtj_N1p0');   // control — comments turned off
