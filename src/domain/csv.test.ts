import { describe, expect, it } from 'vitest';
import { toCsv } from './csv';
import { account, application, company, job, snapshot } from './testing';

describe('toCsv', () => {
  it('writes one line per application and one per saved job, escaping as needed', () => {
    const data = snapshot({
      accounts: [account('a', 'A')],
      channels: [{ id: 'ch', name: 'referral', builtin: true }],
      companies: [company('c1', 'Acme, "Robotics"'), company('c2', 'Lumen Labs')],
      jobs: [
        { ...job('j1', 'c1', 'SWE'), notes: 'line one\nline two' },
        job('j2', 'c2', null, '2026-08-01T00:00:00.000Z'),
      ],
      applications: [application('p1', 'j1', 'a', { channelId: 'ch', stage: 'oa' })],
    });

    expect(toCsv(data).split('\r\n')).toEqual([
      'company,title,account,email,channel,resume,stage,rejected,applied_at,notes',
      '"Acme, ""Robotics""",SWE,A,a@example.com,referral,,oa,no,2026-09-01,"line one\nline two"',
      'Lumen Labs,,,,,,saved,,,',
      '',
    ]);
  });
});
