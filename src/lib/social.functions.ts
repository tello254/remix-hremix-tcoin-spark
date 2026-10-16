import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

const platform = z.enum(['YouTube', 'TikTok']);

/** Narrow down real accounts while the user types their handle. */
export const searchAccounts = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => z.object({ platform, query: z.string().trim().min(2).max(40) }).parse(d))
  .handler(async ({ data }) => {
    const s = await import('./social.server');
    try {
      if (data.platform === 'TikTok') { const a = await s.tiktokAccount(data.query); return a ? [a] : []; }
      const [exact, list] = await Promise.all([s.youtubeAccount(data.query), s.youtubeAccounts(data.query).catch(() => [])]);
      const all = [...(exact ? [exact] : []), ...list];
      return all.filter((a, i) => all.findIndex(b => b.handle.toLowerCase() === a.handle.toLowerCase()) === i).slice(0, 6);
    } catch { return []; }
  });

/** Verify a task: access code, handle present in comments, and 3+ word comment. */
export const verifyTask = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => z.object({ platform, url: z.string().url().max(500), handle: z.string().trim().min(2).max(42), code: z.string().trim().max(40), expectedCode: z.string().trim().min(1).max(40) }).parse(d))
  .handler(async ({ data }) => {
    if (data.code.toUpperCase() !== data.expectedCode.toUpperCase()) return { ok: false as const, reason: 'code' as const };
    const s = await import('./social.server');
    let comments;
    try { comments = data.platform === 'TikTok' ? await s.tiktokComments(data.url) : await s.youtubeComments(data.url); }
    catch (e) { return { ok: false as const, reason: 'unavailable' as const, message: (e as Error).message }; }
    const mine = comments.filter(c => s.sameHandle(c.handle, data.handle));
    if (!mine.length) return { ok: false as const, reason: 'no-comment' as const };
    const best = mine.reduce((a, b) => (b.text.split(/\s+/).filter(Boolean).length > a.text.split(/\s+/).filter(Boolean).length ? b : a));
    const words = best.text.split(/\s+/).filter(Boolean).length;
    if (words < 3) return { ok: false as const, reason: 'short' as const, quote: best.text };
    return { ok: true as const, quote: best.text };
  });
