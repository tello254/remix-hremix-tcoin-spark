import { writeFileSync } from 'node:fs';
const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36';
const out = [];

// ---- TikTok: public item_list API by secUid (same trick as comment scraping) ----
try {
  const sec = 'MS4wLjABAAAAmhAdrU5Iw6rFTt2OCG2vK48StfwTArwvgtCdzT01585-t3XTvJ7-vw0PbzEkeI9P';
  const api = 'https://www.tiktok.com/api/post/item_list/?aid=1988&cookie_enabled=true&count=15&language=en&cursor=0&secUid=' + encodeURIComponent(sec) + '&os=browser';
  const r = await fetch(api, { headers: { 'user-agent': UA, referer: 'https://www.tiktok.com/@vyspertalon', accept: 'application/json' } });
  const j = await r.json();
  console.log('TikTok item_list HTTP', r.status, 'items:', (j.itemList || []).length);
  for (const it of (j.itemList || []).slice(0, 6)) {
    out.push({ platform: 'TikTok', url: `https://www.tiktok.com/@vyspertalon/video/${it.id}`, title: (it.desc || 'Video by VysperTalon').replace(/\s+/g, ' ').slice(0, 90), thumb: it.video?.cover || '', duration: it.video?.duration ? `${it.video.duration}s` : '' });
  }
} catch (e) { console.log('TikTok API failed:', e.message); }

// ---- YouTube @tellonvysper: validate raw ids through free public oEmbed ----
const ytPage = await (await fetch('https://www.youtube.com/@tellonvysper/videos', { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0' } })).text();
const ids = [...new Set([...ytPage.matchAll(/"videoId":"([\w-]{11})"/g)].map(x => x[1]))].slice(0, 10);
console.log('YT raw ids for @tellonvysper:', ids.length);
for (const id of ids) {
  const r = await fetch('https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=' + id);
  if (!r.ok) { console.log('  oembed ' + id + ' → ' + r.status + ' (skip)'); continue; }
  const o = await r.json();
  out.push({ platform: 'YouTube', url: 'https://www.youtube.com/watch?v=' + id, title: o.title.slice(0, 100), thumb: o.thumbnail_url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, author: o.author_name });
}

// ---- YouTube @vysper_talon: confirm empty ----
const yt2 = await (await fetch('https://www.youtube.com/@vysper_talon/videos', { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0' } })).text();
console.log('YT @vysper_talon empty state:', /channelOwnerEmptyStateRenderer/.test(yt2), '| ids:', [...new Set([...yt2.matchAll(/"videoId":"([\w-]{11})"/g)].map(x => x[1]))].length);

// ---- Instagram one more probe: mobile-UA timeline embed ----
try {
  const ig = await (await fetch('https://www.instagram.com/vysper_talon/', { headers: { 'user-agent': UA, 'accept-language': 'en' } })).text();
  const codes = [...new Set([
    ...[...ig.matchAll(/"shortcode\\?":"([\w-]{5,20})"/g)].map(x => x[1]),
    ...[...ig.matchAll(/ig\.com\/(p|reel)\/([\w-]{5,20})/g)].map(x => x[2]),
  ])].slice(0, 6);
  console.log('IG mobile-UA shortcodes:', codes.length);
  codes.forEach(code => out.push({ platform: 'Instagram', url: `https://www.instagram.com/p/${code}/`, title: 'Instagram post by @vysper_talon', thumb: '' }));
} catch (e) { console.log('IG probe failed:', e.message); }

writeFileSync(new URL('./final-posts.json', import.meta.url), JSON.stringify(out, null, 2));
console.log('\nFINAL IMPORTABLE:', out.length, '— per platform:', JSON.stringify(out.reduce((a, v) => (a[v.platform] = (a[v.platform] || 0) + 1, a), {})));
out.forEach(v => console.log(' •', v.platform, v.url, '|', v.title.slice(0, 55)));
