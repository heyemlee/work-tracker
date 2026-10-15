import { createApp } from './app.js';

const app = await createApp();
// The aggregation page is a separate local tool for one owner.
await app.listen(Number(process.env.PORT ?? 3100), '127.0.0.1');
