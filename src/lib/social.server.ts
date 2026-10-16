// Server-only scrapers for public TikTok and YouTube data. Uses only fetch (Worker-safe).
export type SocialComment = { handle: string; name: string; text: string };
export type SocialAccount = { handle: string; name: string; avatar: string; followers?: string };

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const YT_CTX = { client: { clientName: 'WEB', clientVersion: '2.20250101.00.00', hl: 'en', gl: 'KE' } };
const clean = (h: string) => h.trim().replace(/^@/, '').toLowerCase();

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
  const res = await fetch(`https://www.tiktok.com/@${h}`, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' } });
  const html = await res.text();
  const m = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    const d = JSON.parse(m[1]!);
    const info = d.__DEFAULT_SCOPE__?.['webapp.user-detail']?.userInfo;
    if (!info?.user?.uniqueId) return null;
    return { handle: info.user.uniqueId, name: info.user.nickname, avatar: info.user.avatarThumb ?? '', followers: String(info.stats?.followerCount ?? '') };
  } catch { return null; }
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

export async function youtubeComments(url: string, pages = 5): Promise<SocialComment[]> {
  const videoId = youtubeId(url);
  const first = await yt({ videoId });
  // Comments section continuation (works for watch pages and Shorts)
  let token: string | undefined = findAll(first, 'continuationCommand').map(c => c.token).find((t: string) => t) ;
  const sections = findAll(first, 'itemSectionRenderer').find((s: any) => s.sectionIdentifier === 'comment-item-section');
  if (sections) token = findAll(sections, 'continuationCommand')[0]?.token ?? token;
  const panel = findAll(first, 'engagementPanelSectionListRenderer').find((p: any) => String(p.panelIdentifier).includes('comment'));
  if (!sections && panel) token = findAll(panel, 'continuationCommand')[0]?.token ?? token;
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

export const sameHandle = (a: string, b: string) => clean(a) === clean(b);

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
