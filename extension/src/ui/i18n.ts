import type { Language } from '../storage';

const en = {
  outbox: 'Outbox',
  close: 'Close',
  expand: 'Open Outbox Autofill',
  options: 'Options',
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
  applyAs: 'Apply as',
  applied: 'applied',
  resume: 'Resume',
  noResume: 'No resume added',
  fill: 'Fill',
  refill: 'Fill again',
  reading: 'Reading the page…',
  filling: 'Filling…',
  drafting: 'Writing drafts…',
  'group.confirm': 'Check these',
  'group.draft': 'AI drafts: edit before you submit',
  'group.missing': 'Fill these yourself',
  'group.filled': 'Filled',
  duplicate:
    'This system merges candidates by name and contact details, so a second account shows up as a duplicate.',
  logged: 'Logged to Outbox',
  undo: 'Undo',
  undone: 'Removed from Outbox',
  log: 'Log to Outbox',
  snapshot: 'This page didn’t fill right',
  snapshotSaved: 'Saved the form’s structure, no values. Thanks!',
  linkedin: 'LinkedIn: logging only. The extension doesn’t fill LinkedIn.',
  noForm: 'No application form on this page.',
  'error.profile': 'Fill in your profile on Outbox first, from the profile button in its toolbar.',
  'error.signedOut': 'Sign in to Outbox, then reopen this card.',
  'error.queued': 'Outbox can’t be reached; the log is saved and will be retried.',
  'error.alreadyLogged': 'This account already applied to this posting.',
  'error.noCompany': 'Couldn’t tell which company this is.',
  'error.ai': 'AI failed: {detail}',
  'outbox.signedOut': 'Not signed in to Outbox',
  'outbox.unreachable': 'Outbox unreachable',
  'ai.noKey': 'Add an Anthropic API key to draft answers',
  'ai.busy': 'AI is working…',
  'ai.failed': 'AI failed',
  shortcut: '⌥⇧F',
  aiNote: 'AI',
  memoryNote: 'your last answer',
};

type Key = keyof typeof en;

const zh: Record<Key, string> = {
  outbox: 'Outbox',
  close: '关闭',
  expand: '打开 Outbox Autofill',
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
  applyAs: '用这个账号投',
  applied: '已投',
  resume: '简历',
  noResume: '还没有添加简历',
  fill: '填写',
  refill: '重新填写',
  reading: '正在读取页面…',
  filling: '正在填写…',
  drafting: '正在起草回答…',
  'group.confirm': '请确认',
  'group.draft': 'AI 草稿：提交前改一改',
  'group.missing': '需要你来填',
  'group.filled': '已填好',
  duplicate: '这个招聘系统会按姓名和联系方式合并候选人，同一岗位用第二个账号投会被识别为重复。',
  logged: '已记录到 Outbox',
  undo: '撤销',
  undone: '已从 Outbox 删除',
  log: '记录到 Outbox',
  snapshot: '这页没填好',
  snapshotSaved: '已保存表单结构（不含任何填写内容），谢谢！',
  linkedin: 'LinkedIn：只记录，不填表。',
  noForm: '这页没有申请表。',
  'error.profile': '请先在 Outbox 上填写档案：点工具栏的「档案」按钮。',
  'error.signedOut': '请先登录 Outbox，再重新打开卡片。',
  'error.queued': '连不上 Outbox，已先存下，稍后自动重试。',
  'error.alreadyLogged': '这个账号已经投过这个岗位。',
  'error.noCompany': '认不出这是哪家公司。',
  'error.ai': 'AI 出错：{detail}',
  'outbox.signedOut': '未登录 Outbox',
  'outbox.unreachable': '连不上 Outbox',
  'ai.noKey': '添加 Anthropic API key 后可以起草回答',
  'ai.busy': 'AI 正在处理…',
  'ai.failed': 'AI 出错',
  shortcut: '⌥⇧F',
  aiNote: 'AI',
  memoryNote: '你上次的回答',
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
