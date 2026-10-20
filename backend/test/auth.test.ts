import { ForbiddenException, NotFoundException, type ExecutionContext } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalGuard, TUNNEL_PORT } from '../src/auth.js';

const guard = new LocalGuard();
const call = (port: number, path: string, headers: Record<string, string>, method = 'GET') =>
  guard.canActivate({
    switchToHttp: () => ({ getRequest: () => ({ socket: { localPort: port }, path, method, headers }) }),
  } as unknown as ExecutionContext);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('who may call the service', () => {
  it("takes the tunnel's requests with the deployed app's token, for the API only", () => {
    vi.stubEnv('TOOLS_TOKEN', 'a-tools-token');
    const token = { authorization: 'Bearer a-tools-token' };
    expect(call(TUNNEL_PORT, '/api/boards', token, 'POST')).toBe(true);
    expect(call(TUNNEL_PORT, '/health', token)).toBe(true);
    expect(() => call(TUNNEL_PORT, '/api/boards', {})).toThrow(ForbiddenException);
    expect(() => call(TUNNEL_PORT, '/api/boards', { authorization: 'Bearer another-token' })).toThrow(
      ForbiddenException,
    );
    expect(() => call(TUNNEL_PORT, '/', token)).toThrow(NotFoundException);
    expect(() => call(TUNNEL_PORT, '/resume-lab', token)).toThrow(NotFoundException);
  });

  it('turns the tunnel away while no token is set, whatever it sends', () => {
    vi.stubEnv('TOOLS_TOKEN', '');
    expect(() => call(TUNNEL_PORT, '/api/boards', { authorization: 'Bearer ' })).toThrow(ForbiddenException);
    expect(() => call(TUNNEL_PORT, '/api/boards', { authorization: 'Bearer undefined' })).toThrow(
      ForbiddenException,
    );
  });

  it("keeps the local rules on the service's own port, token or not", () => {
    vi.stubEnv('TOOLS_TOKEN', 'a-tools-token');
    expect(call(3100, '/api/boards', { host: '127.0.0.1:3100' })).toBe(true);
    expect(() =>
      call(3100, '/api/boards', { host: 'attacker.example:3100', authorization: 'Bearer a-tools-token' }),
    ).toThrow(ForbiddenException);
    expect(() => call(3100, '/api/boards', { host: '127.0.0.1:3100' }, 'POST')).toThrow(ForbiddenException);
    const local = { host: '127.0.0.1:3100', origin: 'http://127.0.0.1:3100', 'x-outbox-local': '1' };
    expect(call(3100, '/api/boards', local, 'POST')).toBe(true);
  });
});
