import { ForbiddenException, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/** This standalone service is local to one owner. Require the loopback host and same-origin writes. */
@Injectable()
export class LocalGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
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
