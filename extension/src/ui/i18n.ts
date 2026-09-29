import type { Language } from '../storage';

const en = {
  outbox: 'Outbox',
  close: 'Close',
  more: 'More',
  options: 'Settings',
  'match.red': 'Likely screened out',
  'match.yellow': 'Worth a look',
  'match.green': 'Looks fine',
  'signal.citizenship': 'Requires US citizenship',
  'signal.clearance': 'Requires a security clearance',
  'signal.usPerson': 'Requires a “U.S. person”',
  'signal.noSponsorship': 'Says it won’t sponsor visas',
  'signal.sponsors': 'Mentions visa sponsorship',
  'signal.seniorTitle': 'Senior title',
  'signal.years': 'Asks for {n} years',
  'signal.newGrad': 'Early-career friendly',
  'signal.sameCompany': '{n} postings here in the last 30 days',
  'signal.h1b': '{n} H-1B approvals, FY{from}–{to}',
  'signal.noH1b': 'No H-1B approvals on record',
  account: 'Account',
  applied: 'applied',
  resume: 'Resume',
  noResume: 'No resume PDF on Outbox',
  fill: 'Fill',
  refill: 'Fill again',
  reading: 'Reading the page…',
  filling: 'Filling…',
  drafting: 'AI is writing…',
  summary: 'Filled {filled} · {n} need you',
  summaryDone: 'Filled {filled} · all set',
  'tag.confirm': 'Check',
  'tag.draft': 'AI',
  'tag.missing': 'Fill',
  duplicate: 'This system merges candidates by name, so a second account may count as a duplicate.',
  logged: 'Logged to Outbox',
  undo: 'Undo',
  undone: 'Removed from Outbox',
  relog: 'Log again',
  log: 'Log to Outbox',
  snapshot: 'This page didn’t fill right',
  snapshotSaved: 'Saved the form’s structure, without values.',
  shortcut: 'Shortcut: ⌥⇧F',
  'notice.profile': 'No profile yet',
  'notice.signedOut': 'Not signed in to Outbox: logs won’t save',
  'notice.unreachable': 'Outbox unreachable: logs wait and retry',
  'notice.noKey': 'No API key: free-text answers are yours',
  'action.fillIn': 'Fill in',
  'action.signIn': 'Sign in',
  'action.settings': 'Settings',
  'error.queued': 'Outbox can’t be reached; the log is saved and will be retried.',
  'error.alreadyLogged': 'This account already applied to this posting.',
  'error.noCompany': 'Couldn’t tell which company this is, so it wasn’t logged.',
  'error.ai': 'AI failed: {detail}',
};

type Key = keyof typeof en;

const zh: Record<Key, string> = {
  outbox: 'Outbox',
  close: '关闭',
  more: '更多',
  options: '设置',
  'match.red': '大概率会被筛掉',
  'match.yellow': '值得看一眼',
  'match.green': '看起来可以投',
  'signal.citizenship': '要求美国公民',
  'signal.clearance': '要求安全许可（clearance）',
  'signal.usPerson': '要求 “U.S. person”',
  'signal.noSponsorship': '写明不提供签证担保',
  'signal.sponsors': '提到可以担保签证',
  'signal.seniorTitle': '资深职位',
  'signal.years': '要求 {n} 年经验',
  'signal.newGrad': '适合应届/早期职业',
  'signal.sameCompany': '30 天内在这家投了 {n} 个岗位',
  'signal.h1b': 'H-1B 批准 {n} 次（FY{from}–{to}）',
  'signal.noH1b': '没有 H-1B 批准记录',
  account: '账号',
  applied: '已投',
  resume: '简历',
  noResume: 'Outbox 上还没有简历 PDF',
  fill: '填写',
  refill: '重新填写',
  reading: '正在读取页面…',
  filling: '正在填写…',
  drafting: 'AI 正在起草…',
  summary: '已填 {filled} 项 · {n} 项要你看',
  summaryDone: '已填 {filled} 项，都好了',
  'tag.confirm': '确认',
  'tag.draft': 'AI',
  'tag.missing': '待填',
  duplicate: '这个系统会合并同名候选人，换账号投可能被判重复。',
  logged: '已记录到 Outbox',
  undo: '撤销',
  undone: '已从 Outbox 删除',
  relog: '重新记录',
  log: '记录到 Outbox',
  snapshot: '这页没填好',
  snapshotSaved: '已保存表单结构（不含填写内容）',
  shortcut: '快捷键 ⌥⇧F',
  'notice.profile': '还没有档案',
  'notice.signedOut': '还没登录 Outbox，投了记不上',
  'notice.unreachable': '连不上 Outbox，记录会先存下',
  'notice.noKey': '没有 API key，问答题要你自己写',
  'action.fillIn': '去填写',
  'action.signIn': '去登录',
  'action.settings': '去设置',
  'error.queued': '连不上 Outbox，已先存下，稍后自动重试。',
  'error.alreadyLogged': '这个账号已经投过这个岗位。',
  'error.noCompany': '认不出这是哪家公司，没能记录。',
  'error.ai': 'AI 出错：{detail}',
};

export type Translate = (key: Key, values?: Record<string, string | number>) => string;

export function resolveLanguage(setting: Language): 'en' | 'zh' {
  if (setting !== 'auto') return setting;
  return typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function translator(language: 'en' | 'zh'): Translate {
  const table = language === 'zh' ? zh : en;
  return (key, values) => {
    let text: string = table[key] ?? en[key] ?? key;
    for (const [name, value] of Object.entries(values ?? {}))
      text = text.replaceAll(`{${name}}`, String(value));
    return text;
  };
}

export type { Key as MessageKey };
