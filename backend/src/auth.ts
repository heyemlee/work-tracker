import { createHash, timingSafeEqual } from 'node:crypto';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';

/** The loopback port where the Cloudflare Tunnel brings the deployed app's requests, open only with TOOLS_TOKEN set. */
export const TUNNEL_PORT = 3101;
export const toolsToken = () => process.env.TOOLS_TOKEN?.trim() || undefined;

const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * This standalone service is local to one owner. On its own port it requires the loopback host and same-origin
 * writes; on the tunnel's port, the deployed Worker's token, and only the API.
 */
@Injectable()
export class LocalGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.socket.localPort === TUNNEL_PORT) return fromTunnel(request);
    const allowed = [`127.0.0.1:${request.socket.localPort}`, `localhost:${request.socket.localPort}`];
    const host = request.headers.host;
    if (!host || !allowed.includes(host))
      throw new ForbiddenException('Open the local job aggregation page.');
    const origin = request.headers.origin;
    if (origin && origin !== `http://${host}`) throw new ForbiddenException('Request origin does not match.');
    if (!['GET', 'HEAD'].includes(request.method) && request.headers['x-outbox-local'] !== '1')
      throw new ForbiddenException('Use the local page to make changes.');
    return true;
  }
}

/** The Worker has checked the owner's session; the token the two share says the request came from it. */
function fromTunnel(request: Request) {
  const token = toolsToken(),
    presented = /^Bearer (\S+)$/.exec(request.headers.authorization ?? '')?.[1];
  if (!token || !presented || !timingSafeEqual(digest(presented), digest(token)))
    throw new ForbiddenException('Wrong tools token.');
  // The service's own pages stay on this computer.
  if (!/^\/(health$|api\/)/.test(request.path)) throw new NotFoundException();
  return true;
}
