import { createFileRoute } from '@tanstack/react-router';
import { ReferralsPage } from '@/components/tcoins/app';
export const Route = createFileRoute('/referrals')({
  head: () => ({ meta: [{ title: 'Bring your people — Tcoins' }, { name: 'description', content: 'Invite friends and earn direct referral rewards.' }, { property: 'og:title', content: 'Bring your people — Tcoins' }, { property: 'og:description', content: 'Invite friends and earn direct referral rewards.' }, { property: 'og:type', content: 'website' }, { name: 'twitter:card', content: 'summary_large_image' }] }),
  component: ReferralsPage,
});
