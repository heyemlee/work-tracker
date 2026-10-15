import type { BenchmarkReport } from './runner.js';
import { planNodes, type Measurement } from './measure.js';

const ms = (value: number) => value.toFixed(3);
const names: Record<string, string> = {
  'recent-jobs': '最新岗位',
  'keyword-search': '关键词搜索',
  'company-remote': '指定公司的远程岗位',
};
const planSummary = (measurement: Measurement) =>
  [...new Set(planNodes(measurement.plan).map((node) => node['Index Name'] ?? node['Node Type']))].join(
    ' → ',
  );
export function renderReport(report: BenchmarkReport) {
  const indexRows = report.indexes.baseline
    .map((before, index) => {
      const after = report.indexes.indexed[index];
      return `| ${names[before.name]} | ${ms(before.client.p50Ms)} / ${ms(before.client.p95Ms)} | ${ms(after.client.p50Ms)} / ${ms(after.client.p95Ms)} | ${before.sharedHitBlocks} → ${after.sharedHitBlocks} |`;
    })
    .join('\n');
  const partitionRows = report.partitions
    .map((item) => {
      const touched = new Set(
        planNodes(item.partitioned.plan)
          .filter(
            (node) => (node['Actual Loops'] ?? 0) > 0 && node['Relation Name']?.startsWith('observations_m'),
          )
          .map((node) => node['Relation Name']),
      );
      return `| ${item.range === 'one-month' ? '单月' : '全部历史'} | ${ms(item.flat.client.p50Ms)} / ${ms(item.flat.client.p95Ms)} | ${ms(item.partitioned.client.p50Ms)} / ${ms(item.partitioned.client.p95Ms)} | ${touched.size} / 12 |`;
    })
    .join('\n');
  const cacheRows = report.cache.rounds
    .map(
      (round, index) =>
        `| ${index + 1} | ${ms(round.uncached.latency.p50Ms)} / ${ms(round.uncached.latency.p95Ms)} | ${ms(round.warm.latency.p50Ms)} / ${ms(round.warm.latency.p95Ms)} | ${round.uncached.databaseReads} → ${round.warm.databaseReads} | ${ms(round.uncached.wallMs)} → ${ms(round.warm.wallMs)} |`,
    )
    .join('\n');
  const view = report.materializedView;
  return `# Outbox 本地数据库性能实验

运行时间：${report.startedAt}。这是合成数据、本机 Docker、预热后的开发实验，结果仅适用于本次本地测试条件。

## 条件与隔离

- 数据：${report.data.boards} 家虚构公司、${report.data.jobs} 条岗位；两种历史表各 ${report.data.observationsPerLayout} 行。
- 固定生成规则、固定日期和查询参数。每条 SQL 先执行两次预热，再采样 ${report.options.repetitions} 次，使用实际排序样本的 nearest-rank P50/P95。样本少，P95 主要用于发现离群值，不是容量或服务等级结论。
- SQL 表中的延迟单位都是毫秒，格式为 P50 / P95，包含本地数据库往返与结果解码。JSON 中另附一次 EXPLAIN ANALYZE 的服务器执行时间和完整执行计划；其计时口径不同，不直接混用。
- 前后逐次验证结果 hash 相同。没有关闭顺序扫描或强制优化器选用索引，没有清理宿主机或 PostgreSQL 的缓存。
- 使用专用数据库 outbox_performance_lab 和每轮新建的临时 schema；现有 outbox 数据库、Prisma 迁移、API 和页面不接入此实验。
- 临时 schema 已清理：${report.cleanedUp ? '是' : '否'}。Redis 只删除本轮创建的键，没有使用 FLUSHDB/FLUSHALL；专用缓存不持久化。

## 索引

基线保留主键、外键、唯一约束；第二阶段加入岗位聚合模块已经具备的查询索引。因此这是解释现有设计的对照实验，不代表本轮给产品新增了这些索引。

| 同一查询 | 仅约束索引 P50 / P95 | 当前索引 P50 / P95 | EXPLAIN shared-hit blocks |
| --- | ---: | ---: | ---: |
${indexRows}

查询计划：

${report.indexes.baseline.map((before, index) => `- ${names[before.name]}：基线 ${planSummary(before)}；加索引后 ${planSummary(report.indexes.indexed[index])}。`).join('\n')}

建立索引及更新统计信息共 ${ms(report.indexes.indexBuildMs)} ms。Job 表连同索引从 ${(report.indexes.baselineBytes / 1024 / 1024).toFixed(2)} MiB 增至 ${(report.indexes.indexedBytes / 1024 / 1024).toFixed(2)} MiB。这里未测写入吞吐、更新维护成本、冷启动或并发写入，不能据此断言索引越多越好。shared-hit blocks 是一次执行的缓冲区命中访问数，不是物理磁盘 I/O 或 CPU 使用率，父子节点没有相加。

## 物化视图

同一份“每家公司全部/在招/远程岗位数量”结果，实时聚合 ${ms(view.aggregate.client.p50Ms)} / ${ms(view.aggregate.client.p95Ms)} ms，读取物化视图 ${ms(view.materialized.client.p50Ms)} / ${ms(view.materialized.client.p95Ms)} ms。

创建视图和唯一索引 ${ms(view.viewBuildMs)} ms；一次 REFRESH MATERIALIZED VIEW CONCURRENTLY ${ms(view.refreshMs)} ms。实验更新一条岗位后，旧视图仍保留旧数量；显式刷新后与实时统计一致（已验证）。源数据随后恢复，其他对比使用同一组岗位。

物化视图适合允许短暂延迟的统计，会产生存储和刷新成本。当前公司列表仍实时计算岗位数；本次没有将它切换到有刷新延迟的视图。

## 分区

历史记录采用按月 RANGE 分区，与普通表使用相同的主键、时间索引和相同记录。时间范围查询和全历史查询都做对比：

| 范围 | 普通表 P50 / P95 | 分区表 P50 / P95 | 实际触达月分区 |
| --- | ---: | ---: | ---: |
${partitionRows}

查看 JSON 的执行计划可核对裁剪和扫描方式。普通表已有合适索引时，分区不保证更快；全历史统计通常仍要访问所有月份。此处只演示历史记录的读路径，没有测历史保留、分区维护、写入和不同数据规模。稳定岗位 ID 与投递记录没有迁移到分区表。

## Redis

使用已加索引的查询，三个固定查询按轮换顺序发送，每批 ${report.options.requests} 次请求、并发 ${report.options.concurrency}。这是服务函数和数据库/Redis 往返测试，没有经过 HTTP、浏览器或真实流量；其中 SQL 已执行过预热。三轮中交替安排直接读库和热缓存的先后。

| 轮次 | 直接读库 P50 / P95 | 热缓存 P50 / P95 | 岗位 SELECT 次数 | 整批耗时 ms |
| --- | ---: | ---: | ---: | ---: |
${cacheRows}

冷缓存批次：${report.cache.cold.databaseReads} 次岗位 SELECT，P50 / P95 ${ms(report.cache.cold.latency.p50Ms)} / ${ms(report.cache.cold.latency.p95Ms)} ms；同一键并发首次读取会共用一次查询。热缓存阶段没有源数据更新，不能代表频繁更新或低命中率的流量。

已验证：结果一致、Redis 实际 TTL 到期、revision 改变后重新读源、Redis 连接断开后回退 PostgreSQL；单元测试另覆盖缓存内容损坏、网络读写失败、不同选择范围隔离以及失效期间的旧请求写入。这里的数据库计数仅指批次触发的岗位 SELECT，不含建表、测量、预热和连接管理，也不是“数据库负载降低”的测量。没有测 CPU、磁盘、尾部大流量或会话缓存。

缓存键包含查询参数、选择范围和数据 revision；30 秒 TTL 是过期兜底。未来接入产品时，数据同步或关注公司变化必须推进 revision，否则 TTL 之前允许旧结果存在。当前接口仍保持原有读库逻辑。

## 环境与复现

Node ${report.environment.node}，${report.environment.platform}/${report.environment.arch}，CPU ${report.environment.cpu}（${report.environment.logicalCpus} 个逻辑核）。这是宿主机信息，不代表容器独占这些资源。Redis ${report.environment.redis}。

PostgreSQL：${report.environment.postgres_version}。

shared_buffers=${report.environment.shared_buffers}，work_mem=${report.environment.work_mem}，jit=${report.environment.jit}，max_parallel_workers_per_gather=${report.environment.parallel_workers_per_gather}。没有修改服务器全局设置。

\`\`\`sh
npm run perf:up
npm run build
npm run perf -- --rows=${report.options.rows} --repetitions=${report.options.repetitions} --requests=${report.options.requests} --concurrency=${report.options.concurrency}
\`\`\`

完整样本、SQL、参数和执行计划在同目录 results.json。每次运行保留新的报告目录，不覆盖旧结果。本报告仅记录这次运行，结果可能随宿主机负载、Docker 配额和缓存状态变化。

技术依据：[PostgreSQL EXPLAIN](https://www.postgresql.org/docs/17/using-explain.html)、[物化视图](https://www.postgresql.org/docs/17/rules-materializedviews.html)、[分区](https://www.postgresql.org/docs/17/ddl-partitioning.html)、[node-redis](https://redis.io/docs/latest/develop/clients/nodejs/)。
`;
}
