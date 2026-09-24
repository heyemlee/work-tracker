import { app } from './app';

// Static assets (the SPA) are served by Workers Assets; only /api/* reaches this handler.
export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;
