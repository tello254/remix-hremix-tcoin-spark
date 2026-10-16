import { createFileRoute } from '@tanstack/react-router';
import { CreatorPage } from '@/components/tcoins/app';
export const Route = createFileRoute('/creator')({
  head: () => ({ meta: [{ title: 'Creator studio — Tcoins' }, { name: 'description', content: 'Manage video campaigns, capped budgets and activity.' }, { property: 'og:title', content: 'Creator studio — Tcoins' }, { property: 'og:description', content: 'Manage video campaigns, capped budgets and activity.' }, { property: 'og:type', content: 'website' }, { name: 'twitter:card', content: 'summary_large_image' }] }),
  component: CreatorPage,
});
