// Server-only scrapers for public TikTok and YouTube data. Uses only fetch (Worker-safe).
export type SocialComment = { handle: string; name: string; text: string };
export type SocialAccount = { handle: string; name: string; avatar: string; followers?: string };

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const YT_CTX = { client: { clientName: 'WEB', clientVersion: '2.20250101.00.00', hl: 'en', gl: 'KE' } };
const clean = (h: string) => h.trim().replace(/^@/, '').toLowerCase();

/** Decodes HTML entities in open-graph values (names contain emoji: &#x1f1f0; style). */
const ENTITIES: Record<string, string> = { 'amp': '&', 'lt': '<', 'gt': '>', 'quot': '"', 'apos': "'" };
const decodeEntities = (s: string) => s.replace(/&#(\d+);|&#x([0-9a-fA-F]+);|&(amp|lt|gt|quot|apos);/g, (m, dec: string, hex: string, word: string) => {
  try {
    if (dec) return String.fromCodePoint(parseInt(dec, 10));
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    return ENTITIES[word] ?? m;
  } catch { return m; }
});

/** Cache one result per handle — profile pages are large so repeated typing must not refetch. */
const igCache = new Map<string, Promise<SocialAccount | null>>();
const ttCache = new Map<string, Promise<SocialAccount | null>>();

export const sameHandle = (a: string, b: string) => clean(a) === clean(b);

// ---------- TikTok ----------
async function tiktokVideoId(url: string) {
  const direct = url.match(/\/video\/(\d+)/);
  if (direct) return direct[1]!;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  const m = res.url.match(/\/video\/(\d+)/) ?? (await res.text()).match(/\/video\/(\d{15,})/);
  if (!m) throw new Error('Could not find this TikTok video.');
  return m[1]!;
}

export async function tiktokComments(url: string, pages = 5): Promise<SocialComment[]> {
  const id = await tiktokVideoId(url);
  const out: SocialComment[] = [];
  let cursor = 0;
  for (let i = 0; i < pages; i++) {
    const res = await fetch(`https://www.tiktok.com/api/comment/list/?aid=1988&aweme_id=${id}&count=50&cursor=${cursor}`, { headers: { 'User-Agent': UA, Referer: 'https://www.tiktok.com/' } });
    if (!res.ok) throw new Error(`TikTok comments unavailable [${res.status}]`);
    const text = await res.text();
    if (!text) break;
    const j = JSON.parse(text) as { comments?: { text: string; user: { unique_id: string; nickname: string } }[] | null; has_more?: number; cursor?: number };
    for (const c of j.comments ?? []) out.push({ handle: c.user.unique_id, name: c.user.nickname, text: c.text });
    if (!j.has_more || !j.cursor) break;
    cursor = j.cursor;
  }
  return out;
}

export async function tiktokAccount(handle: string): Promise<SocialAccount | null> {
  const h = clean(handle);
  if (!/^[\w.]{2,24}$/.test(h)) return null;
  const hit = ttCache.get(h); if (hit) return hit;
  const run = (async () => {
    // 1) Open-graph via crawler UA — the browser-UA page JSON is walled behind TikTok's WAF,
    //    but crawler UAs still get meta tags. Titles "«Name» on TikTok"; the generic
    //    "Visit TikTok to discover profiles!" page means the handle does not exist.
    try {
      const res = await fetch(`https://www.tiktok.com/@${h}`, { headers: { 'User-Agent': 'facebookexternalhit/1.1', 'Accept-Language': 'en' } });
      if (res.ok) {
        const html = await res.text();
        const title = decodeEntities(html.match(/<meta property="og:title" content="([^"]*)"/)?.[1] ?? '');
        const desc = decodeEntities(html.match(/<meta property="og:description" content="([^"]*)"/)?.[1] ?? '');
        const ogHandle = desc.match(/^@([\w.]+)/)?.[1];
        if (ogHandle && sameHandle(ogHandle, h) && !/^Visit TikTok to discover profiles/i.test(title)) {
          const avatar = (html.match(/<meta property="og:image" content="([^"]*)"/)?.[1] ?? '').replace(/&amp;/g, '&');
          return {
            handle: ogHandle,
            name: title.replace(/\s*on TikTok$/i, '').trim(),
            avatar,
            followers: desc.split(',')[0]?.replace(/^@[\w.]+\s*/, '').trim() ?? '',
          };
        }
      }
    } catch { /* fall through */ }
    // 2) Official oEmbed fallback — confirms existence and real name when og is unavailable (no stats).
    try {
      const res = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(`https://www.tiktok.com/@${h}`)}`, { headers: { 'Accept': 'application/json' } });
      if (res.ok) {
        const j = await res.json() as { author_url?: string; author_name?: string };
        const canonical = j.author_url?.match(/tiktok\.com\/@([\w.]+)/)?.[1];
        if (canonical && sameHandle(canonical, h)) return { handle: canonical, name: j.author_name ?? canonical, avatar: '', followers: '' };
      }
    } catch { /* fall through */ }
    return null;
  })();
  ttCache.set(h, run);
  if (ttCache.size > 500) { const first = ttCache.keys().next(); if (!first.done) ttCache.delete(first.value); }
  return run;
}

// ---------- YouTube ----------
function youtubeId(url: string) {
  const m = url.match(/(?:shorts\/|v=|youtu\.be\/|embed\/|live\/)([\w-]{11})/);
  if (!m) throw new Error('Could not find this YouTube video.');
  return m[1]!;
}
async function yt(body: object, endpoint = 'next') {
  const res = await fetch(`https://www.youtube.com/youtubei/v1/${endpoint}?prettyPrint=false`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA }, body: JSON.stringify({ context: YT_CTX, ...body }) });
  if (!res.ok) throw new Error(`YouTube unavailable [${res.status}]`);
  return res.json() as Promise<any>;
}
function findAll(obj: any, key: string, acc: any[] = []): any[] {
  if (obj && typeof obj === 'object') { for (const [k, v] of Object.entries(obj)) { if (k === key) acc.push(v); findAll(v, key, acc); } }
  return acc;
}
/** Watch-page HTML (900KB) — used only to identify videos whose comment section is silently absent. */
async function watchHtml(videoId: string) {
  const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, { headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9' } });
  return res.ok ? res.text() : '';
}

export async function youtubeComments(url: string, pages = 5): Promise<SocialComment[]> {
  const videoId = youtubeId(url);
  const first = await yt({ videoId });
  // comments turned off (creator setting or Made-for-Kids): InnerTube returns a messageRenderer instead of a comment section
  const off = findAll(first, 'messageRenderer')
    .map((m: any) => [m.text?.simpleText, ...(m.text?.runs ?? []).map((r: any) => r.text)].filter(Boolean).join(' '))
    .join(' ');
  if (/comments (are|is) turned off|comments are disabled|turned off.?comments/i.test(off)) throw new Error('YT_COMMENTS_DISABLED');
  // Comments section continuation (works for watch pages and Shorts)
  let token: string | undefined = findAll(first, 'continuationCommand').map(c => c.token).find((t: string) => t) ;
  const sections = findAll(first, 'itemSectionRenderer').find((s: any) => s.sectionIdentifier === 'comment-item-section');
  if (sections) token = findAll(sections, 'continuationCommand')[0]?.token ?? token;
  const panel = findAll(first, 'engagementPanelSectionListRenderer').find((p: any) => String(p.panelIdentifier).includes('comment'));
  if (!sections && panel) token = findAll(panel, 'continuationCommand')[0]?.token ?? token;
  if (!sections && !panel && !token) {
    // silent comments-off: the API shows no comment section AND no message (seen on Shorts with
    // restricted audience settings) — an enabled video always renders the comment shell on the watch page
    const html = await watchHtml(videoId);
    if (!/comment-item-section/.test(html)) throw new Error('YT_COMMENTS_DISABLED');
  }
  const out: SocialComment[] = [];
  for (let i = 0; i < pages && token; i++) {
    const j = await yt({ continuation: token });
    for (const p of findAll(j, 'commentEntityPayload')) {
      out.push({ handle: String(p.author?.displayName ?? '').replace(/^@/, ''), name: p.author?.displayName ?? '', text: p.properties?.content?.content ?? '' });
    }
    const next = findAll(j, 'continuationItemRenderer').map((c: any) => findAll(c, 'continuationCommand')[0]?.token).filter(Boolean);
    token = next[next.length - 1];
  }
  return out;
}

export async function youtubeAccounts(query: string): Promise<SocialAccount[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const j = await yt({ query: q, params: 'EgIQAg%3D%3D' }, 'search');
  return findAll(j, 'channelRenderer').slice(0, 8).map((c: any) => {
    const handleText = c.subscriberCountText?.simpleText ?? '';
    const handle = handleText.startsWith('@') ? handleText.slice(1) : (c.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl ?? '').replace('/@', '');
    return { handle, name: c.title?.simpleText ?? '', avatar: (c.thumbnail?.thumbnails?.[0]?.url ?? '').replace(/^\/\//, 'https://'), followers: c.videoCountText?.simpleText ?? '' };
  }).filter((a: SocialAccount) => a.handle && !a.handle.startsWith('/'));
}

export async function youtubeAccount(handle: string): Promise<SocialAccount | null> {
  const h = handle.trim().replace(/^@/, '');
  if (!/^[\w.-]{3,30}$/.test(h)) return null;
  const res = await fetch(`https://www.youtube.com/@${encodeURIComponent(h)}`, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' } });
  if (!res.ok) return null;
  const html = await res.text();
  const real = html.match(/"canonicalBaseUrl":"\/@([^"]+)"/)?.[1];
  if (!real) return null;
  return { handle: decodeURIComponent(real), name: html.match(/<meta property="og:title" content="([^"]*)"/)?.[1] ?? real, avatar: html.match(/<meta property="og:image" content="([^"]*)"/)?.[1] ?? '' };
}

// ---------- Instagram ----------
/**
 * Instagram profile lookup via open-graph crawler data: no login needed, and existence is
 * confirmed only when the page carries canonical + og:title data (missing pages return a bare JS shell).
 */
export async function instagramAccount(handle: string): Promise<SocialAccount | null> {
  const h = clean(handle);
  if (!/^[\w.]{3,30}$/.test(h)) return null;
  const hit = igCache.get(h); if (hit) return hit;
  const run = (async () => {
    try {
      const res = await fetch(`https://www.instagram.com/${h}/`, { headers: { 'User-Agent': 'facebookexternalhit/1.1', 'Accept-Language': 'en' }, redirect: 'follow' });
      if (!res.ok) return null;
      const html = await res.text();
      const canonical = html.match(/<link rel="canonical" href="https:\/\/www\.instagram\.com\/([\w.]+)\/"/)?.[1];
      const title = decodeEntities(html.match(/<meta property="og:title" content="([^"]*)"/)?.[1] ?? '');
      if (!canonical || !title) return null; // crawler shell without profile data = page not found
      const desc = decodeEntities(html.match(/<meta property="og:description" content="([^"]*)"/)?.[1] ?? '');
      const avatar = (html.match(/<meta property="og:image" content="([^"]*)"/)?.[1] ?? '').replace(/&amp;/g, '&');
      const name = title.split('(')[0]?.trim() ?? '';
      const followers = desc.split(',')[0]?.trim() ?? '';
      return { handle: canonical, name: name || canonical, avatar, followers };
    } catch { return null; }
  })();
  igCache.set(h, run);
  if (igCache.size > 500) { const first = igCache.keys().next(); if (!first.done) igCache.delete(first.value); }
  return run;
}
