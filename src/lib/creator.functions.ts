import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { supabaseAdmin } from './supabase.server';
import type { Campaign, Platform } from '../components/tcoins/state';

/**
 * Creator studio — the creators' door to the task pool. A launched campaign is a real
 * row in `campaigns` (budget-cap + slot arithmetic live in the DB), and every signed-in
 * user's dashboard pulls the pool straight from the table, so a launch shows up in
 * assigned tasks without any scraping anywhere.
 */

export type CampaignRow = {
  id: string;
  title: string;
  url: string;
  platform: 'youtube' | 'tiktok' | 'instagram';
  thumbnail: string;
  budget_ksh: number;
  payout_ksh: number;
  access_code: string;
  instruction: string;
  duration: string;
  slots: number;
  completed: number;
  creator_name: string;
};

/** DB row → the Campaign shape the UI consumes. */
const platformFromDb = (db: string): Platform => db.toLowerCase() === 'tiktok' ? 'TikTok' : db.toLowerCase() === 'instagram' ? 'Instagram' : 'YouTube';
export const rowToCampaign = (row: CampaignRow): Campaign => {
  const platform = platformFromDb(row.platform);
  const ytId = platform === 'YouTube' ? row.url.match(/[?&]v=([\w-]{11})/)?.[1] : undefined;
  const thumb = row.thumbnail || (ytId ? `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg` : '');
  return {
    id: row.id,
    title: row.title,
    creator: row.creator_name || `@creator`,
    platform,
    thumbnail: thumb,
    url: row.url,
    budget: Number(row.budget_ksh),
    payout: Number(row.payout_ksh),
    completed: row.completed,
    slots: row.slots,
    duration: row.duration || '—',
    accessCode: row.access_code,
    instruction: row.instruction || 'Watch the full video, then leave a genuine 3+ word comment from your linked handle.',
  };
};

/** Studio code check — the ONLY authoritative gate (client prompt is just UX). */
const adminOk = (code: string) => code === ((typeof process !== 'undefined' && process.env?.STUDIO_CODE) || '2050');

export const createCampaign = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => z.object({
    adminCode: z.string().min(1).max(10),
    title: z.string().trim().min(3).max(100),
    url: z.string().url().min(10).max(500),
    platform: z.enum(['YouTube', 'TikTok', 'Instagram']),
    thumbnail: z.string().max(500).optional(),
    budget: z.number().min(1).max(1000000),
    payout: z.number().min(0.1).max(10000),
    accessCode: z.string().regex(/^[A-Z0-9-]{3,20}$/),
    instruction: z.string().max(200).optional(),
    creatorName: z.string().trim().max(40).optional(),
    creatorId: z.string().uuid().optional(),
  }).parse(d))
  .handler(async ({ data }) => {
    // Studio is admin-only: the code is enforced HERE (server), not just in the UI.
    if (!adminOk(data.adminCode)) return { ok: false as const, error: 'unauthorized_studio' };
    const { data: row, error } = await supabaseAdmin.from('campaigns').insert({
      title: data.title,
      url: data.url,
      platform: data.platform.toLowerCase(),
      thumbnail: data.thumbnail || '',
      budget_ksh: data.budget,
      payout_ksh: data.payout,
      access_code: data.accessCode,
      instruction: data.instruction ?? '',
      duration: '—',
      creator_name: data.creatorName ?? '',
      creator_id: data.creatorId ?? null,
    }).select().single();
    if (error || !row) return { ok: false as const, error: error?.message ?? 'insert_failed' };
    return { ok: true as const, campaign: rowToCampaign(row as CampaignRow) };
  });

/** Control center: list EVERY campaign (active, paused, or exhausted) — not just the user-facing pool. */
export const listCampaigns = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => z.object({ adminCode: z.string().min(1).max(10) }).parse(d))
  .handler(async ({ data }) => {
    if (!adminOk(data.adminCode)) return { ok: false as const, error: 'unauthorized_studio' as const };
    const { data: rows, error } = await supabaseAdmin.from('campaigns').select('*').order('created_at', { ascending: false }).limit(200);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, rows: rows as (CampaignRow & { active: boolean })[] };
  });

/** Full edit from the studio: every field including access code, budget, payout, requirements, and visibility. */
export const updateCampaign = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => z.object({
    adminCode: z.string().min(1).max(10),
    id: z.string().uuid(),
    title: z.string().trim().min(3).max(100).optional(),
    url: z.string().url().min(10).max(500).optional(),
    platform: z.enum(['YouTube', 'TikTok', 'Instagram']).optional(),
    thumbnail: z.string().max(500).optional(),
    budget: z.number().min(1).max(1000000).optional(),
    payout: z.number().min(0.1).max(10000).optional(),
    accessCode: z.string().regex(/^[A-Z0-9-]{3,20}$/).optional(),
    instruction: z.string().max(200).optional(),
    active: z.boolean().optional(),
    /** accepted for client convenience — slots is GENERATED in the DB, never written */
    slots: z.number().int().min(1).max(500000).optional(),
  }).parse(d))
  .handler(async ({ data }) => {
    if (!adminOk(data.adminCode)) return { ok: false as const, error: 'unauthorized_studio' as const };
    // slots = budget ÷ payout (generated always stored) — validate the derived value, never write it
    const { data: cur } = await supabaseAdmin.from('campaigns').select('completed, budget_ksh, payout_ksh').eq('id', data.id).single();
    if (cur) {
      const b = data.budget ?? Number(cur.budget_ksh);
      const p = data.payout ?? Number(cur.payout_ksh);
      const derived = Math.floor(b / p);
      if (Number(cur.completed) > derived) return { ok: false as const, error: `slots_below_completed(${cur.completed})` as const };
    }
    const patch: Record<string, unknown> = {};
    if (data.title !== undefined) patch.title = data.title;
    if (data.url !== undefined) patch.url = data.url;
    if (data.platform !== undefined) patch.platform = data.platform.toLowerCase();
    if (data.thumbnail !== undefined) patch.thumbnail = data.thumbnail;
    if (data.budget !== undefined) patch.budget_ksh = data.budget;
    if (data.payout !== undefined) patch.payout_ksh = data.payout;
    if (data.accessCode !== undefined) patch.access_code = data.accessCode;
    if (data.instruction !== undefined) patch.instruction = data.instruction;
    if (data.active !== undefined) patch.active = data.active;
    if (!Object.keys(patch).length) return { ok: false as const, error: 'empty_patch' as const };
    const { data: row, error } = await supabaseAdmin.from('campaigns').update(patch).eq('id', data.id).select().single();
    if (error || !row) return { ok: false as const, error: error?.message ?? 'update_failed' };
    return { ok: true as const, campaign: rowToCampaign(row as CampaignRow) };
  });
