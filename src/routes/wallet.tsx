import { createFileRoute } from '@tanstack/react-router';
import { WalletPage } from '@/components/tcoins/app';
export const Route = createFileRoute('/wallet')({
  head: () => ({ meta: [{ title: 'My wallet — Tcoins' }, { name: 'description', content: 'Track rewards and simulated instant cashouts.' }, { property: 'og:title', content: 'My wallet — Tcoins' }, { property: 'og:description', content: 'Track rewards and simulated instant cashouts.' }, { property: 'og:type', content: 'website' }, { name: 'twitter:card', content: 'summary_large_image' }] }),
  component: WalletPage,
});
