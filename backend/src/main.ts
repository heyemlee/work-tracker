import { Logger } from '@nestjs/common';
import { createServer } from 'node:http';
import { createApp } from './app.js';
import { TUNNEL_PORT, toolsToken } from './auth.js';

const app = await createApp();
// The aggregation page is a separate local tool for one owner.
await app.listen(Number(process.env.PORT ?? 3100), '127.0.0.1');
// With a token, a second loopback port for the deployed app's requests, which the Cloudflare Tunnel brings here.
if (toolsToken())
  createServer(app.getHttpAdapter().getInstance())
    .on('error', (error) => new Logger('Tunnel').error(`Port ${TUNNEL_PORT}: ${error.message}`))
    .listen(TUNNEL_PORT, '127.0.0.1');
