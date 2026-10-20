/**
 * Re-scrape all four handles. Improvements over scrape-posts2:
 *  - TikTok: browser session (page → cookies) feeding the real item_list API + escaped-URL fallback
 *  - Instagram: api/v1/users/web_profile_info (X-IG-App-ID header) — works without login
 *  - YouTube: /videos + /shorts, oEmbed-validated
 * Output: final-posts3.json (also prints per-platform counts).
 */
import { readFileSync, writeFileSync } from 'node:fs';

const UA_DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const UA_MOBILE = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36';
const dec = s => (s || '').replace(/&amp;/g, '&').replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim();
const out = [];

// ---------- YouTube (both channels, videos + shorts) ----------
const ytValidate = async url => {
  const r = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(url));
  return r.ok ? await r.json() : null;
};
for (const channel of ['@vysper_talon', '@tellonvysper']) {
  for (const tab of ['videos', 'shorts']) {
    try {
      const url = `https://www.youtube.com/${channel}/${tab}`;
      const html = await (await fetch(url, { headers: { 'user-agent': UA_DESKTOP, 'accept-language': 'en' } })).text();
      const ids = [...new Set([...html.matchAll(/"videoId":"([\w-]{11})"/g)].map(x => x[1]))].slice(0, 10);
      if (/channelOwnerEmptyStateRenderer/.test(html)) { console.log(`YT ${channel}/${tab}: EMPTY channel`); continue; }
      console.log(`YT ${channel}/${tab}: ${ids.length} candidate ids`);
      for (const id of ids) {
        const url0 = `https://www.youtube.com/watch?v=${id}`;
        const o = await ytValidate(url0);
        if (!o) { console.log('  oembed reject', id); continue; }
        if (out.some(v => v.url === url0)) continue;
        out.push({ platform: 'YouTube', url: url0, title: dec(o.title).slice(0, 100), thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, author: o.author_name });
      }
    } catch (e) { console.log(`YT ${channel}/${tab} failed: ${e.message}`); }
  }
}

// ---------- TikTok: full browser session → cookies → item_list API ----------
try {
  const handle = 'vyspertalon';
  const p = await fetch(`https://www.tiktok.com/@${handle}`, {
    headers: { 'user-agent': UA_DESKTOP, 'accept-language': 'en-US,en;q=0.9', accept: 'text/html' },
  });
  const html = await p.text();
  const cookies = (p.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
  console.log(`TikTok page: HTTP ${p.status}, ${html.length} bytes, ${cookies ? cookies.split(';').length : 0} cookies`);
  const stats = html.match(/"videoCount":"(\d+)"/)?.[1];

  let items = null;
  if (cookies) {
    const secUid = html.match(/"secUid":"([\w-]+)"/)?.[1];
    if (secUid) {
      const api = `https://www.tiktok.com/api/post/item_list/?aid=1988&cookie_enabled=true&count=15&language=en&cursor=0&secUid=${encodeURIComponent(secUid)}&sourceType=1&appId=1988&itemID=0&os=web&browser_language=en-US&browser_platform=Win32&browser_name=Chrome&browser_version=131.0`;
      const r = await fetch(api, {
        headers: { 'user-agent': UA_DESKTOP, 'accept-language': 'en-US,en;q=0.9', accept: 'application/json,text/plain', referer: `https://www.tiktok.com/@${handle}`, cookie: cookies },
      });
      const body = await r.text();
      console.log(`TikTok item_list: HTTP ${r.status}, ${body.length} bytes`);
      try {
        const j = JSON.parse(body);
        items = j.itemList || null;
        if (j.statusMsg) console.log('  statusMsg:', j.statusMsg);
      } catch { /** non-JSON (blocked) */ }
    }
  }
  // fallback: escaped /video/ ids hidden in the page source
  if (!items?.length) {
    const esc = [...new Set([...html.matchAll(/\\u002[fF]video\\u002[fF](\d{15,25})/g)].map(x => x[1]))];
    const raw = [...new Set([...html.matchAll(/\/video\/(\d{15,25})/g)].map(x => x[1]))];
    const ids = [...esc, ...raw].slice(0, 6);
    console.log(`TikTok fallback ids in HTML: ${ids.length} (escaped=${esc.length}, raw=${raw.length})`);
    items = ids.map(id => ({ id, desc: `Video by @${handle}`, video: {} }));
  }
  if (items?.length) {
    for (const it of items.slice(0, 6)) {
      out.push({ platform: 'TikTok', url: `https://www.tiktok.com/@${handle}/video/${it.id}`, title: dec(it.desc || `Video by @${handle}`).slice(0, 90), thumb: it.video?.cover || '' });
    }
  } else console.log(`TikTok: still no items (page reports videoCount=${stats ?? '?'})`);
} catch (e) { console.log('TikTok flow failed:', e.message); }

// ---------- Instagram: web_profile_info (no login needed with X-IG-App-ID) ----------
try {
  const user = 'vysper_talon';
  const r = await fetch(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${user}`, {
    headers: { 'user-agent': UA_DESKTOP, 'accept-language': 'en-US,en;q=0.9', 'x-ig-app-id': '936619743392456', accept: '*/*', referer: `https://www.instagram.com/${user}/` },
  });
  const body = await r.text();
  console.log(`IG web_profile_info: HTTP ${r.status}, ${body.length} bytes`);
  if (r.ok) {
    const j = JSON.parse(body);
    const u = j.data?.user;
    console.log(`IG user: ${u?.full_name || '?'} posts=${u?.edge_owner_to_timeline_media?.count ?? 0}`);
    const edges = u?.edge_owner_to_timeline_media?.edges || [];
    edges.slice(0, 9).forEach(({ node }) => {
      const cap = node.edge_media_to_caption?.edges?.[0]?.node?.text;
      out.push({
        platform: 'Instagram',
        url: `https://www.instagram.com/p/${node.shortcode}/`,
        title: dec(cap || (node.is_video ? 'Instagram video' : 'Instagram post')).slice(0, 90),
        thumb: node.thumbnail_src || node.display_url || '',
        isVideo: !!node.is_video,
      });
    });
  }
} catch (e) { console.log('IG flow failed:', e.message); }

writeFileSync(new URL('./final-posts3.json', import.meta.url), JSON.stringify(out, null, 2));
console.log(`\nTOTAL: ${out.length} — per platform:`, JSON.stringify(out.reduce((a, v) => (a[v.platform] = (a[v.platform] || 0) + 1, a), {})));
out.forEach(v => console.log(' •', v.platform.padEnd(9), v.url, '|', v.title.slice(0, 55)));
