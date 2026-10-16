import { createFileRoute } from '@tanstack/react-router';
import { AccountPage } from '@/components/tcoins/app';
export const Route = createFileRoute('/account')({
  head: () => ({ meta: [{ title: 'Your account — Tcoins' }, { name: 'description', content: 'Set up your phone number and social handles.' }, { property: 'og:title', content: 'Your account — Tcoins' }, { property: 'og:description', content: 'Set up your phone number and social handles.' }, { property: 'og:type', content: 'website' }, { name: 'twitter:card', content: 'summary_large_image' }] }),
  component: AccountPage,
});
