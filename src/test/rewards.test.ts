import { describe, it, expect } from 'vitest';
import { campaignSchema, campaignSlots, commentSchema, profileSchema, validateCashout } from '@/lib/rewards';
describe('Tcoins financial and validation rules', () => {
 it('requires three words', () => { expect(commentSchema.safeParse('Great video').success).toBe(false); expect(commentSchema.safeParse('Really enjoyed this video').success).toBe(true); });
 it('enforces cashout minimum balance and phone', () => { expect(validateCashout(49,240,'0712345678')).not.toBeNull(); expect(validateCashout(250,240,'0712345678')).not.toBeNull(); expect(validateCashout(50,240,'bad')).not.toBeNull(); expect(validateCashout(50,240,'0712345678')).toBeNull(); });
 it('caps affordable completion slots', () => { expect(campaignSlots(1000,2)).toBe(500); expect(campaignSlots(9,2)).toBe(4); expect(campaignSlots(10,0)).toBe(0); });
 it('validates profile and campaign URLs', () => { expect(profileSchema.safeParse({name:'Alex',phone:'0712345678',youtube:['@alex'],tiktok:['@alex'],instagram:['@alex']}).success).toBe(true); expect(campaignSchema.safeParse({title:'Campaign',url:'https://evil.com',platform:'YouTube',thumbnail:'',budget:1000,payout:2,accessCode:'ABC1',instruction:'Comment please'}).success).toBe(false); });
});
