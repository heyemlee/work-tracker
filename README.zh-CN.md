<div align="center">

<img src="src/assets/outbox.svg" width="64" height="64" alt="" />

# Outbox

**用你的个人资料自动填写求职申请，每一份投递都记得清清楚楚。**

求职投递追踪器：配套的 Chrome 扩展用你的资料填写申请表，提交后自动记到 Outbox；一个 NestJS 服务从招聘网站汇总在招岗位，并用大模型解析简历。

[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?style=flat-square&logo=typescript&logoColor=white)](tsconfig.json)
[![React](https://img.shields.io/badge/React-19-149ECA?style=flat-square&logo=react&logoColor=white)](package.json)
[![Cloudflare](https://img.shields.io/badge/Cloudflare-Workers_%2B_D1-F38020?style=flat-square&logo=cloudflare&logoColor=white)](wrangler.jsonc)
[![Chrome](https://img.shields.io/badge/Chrome-MV3_extension-4285F4?style=flat-square&logo=googlechrome&logoColor=white)](extension)
[![CI](https://img.shields.io/badge/CI-GitHub_Actions-2088FF?style=flat-square&logo=githubactions&logoColor=white)](https://github.com/heyemlee/work-tracker/actions/workflows/ci.yml)

[English](README.md) · **简体中文**

[技术亮点](#技术亮点) · [系统架构](#系统架构) · [技术栈](#技术栈) · [功能](#功能) · [本地开发](#本地开发)

</div>

<p align="center">
  <img src="docs/screenshots/autofill.webp" width="960" alt="Outbox Autofill 扩展卡片在 Greenhouse 申请页上：必填 9/9 全部填好，两条工作许可的答案留给本人确认，提交后记到 Outbox" />
</p>

<p align="center"><sub>虚构的岗位和资料，申请页是仿 Greenhouse 的替身页面。</sub></p>

## 技术亮点

- **规则优先，Claude 兜底。** Chrome MV3 扩展为 9 个招聘系统（ATS）各写了适配器，先按规则填写：在 22 个保存下来的申请页上，人工核对的 365 个答案全部正确；只把剩下的字段交给 Claude。
- **可评测的简历解析。** 用 function calling 或 structured output 解析简历，每个结果都要通过严格的 zod 校验，评测 CLI 逐字段给两种方式打分。
- **PostgreSQL 里的岗位数据。** NestJS 服务按公司在一个事务里同步招聘接口，读取失败时保留已存的岗位，提供全文搜索，并对索引、分区和 Redis 缓存做性能对比。
- **一个 Worker，一份契约。** 一个 Cloudflare Worker 提供 React 网页和基于 D1 的 Hono API；同一套 `Repository` 契约测试分别跑在浏览器存储和 workerd 里的 D1 上。
- **端到端测试。** Vitest 覆盖领域规则、契约和扩展的适配器；CI 里用 Playwright 在 Chromium 中对保存的页面端到端运行扩展。

## 系统架构

<p align="center">
  <img src="docs/architecture.svg" width="960" alt="网页应用和自动填表扩展都连到同一个 Cloudflare Worker：它提供网页、运行带 Better Auth 的 Hono API，数据存在 D1；扩展只把规则放不下的字段交给 Claude；岗位发现和简历工具背后的 NestJS 服务从公开招聘接口读取岗位存进 PostgreSQL，并用 OpenAI 或 Anthropic 解析简历" />
</p>

一个 Worker 提供构建好的网页，并在 `/api` 下运行 API，数据存在 D1。扩展从这个 API 读取资料和简历 PDF，提交后也记到这里；它的 AI key 只存在扩展里。岗位发现和简历工具通过开发服务器连接 `backend/` 里的 NestJS 服务，所以生产构建里这两个页面显示为不可用。

- **默认私有。** 只能用 Google 登录，且只有白名单邮箱能创建账号。每个查询都限定在当前登录用户名下，请求体都经过校验，跨站表单提交会被拒绝。
- **为 D1 设计。** 多行写入作为一个原子批次发出，并按 D1 每条语句最多 100 个绑定参数拆分；删除是软删除，所以能撤销。

## 技术栈

| 层       | 技术                                                                             | 作用                                                                  |
| -------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 网页应用 | React 19 · TypeScript · Vite · Tailwind CSS v4 · Motion · Radix · TanStack Query | 投递列表、数据页、岗位发现、简历工具、资料和首次使用引导              |
| API      | Cloudflare Workers · Hono · zod · Better Auth                                    | 一个 Worker 同时提供网页和 `/api`；白名单邮箱用 Google 登录           |
| 数据     | D1（SQLite）· Drizzle                                                            | 岗位、投递、时间线、个人资料和简历 PDF                                |
| 扩展     | Chrome Manifest V3 · WXT · React 19 · pdf.js · Anthropic TypeScript SDK          | 按规则填写申请表，其余交给 Claude，提交后自动记录                     |
| 服务     | NestJS · Prisma · PostgreSQL · Redis                                             | [`backend/`](backend)：岗位聚合与搜索、简历解析与评测、数据库性能对比 |
| 质量     | Vitest · Playwright · ESLint（含 React Compiler 规则）· Prettier                 | 领域、契约和适配器测试；CI 里在 Chromium 中端到端测试扩展             |

## 功能

### 自动填表扩展

[`extension/`](extension) 里的扩展用你在 Outbox 维护的资料填写申请表，提交后把这份申请记到 Outbox。它从不替你点提交：每个答案都由你检查过再提交。

- **规则优先。** Greenhouse、Lever、Ashby、Workday、Gem、iCIMS、SmartRecruiters、Workable 和 Jobvite 各有适配器操作表单控件，其他表单走通用适配器。工作许可按岗位所在国家用固定规则回答，从不交给模型，并且总会标出来请你确认。
- **剩下的交给 Claude。** 规则放不下的字段，每张表单只发一次请求给 Claude；置信度低于 0.7 的留空。开放式问题会根据简历和岗位写一段简短的草稿。
- **填之前先做匹配检查：** 是否要求公民身份或安全许可、资历要求、这家公司的 H-1B 批准记录，以及近 30 天你投了它几个岗位。只提醒，从不拦着。
- **自动记录。** 提交后的确认页一加载，这份申请就带着渠道、简历版本和链接记到 Outbox，并且可以撤销。

只用规则（不用 AI）在 22 个保存下来的申请页上的填写准确率，每个期望答案都人工核对过：

| 系统       | 页面数 |  答案正确 | 必填项填写率 |
| ---------- | -----: | --------: | -----------: |
| Greenhouse |     10 | 172 / 172 |          87% |
| Lever      |      6 | 115 / 115 |          79% |
| Ashby      |      6 |   78 / 78 |          77% |

留空的必填项是开放式问题和只有申请人自己能答的问题。Workday（需要登录才能看到表单）、iCIMS、SmartRecruiters、Workable 和 Jobvite 在仿照各自表单的页面上测试。设计文档见 [docs/autofill.md](docs/autofill.md)。

### 岗位发现、简历工具与投递追踪

<p align="center">
  <img src="docs/screenshots/app.webp" width="960" alt="在岗位发现里多关注一家公司、同步并保存一个岗位；在简历工具里读取简历、解析并存进个人资料；再在追踪器里把保存的岗位标记为已投递" />
</p>

<p align="center"><sub>公司、岗位和简历均为虚构，界面为「纯白」外观。</sub></p>

**岗位发现**汇总你关注的公司的在招岗位。

- 从公司目录里勾选，或者填一个 Greenhouse、Lever、Ashby 的招聘页链接添加新公司；服务会先验证招聘源再保存。
- 每家公司的公开招聘接口完整读完后，在一个事务里写进 PostgreSQL。消失的岗位标为下架，重新出现时恢复；请求超时或返回格式不对时，保留已存的岗位。
- 按职位或关键词全文搜索，可按地点、公司和是否远程筛选。保存的岗位进入追踪器成为「待投递」，并按已有岗位去重。

**简历工具**把简历读进你的个人资料。

- 最大 5 MB 的 PDF 或 DOCX 在本机的独立线程里读取；点击「开始解析」之前，内容不会发给任何模型。
- OpenAI 或 Anthropic，用 function calling 或 structured output。拒答、截断或多出未知字段都过不了 zod 校验，直接报错而不是自动补值；评测 CLI 对照参考标签给两种方式打分。
- 结果作为草稿打开在个人资料页：联系方式只填空白项，勾选的部分替换对应草稿，技能合并；点保存之前什么都不会写入。

**投递追踪**记下每份申请从待投递到 Offer 的过程。

- 每条投递记录所用的渠道和简历版本，按「已投递 → OA → Offer」推进。被拒是一个标记而不是阶段，所以「OA 后被拒」仍保留 OA 阶段。
- 用键盘五秒左右记一条投递，或者直接粘贴岗位链接；添加和删除都能撤销。
- 数据页展示投递漏斗，以及每个简历版本和渠道的 OA 率。Liquid Glass 外观在 Chromium 里有真实折射，中英双语，CSV 导出，手机上也好用。

## 本地开发

```bash
npm install
cp .dev.vars.example .dev.vars     # 把 BETTER_AUTH_SECRET 设为任意一串足够长的随机字符
npm run db:migrate:local
npm run dev                        # http://127.0.0.1:5180，以本地开发者身份登录
npm run dev:local                  # 样例数据存在浏览器里，不需要后端
npm run ext:build                  # 构建扩展，输出到 extension/.output/chrome-mv3
npm --prefix backend run infra:up  # 岗位发现和简历工具背后服务的 PostgreSQL
npm --prefix backend run dev       # 启动服务，127.0.0.1:3100，与 npm run dev 同时运行
npm run icons                      # 用小果冻静止时的样子重新生成网页和扩展的图标
```

服务的首次安装见 [backend/README.md](backend/README.md)；网页怎样连接它、哪些只在本地运行，见 [docs/local-tools.md](docs/local-tools.md)。

## 测试

```bash
npm test                           # 领域逻辑、两种存储上的契约、扩展的规则和适配器
npm run test:ui                    # 在 Chromium 里测试主应用，模拟服务和模型
npm run e2e -w extension           # 在保存的页面上端到端运行扩展，记录到一个模拟的 Outbox
```

CI 会做类型检查、lint、格式检查，运行单元测试、构建，再在 Chromium 里测试主应用，并端到端运行扩展。比较各个 Claude 模型回答开放式问题的文本评测会产生费用，只在需要时运行（`npm run eval -w extension`）。

## 部署

见 [docs/deploy.md](docs/deploy.md)，里面也讲了怎么安装扩展。产品和架构上的决定见 [docs/design.md](docs/design.md)。
