import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { Db } from '../src/db.js';
import { boardSchema } from '../src/validation.js';

const db = new Db();
try {
  const boards = z.array(boardSchema).parse(JSON.parse(await readFile('config/boards.json', 'utf8')));
  for (const board of boards)
    await db.board.upsert({
      where: { provider_slug: { provider: board.provider, slug: board.slug } },
      create: board,
      update: { company: board.company },
    });
  console.log('公司目录已准备好。打开本地页面，选择你想关注的公司。');
} finally {
  await db.$disconnect();
}
