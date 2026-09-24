import { app } from './app';
import { createDb } from './db';
import { purgeExpiredDemos } from './demo';

// Static assets (the SPA) are served by Workers Assets; only /api/* reaches the fetch handler.
export default {
  fetch: app.fetch,
  // Hourly cron: delete demo sandboxes older than a day.
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(purgeExpiredDemos(createDb(env.DEMO_DB)));
  },
} satisfies ExportedHandler<Env>;
