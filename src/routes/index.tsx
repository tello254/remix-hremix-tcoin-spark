import { createFileRoute } from '@tanstack/react-router';
import { DailyTasks } from '@/components/tcoins/app';
export const Route = createFileRoute('/')({
  head: () => ({ meta: [{ title: 'Daily tasks — Tcoins' }, { name: 'description', content: 'Discover daily video tasks, collect Tcoins and track your rewards.' }, { property: 'og:title', content: 'Daily tasks — Tcoins' }, { property: 'og:description', content: 'Discover daily video tasks, collect Tcoins and track your rewards.' }, { property: 'og:type', content: 'website' }, { name: 'twitter:card', content: 'summary_large_image' }] }),
  component: DailyTasks,
});
