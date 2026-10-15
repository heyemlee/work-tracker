import { createApp } from '../src/app.js';
import { Aggregation } from '../src/aggregation.js';

const app = await createApp();
try {
  await app.init();
  console.log(JSON.stringify(await app.get(Aggregation).syncAll(), null, 2));
} finally {
  await app.close();
}
