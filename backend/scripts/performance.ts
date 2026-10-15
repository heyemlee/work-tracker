import { z } from 'zod';
import { runPerformance } from '../src/performance/runner.js';

const schema = z.strictObject({
  rows: z.coerce.number().int().min(1000).max(100_000).default(20_000),
  repetitions: z.coerce.number().int().min(5).max(50).default(11),
  requests: z.coerce.number().int().min(30).max(3000).default(120),
  concurrency: z.coerce.number().int().min(1).max(16).default(6),
});
async function main() {
  const args: Record<string, string> = {};
  for (const flag of process.argv.slice(2)) {
    const match = flag.match(/^--(rows|repetitions|requests|concurrency)=(\d+)$/);
    if (!match || args[match[1]])
      throw new Error(
        'Usage: npm run perf -- [--rows=20000] [--repetitions=11] [--requests=120] [--concurrency=6]',
      );
    args[match[1]] = match[2];
  }
  const options = schema.parse(args);
  const result = await runPerformance(options, (message) => process.stderr.write(message + '\n'));
  process.stdout.write(
    `实验完成，查询结果一致。报告：${result.folder}/REPORT.md\n临时实验数据已清理，原有岗位数据未修改。\n`,
  );
}
main().catch((error: unknown) => {
  // Connection errors can contain host/credential details; expose only expected messages.
  process.stderr.write(
    error instanceof Error &&
      /Usage:|性能实验|同名数据库|Benchmark query|Results differ|Cache |Invalid lab|Expected |Materialized |Unstable result/.test(
        error.message,
      )
      ? error.message + '\n'
      : '实验未完成。请确认专用 PostgreSQL/Redis 已启动，参数有效；不会改动现有岗位库。\n',
  );
  process.exitCode = 1;
});
