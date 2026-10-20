import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

const searchPlatform = z.enum(['YouTube', 'TikTok', 'Instagram']);

/** Narrow down real accounts while the user types their handle. */
export const searchAccounts = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => z.object({ platform: searchPlatform, query: z.string().trim().min(2).max(40) }).parse(d))
  .handler(async ({ data }) => {
    const s = await import('./social.server');
    try {
      if (data.platform === 'TikTok') { const a = await s.tiktokAccount(data.query); return a ? [a] : []; }
      if (data.platform === 'Instagram') { const a = await s.instagramAccount(data.query); return a ? [a] : []; }
      const [exact, list] = await Promise.all([s.youtubeAccount(data.query), s.youtubeAccounts(data.query).catch(() => [])]);
      const all = [...(exact ? [exact] : []), ...list];
      return all.filter((a, i) => all.findIndex(b => b.handle.toLowerCase() === a.handle.toLowerCase()) === i).slice(0, 6);
    } catch { return []; }
  });

const verifyPlatform = z.enum(['YouTube', 'TikTok']);

/** Verify a task: access code, a comment from ANY of the user's linked handles on that
 *  platform (up to 3 per platform are supported — comments are fetched once and matched
 *  against the whole list), and 3+ words. */
export const verifyTask = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => z.object({ platform: verifyPlatform, url: z.string().url().max(500), handles: z.array(z.string().trim().min(1).max(42)).min(1).max(3), code: z.string().trim().max(40), expectedCode: z.string().trim().min(1).max(40) }).parse(d))
  .handler(async ({ data }) => {
    if (data.code.toUpperCase() !== data.expectedCode.toUpperCase()) return { ok: false as const, reason: 'code' as const };
    const s = await import('./social.server');
    let comments;
    try { comments = data.platform === 'TikTok' ? await s.tiktokComments(data.url) : await s.youtubeComments(data.url); }
    catch (e) {
      if ((e as Error).message === 'YT_COMMENTS_DISABLED') return { ok: false as const, reason: 'comments-disabled' as const };
      return { ok: false as const, reason: 'unavailable' as const, message: (e as Error).message };
    }
    const mine = comments.filter(c => data.handles.some(h => s.sameHandle(c.handle, h)));
    if (!mine.length) return { ok: false as const, reason: 'no-comment' as const };
    const best = mine.reduce((a, b) => (b.text.split(/\s+/).filter(Boolean).length > a.text.split(/\s+/).filter(Boolean).length ? b : a));
    const words = best.text.split(/\s+/).filter(Boolean).length;
    if (words < 3) return { ok: false as const, reason: 'short' as const, quote: best.text };
    return { ok: true as const, quote: best.text };
  });

const SAFE_GET = (u: string) => fetch(u, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });

/** Real video length in seconds (drives the task viewing gate). Falls back to 45s. */
export const videoSeconds = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => z.object({ platform: z.enum(['YouTube', 'TikTok', 'Instagram']), url: z.string().url().max(500) }).parse(d))
  .handler(async ({ data }) => {
    const fallback = 45;
    try {
      if (data.platform === 'YouTube') {
        const id = /[?&]v=([\w-]{6,})/.exec(data.url)?.[1] ?? /youtu\.be\/([\w-]{6,})/.exec(data.url)?.[1];
        if (!id) return fallback;
        const html = await (await SAFE_GET(`https://www.youtube.com/watch?v=${id}`)).text();
        return Number(/"lengthSeconds":"(\d+)"/.exec(html)?.[1]) || fallback;
      }
      if (data.platform === 'TikTok') {
        // Short links (vm.tiktok.com) resolve via oEmbed → embed iframe → embed page carries the duration.
        const oe = await (await SAFE_GET(`https://www.tiktok.com/oembed?url=${encodeURIComponent(data.url)}`)).json() as { html?: string };
        const fromEmbed = /embed\/v2\/(\d+)/.exec(oe.html ?? '')?.[1] ?? /embed\/vt\/(\d+)/.exec(oe.html ?? '')?.[1];
        const id = fromEmbed ?? /\/video\/(\d+)/.exec(data.url)?.[1] ?? /\/photo\/(\d+)/.exec(data.url)?.[1];
        if (!id) return fallback;
        const page = await (await SAFE_GET(`https://www.tiktok.com/embed/v2/${id}`)).text();
        return Number(/"duration":(\d+)/.exec(page)?.[1]) || fallback;
      }
      return fallback;
    } catch { return fallback; }
  });
