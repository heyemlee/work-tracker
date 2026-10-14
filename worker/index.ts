import { app } from './app';
import { assetOrNotFound } from './assets';

// Static assets (the SPA) are served by Workers Assets; /api/* and /assets/* reach this handler first.
export default {
  fetch(request, env, ctx) {
    if (new URL(request.url).pathname.startsWith('/assets/')) return assetOrNotFound(request, env.ASSETS);
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
