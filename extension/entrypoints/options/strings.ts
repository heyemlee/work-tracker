const en = {
  title: 'Settings',
  close: 'Close',
  'tab.connection': 'Connection',
  'tab.ai': 'AI',
  'tab.reports': 'Fill reports',
  'tab.memory': 'Remembered answers',
  'tab.general': 'General',
  notHere: 'Open the settings from the Outbox Autofill card.',
  saved: 'Saved',
  enterSaves: 'Press Enter to save',
  notSaved: 'Couldn’t save',

  checking: 'Checking…',
  connected: 'Connected · {n} accounts',
  connectedOne: 'Connected · 1 account',
  signedOut: 'Not signed in',
  signIn: 'Sign in',
  unreachable: 'Can’t reach it: {detail}',
  retry: 'Retry',
  profile: 'Profile',
  noProfile: 'Not filled in yet',
  missing: '{n} blanks',
  copyFrom: 'copy from {when}',
  resumes: 'Resumes',
  noResumes: 'No PDFs yet',
  manage: 'Manage',
  queue: 'To send',
  queued: '{n} logs, sent once Outbox is reachable',
  outboxUrl: 'Outbox address',

  aiEnabled: 'Use AI',
  aiOff: 'Off: free-text answers are left for you, and resumes can’t be read.',
  provider: 'Provider',
  providerOpenai: 'OpenAI-compatible',
  providerAnthropic: 'Anthropic (Claude)',
  baseUrl: 'Address',
  key: 'API key',
  save: 'Save',
  check: 'Check',
  keyOk: 'The key works.',
  keyOkNoEffort:
    'The key works, but this endpoint doesn’t take a reasoning effort: the setting has no effect.',
  keyBad: 'The saved key didn’t pass the check: {detail}',
  keyUnchecked: 'Couldn’t check the key: {detail}. Check the address and the network, then save again.',
  keyOkEmpty: 'The key works, but the check got no answer back ({detail}).',
  keyOkNoModel: 'The key works, but this endpoint has no model by the name chosen: pick another one above.',
  keyRefused:
    'The saved key didn’t pass the check: the provider doesn’t recognize it (401). Make sure it’s this provider’s API key, and that it hasn’t been deleted or disabled.',
  model: 'Model',
  reading: 'Reading…',
  checkToList: 'Press Check to list models',
  modelGone: '{model} isn’t among the models this key can use: pick another.',
  modelsUnread: 'Couldn’t read the models this key can use: {detail}. Type the model’s name instead.',
  effort: 'Reasoning effort',
  'effort.auto': 'Auto',
  'effort.low': 'Low',
  'effort.medium': 'Medium',
  'effort.high': 'High',
  effortHelp:
    'Auto uses low effort to answer a form’s leftover fields and medium to draft free-text answers. More effort is slower and uses more tokens. “Check” tells whether the endpoint takes the setting.',
  usageTokens: 'This month: {tokens} tokens',
  usageCost: 'This month: ${cost}',

  reportsHelp:
    'Pages you marked “This page didn’t fill right” from the card’s ⋯ menu. Only the form’s structure is kept, never what was filled in. A report leaves this list once the extension is updated with its fix.',
  reportsNone: 'No reports.',
  fields: '{n} fields',
  unfilled: '{n} not filled',
  export: 'Export',
  delete: 'Delete',

  memoryHelp:
    'When you submit an application, the answers left in questions the rules had nothing for (typed by you, or picked by AI and not changed) are kept in this browser and filled in again when the same question comes up. Work authorization, the voluntary survey and free-text answers are never kept. Delete an answer you no longer want used.',
  memoryNone: 'Nothing remembered yet.',

  language: 'Language',
  auto: 'Follow Outbox',
  limit: 'Same-company warning',
  limitHelp: 'Warns at this many postings at one company within 30 days.',
  data: 'Data',
  exportAll: 'Export extension data (JSON)',
  exportHelp: 'The export leaves out the API key.',
  deleteAll: 'Delete extension data',
  confirmDelete:
    'Delete the profile copy, resume copies, remembered answers, reports and the API key from this browser?',
  cancel: 'Cancel',
};

type Key = keyof typeof en;

const zh: Record<Key, string> = {
  title: '设置',
  close: '关闭',
  'tab.connection': '连接',
  'tab.ai': 'AI',
  'tab.reports': '反馈记录',
  'tab.memory': '记住的回答',
  'tab.general': '通用',
  notHere: '请从 Outbox Autofill 的卡片里打开设置。',
  saved: '已保存',
  enterSaves: '按回车保存',
  notSaved: '没保存上',

  checking: '正在检查…',
  connected: '已连接 · {n} 个账号',
  connectedOne: '已连接 · 1 个账号',
  signedOut: '未登录',
  signIn: '去登录',
  unreachable: '连不上：{detail}',
  retry: '重试',
  profile: '资料',
  noProfile: '还没有资料',
  missing: '缺 {n} 项',
  copyFrom: '本机副本，{when} 同步',
  resumes: '简历',
  noResumes: '还没有 PDF',
  manage: '管理',
  queue: '待发送',
  queued: '{n} 条记录，连上 Outbox 后自动发送',
  outboxUrl: 'Outbox 地址',

  aiEnabled: '使用 AI',
  aiOff: '已关闭：问答题要你自己写，也不能读简历。',
  provider: '服务商',
  providerOpenai: 'OpenAI 兼容',
  providerAnthropic: 'Anthropic（Claude）',
  baseUrl: '地址',
  key: 'API key',
  save: '保存',
  check: '检查',
  keyOk: 'Key 可以用。',
  keyOkNoEffort: 'Key 可以用，但这个接口不接受推理强度，这项设置不会生效。',
  keyBad: '保存的 key 没通过检查：{detail}',
  keyUnchecked: '没能检查这个 key：{detail}。请检查地址和网络，再保存一次。',
  keyOkEmpty: 'Key 可以用，但检查请求没拿到回答（{detail}）。',
  keyOkNoModel: 'Key 可以用，但这个接口没有选中的这个模型，请在上面的「模型」里换一个。',
  keyRefused:
    '保存的 key 没通过检查：服务商不认这个 key（401）。请确认它是这家服务商的 API key，并且没有被删除或停用。',
  model: '模型',
  reading: '正在读取…',
  checkToList: '点「检查」读取可用模型',
  modelGone: '这个 key 能用的模型里没有 {model}，请换一个。',
  modelsUnread: '没能读到这个 key 能用的模型：{detail}。可以直接输入模型名。',
  effort: '推理强度',
  'effort.auto': '自动',
  'effort.low': '低',
  'effort.medium': '中',
  'effort.high': '高',
  effortHelp:
    '自动：填表单里剩下的题用低，起草问答题用中。强度越高越慢、越费 token。点「检查」可以确认接口是否接受这项设置。',
  usageTokens: '本月用量：{tokens} tokens',
  usageCost: '本月用量：${cost}',

  reportsHelp:
    '你在卡片 ⋯ 菜单里点「这页没填好」时留下的记录。只保存表单结构，不含填写内容。修好的会在扩展更新后自动从这里消失。',
  reportsNone: '没有记录。',
  fields: '{n} 个字段',
  unfilled: '{n} 个没填上',
  export: '导出',
  delete: '删除',

  memoryHelp:
    '提交申请时，规则填不了的题目里最后留下的答案（你自己填的，或 AI 选了而你没改的）会记在这个浏览器里，下次遇到同样的问题自动填。工作许可、平等就业调查和问答题不记。不想再用的可以删掉。',
  memoryNone: '还没有记住的回答。',

  language: '语言',
  auto: '跟随 Outbox',
  limit: '同公司提醒',
  limitHelp: '30 天内在同一家投到这么多个岗位时提醒。',
  data: '数据',
  exportAll: '导出扩展数据（JSON）',
  exportHelp: '导出的内容不含 API key。',
  deleteAll: '清空扩展数据',
  confirmDelete: '要从这个浏览器删除资料副本、简历副本、记住的回答、记录和 API key 吗？',
  cancel: '取消',
};

export type Strings = (key: Key, values?: Record<string, string | number>) => string;

export function strings(language: 'en' | 'zh'): Strings {
  const table = language === 'zh' ? zh : en;
  return (key, values) => {
    let text: string = table[key];
    for (const [name, value] of Object.entries(values ?? {}))
      text = text.replaceAll(`{${name}}`, String(value));
    return text;
  };
}
