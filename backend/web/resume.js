const $ = (id) => document.getElementById(id);
const defaultBaseUrl = 'https://api.openai.com/v1';
let enabled = false,
  busy = false,
  ready = false,
  result = null;
let settingsState = null,
  settingsBusy = false,
  settingsDirty = false;
let modelCatalog = null;
function currentBaseUrl() {
  const url = new URL($('base-url').value.trim() || defaultBaseUrl);
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = path || '/v1';
  return url.href.replace(/\/+$/, '');
}
function hasSavedKey() {
  const provider = $('ai-provider').value;
  if (!settingsState?.configuredProviders?.[provider]) return false;
  if (provider !== 'openai') return true;
  try {
    return currentBaseUrl() === (settingsState.openaiBaseUrl || defaultBaseUrl);
  } catch {
    return false;
  }
}
let choices = [
  { provider: 'openai', model: 'gpt-5.4-mini', label: 'GPT-5.4 mini' },
  { provider: 'anthropic', model: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { provider: 'anthropic', model: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
];
function availableChoices() {
  return $('ai-provider').value === 'openai' && modelCatalog
    ? modelCatalog
    : choices.filter((item) => item.provider === $('ai-provider').value);
}
function selectedPolicy() {
  const model = $('ai-model').value;
  const item = availableChoices().find((entry) => entry.model === model);
  if (item)
    return {
      canParse: item.canParse !== false,
      selectable: item.selectable !== false,
      reason: item.reason || '实际可用性以账号权限为准。',
    };
  return { canParse: false, selectable: false, reason: '当前型号未出现在列表中，请选择账号返回的模型。' };
}
function buttons() {
  $('extract-button').disabled = busy;
  $('resume-file').disabled = busy;
  $('resume-text').disabled = busy || !ready;
  $('parse-button').disabled =
    busy ||
    settingsBusy ||
    settingsDirty ||
    !enabled ||
    !selectedPolicy().canParse ||
    !$('resume-text').value.trim();
  $('clear-button').disabled = busy || !ready;
  $('parse-method').disabled = busy;
  for (const id of ['ai-provider', 'ai-model', 'base-url', 'api-key', 'enable-ai', 'save-settings'])
    $(id).disabled = busy || settingsBusy;
  const saved = hasSavedKey();
  const current = settingsState?.provider === $('ai-provider').value && !settingsDirty;
  $('check-connection').disabled = busy || settingsBusy || !saved || !current;
  $('remove-key').disabled =
    busy || settingsBusy || !settingsState?.configuredProviders?.[$('ai-provider').value];
  $('base-url-settings').hidden = $('ai-provider').value !== 'openai';
  $('base-url').disabled ||= $('ai-provider').value !== 'openai';
  $('load-models').hidden = $('ai-provider').value !== 'openai';
  $('load-models').disabled = busy || settingsBusy || !($('api-key').value.trim() || saved);
  $('model-search').disabled = busy || settingsBusy;
  $('save-settings').disabled ||= !selectedPolicy().selectable;
}
function resetResult() {
  result = null;
  $('parsed-facts').replaceChildren();
  $('parsed-facts').hidden = true;
  $('parsed-empty').hidden = false;
  $('download-button').hidden = true;
  $('parse-status').textContent = '';
}
function modelOptions(preferred) {
  const current = preferred || $('ai-model').value;
  $('ai-model').replaceChildren();
  const all = availableChoices();
  const search = $('model-search').value.trim().toLowerCase();
  // Before a provider fetch, show the saved/default model as a preset, not as an account availability list.
  let shown = all.filter(
    (item) =>
      (!search || item.model.toLowerCase().includes(search)) &&
      ($('ai-provider').value !== 'openai' ||
        modelCatalog ||
        item.model === current ||
        item.model === 'gpt-5.4-mini'),
  );
  const selected = all.find((item) => item.model === current);
  if (current && !shown.some((item) => item.model === current))
    shown = [
      {
        ...(selected || { model: current, label: current, selectable: false, canParse: false }),
        label: `${selected?.label || current}（当前选择）`,
      },
      ...shown,
    ];
  for (const choice of shown) {
    const option = document.createElement('option');
    option.value = choice.model;
    option.textContent =
      choice.label +
      (choice.selectable === false ? ' · 不适用' : choice.canParse === false ? ' · 待核实' : '');
    option.disabled = choice.selectable === false;
    $('ai-model').append(option);
  }
  if ([...$('ai-model').options].some((item) => item.value === current)) $('ai-model').value = current;
  $('model-search').hidden = !modelCatalog || $('ai-provider').value !== 'openai';
  $('model-help').textContent = selectedPolicy().reason;
}
function applySettings(status, initial = false) {
  settingsState = status;
  $('base-url').value = status.openaiBaseUrl || defaultBaseUrl;
  enabled = status.enabled;
  if (status.models) choices = status.models.map((item) => ({ ...item, canParse: true, selectable: true }));
  if (
    status.model &&
    !choices.some((item) => item.provider === status.provider && item.model === status.model)
  )
    choices.push({
      provider: status.provider,
      model: status.model,
      label: status.model,
      ...(status.modelPolicy || { canParse: false, selectable: true, reason: '兼容性与价格尚待核实。' }),
    });
  if (initial && !status.hasKey) {
    $('ai-provider').value = 'openai';
    modelOptions('gpt-5.4-mini');
    $('model-settings').open = true;
  } else {
    $('ai-provider').value = status.provider || 'openai';
    modelOptions(status.model);
    $('enable-ai').checked = status.enabled;
  }
  $('api-key').value = '';
  settingsDirty = false;
  keyHelp();
  $('model-status').textContent = enabled
    ? status.modelPolicy?.canParse === false
      ? `解析已暂停 · ${status.model} · 兼容性与价格待核实`
      : `解析服务已启用 · ${status.model}`
    : 'AI 解析尚未启用；目前可以免费读取和核对文件文字。';
  buttons();
}
function keyHelp() {
  const saved = hasSavedKey();
  $('key-state').textContent = saved ? '密钥已配置' : '未配置';
  $('api-key').placeholder = saved ? '已保存；留空保留现有密钥' : '填写此服务地址对应的 API Key';
  $('api-key').required = !saved && $('enable-ai').checked;
}
for (const id of ['ai-provider', 'ai-model', 'base-url', 'api-key', 'enable-ai'])
  $(id).addEventListener('input', () => {
    settingsDirty = true;
    $('settings-status').textContent = '配置有改动，请保存后再解析。';
    if (id === 'ai-provider') {
      $('api-key').value = '';
      modelCatalog = null;
      $('model-search').value = '';
      $('model-list-status').textContent = '填写密钥后可获取账号模型，无需先保存；不会发送简历。';
      modelOptions($('ai-provider').value === 'openai' ? 'gpt-5.4-mini' : 'claude-sonnet-5-5');
    } else if (id === 'api-key' || id === 'base-url') {
      modelCatalog = null;
      $('model-search').value = '';
      $('model-list-status').textContent =
        id === 'base-url'
          ? '地址已修改，请填写对应的密钥，并重新获取模型列表。'
          : '密钥已修改，请重新获取该账号的模型列表。';
      modelOptions($('ai-model').value);
    }
    $('model-help').textContent = selectedPolicy().reason;
    keyHelp();
    buttons();
  });
$('model-search').addEventListener('input', () => {
  modelOptions($('ai-model').value);
  buttons();
});
$('load-models').addEventListener('click', async () => {
  if (busy || settingsBusy) return;
  const preferred = $('ai-model').value;
  settingsBusy = true;
  buttons();
  $('model-list-status').textContent = '正在获取当前密钥可访问的模型…';
  try {
    const key = $('api-key').value.trim();
    const data = await request('/api/resumes/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'openai',
        baseUrl: currentBaseUrl(),
        ...(key ? { apiKey: key } : {}),
      }),
    });
    modelCatalog = data.models;
    if (data.baseUrl) $('base-url').value = data.baseUrl;
    $('model-search').value = '';
    modelOptions(preferred);
    $('model-list-status').textContent = data.models.length
      ? `已从账号获取 ${data.models.length} 个模型。选择后保存配置；灰色型号不适用于简历解析。`
      : '账号未返回模型。请检查模型读取权限，或更换密钥后重试。';
  } catch (error) {
    $('model-list-status').textContent = error.message;
  } finally {
    settingsBusy = false;
    buttons();
  }
});
$('model-settings-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy || settingsBusy) return;
  settingsBusy = true;
  buttons();
  $('settings-status').textContent = '正在保存到本机…';
  const key = $('api-key').value.trim();
  try {
    const status = await request('/api/resumes/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: $('ai-provider').value,
        model: $('ai-model').value,
        enabled: $('enable-ai').checked,
        ...($('ai-provider').value === 'openai' ? { baseUrl: currentBaseUrl() } : {}),
        ...(key ? { apiKey: key } : {}),
      }),
    });
    applySettings(status);
    resetResult();
    $('settings-status').textContent =
      status.modelPolicy?.canParse === false
        ? '配置已保存；该模型的兼容性与价格尚待核实，暂不发送简历。'
        : '配置已保存并立即生效。密钥不会回显。';
  } catch (error) {
    $('settings-status').textContent = error.message;
  } finally {
    $('api-key').value = '';
    settingsBusy = false;
    buttons();
  }
});
$('check-connection').addEventListener('click', async () => {
  if (settingsBusy || busy || settingsDirty) return;
  settingsBusy = true;
  buttons();
  $('settings-status').textContent = '正在检查密钥与模型访问权限…';
  try {
    const data = await request('/api/resumes/check-connection', { method: 'POST' });
    $('settings-status').textContent = data.message;
  } catch (error) {
    $('settings-status').textContent = error.message;
  } finally {
    settingsBusy = false;
    buttons();
  }
});
$('remove-key').addEventListener('click', async () => {
  if (settingsBusy || busy) return;
  settingsBusy = true;
  buttons();
  try {
    const status = await request('/api/resumes/settings', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: $('ai-provider').value }),
    });
    modelCatalog = null;
    $('model-search').value = '';
    $('model-list-status').textContent = '填写密钥后可获取账号模型，无需先保存；不会发送简历。';
    applySettings(status);
    resetResult();
    $('settings-status').textContent = '密钥已从本地配置中移除。';
  } catch (error) {
    $('settings-status').textContent = error.message;
  } finally {
    settingsBusy = false;
    buttons();
  }
});
async function request(path, options) {
  const response = await fetch(path, { ...options, headers: { 'X-Outbox-Local': '1', ...options?.headers } });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      Array.isArray(data.message) ? data.message.join('；') : data.message || '请求失败，请重试。',
    );
  return data;
}
$('resume-file').addEventListener('change', () => {
  ready = false;
  $('resume-text').value = '';
  $('read-warnings').replaceChildren();
  $('read-warnings').hidden = true;
  $('read-status').textContent = '文件已选择，点击“读取文字”。';
  resetResult();
  buttons();
});
$('extract-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const file = $('resume-file').files[0];
  if (!file || busy) return;
  resetResult();
  ready = false;
  $('resume-text').value = '';
  $('read-warnings').replaceChildren();
  $('read-warnings').hidden = true;
  if (file.size > 5 * 1024 * 1024 || !file.size) {
    $('read-status').textContent = '文件应大于 0，且不超过 5 MB。';
    buttons();
    return;
  }
  const form = new FormData();
  form.append('file', file);
  busy = true;
  buttons();
  $('read-status').textContent = '正在本地读取文字…';
  try {
    const data = await request('/api/resumes/extract', { method: 'POST', body: form });
    $('resume-text').value = data.text;
    ready = true;
    $('read-status').textContent =
      `已读取 ${data.format.toUpperCase()}${data.pages ? ` · ${data.pages} 页` : ''} · ${data.text.length.toLocaleString()} 字符`;
    for (const warning of data.warnings) {
      const item = document.createElement('li');
      item.textContent = warning;
      $('read-warnings').append(item);
    }
    $('read-warnings').hidden = !data.warnings.length;
  } catch (error) {
    $('read-status').textContent = error.message;
  } finally {
    busy = false;
    buttons();
  }
});
$('resume-text').addEventListener('input', () => {
  resetResult();
  buttons();
});
$('parse-method').addEventListener('change', resetResult);
$('clear-button').addEventListener('click', () => {
  ready = false;
  $('resume-file').value = '';
  $('resume-text').value = '';
  $('read-warnings').replaceChildren();
  $('read-warnings').hidden = true;
  $('read-status').textContent = '本次内容已清空。';
  resetResult();
  buttons();
});
function section(title, paragraphs) {
  const element = document.createElement('section');
  element.className = 'fact-section';
  const heading = document.createElement('h3');
  heading.textContent = title;
  element.append(heading);
  const values = paragraphs.filter(Boolean);
  for (const value of values.length ? values : ['未提供']) {
    const p = document.createElement('p');
    p.textContent = value;
    if (!values.length) p.className = 'muted';
    element.append(p);
  }
  $('parsed-facts').append(element);
}
function showFacts(data) {
  const facts = data.facts;
  $('parsed-facts').replaceChildren();
  section('个人信息', [
    [facts.name.first, facts.name.last].filter(Boolean).join(' '),
    facts.name.preferred,
    facts.phone,
    Object.values(facts.location).filter(Boolean).join(', '),
  ]);
  section('个人链接', Object.values(facts.links));
  section(
    '教育',
    facts.education.map((item) =>
      [
        item.school,
        [item.degree, item.field].filter(Boolean).join(' · '),
        [item.start, item.end].filter(Boolean).join(' — '),
        item.gpa && `GPA ${item.gpa}`,
        item.location,
      ]
        .filter(Boolean)
        .join('\n'),
    ),
  );
  section(
    '经历',
    facts.experience.map((item) =>
      [
        item.title,
        item.company,
        item.location,
        [item.start, item.end].filter(Boolean).join(' — '),
        item.description,
      ]
        .filter(Boolean)
        .join('\n'),
    ),
  );
  section('技能', [facts.skills.join('、')]);
  section('语言', [facts.languages.join('、')]);
  section('个人简介', [facts.summary]);
  $('parsed-facts').hidden = false;
  $('parsed-empty').hidden = true;
  $('download-button').hidden = false;
}
$('parse-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (
    !enabled ||
    busy ||
    settingsBusy ||
    settingsDirty ||
    !selectedPolicy().canParse ||
    !$('resume-text').value.trim()
  )
    return;
  resetResult();
  busy = true;
  buttons();
  $('parse-status').textContent = '正在提取资料，请稍候…';
  try {
    const data = await request('/api/resumes/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: $('resume-text').value, method: $('parse-method').value }),
    });
    result = data;
    showFacts(data);
    $('parse-status').textContent =
      `字段校验通过 · ${(data.durationMs / 1000).toFixed(1)} 秒${data.usage ? ` · 输入 ${data.usage.input_tokens} / 输出 ${data.usage.output_tokens} tokens` : ''}。请对照原文确认内容。`;
  } catch (error) {
    $('parse-status').textContent = error.message;
  } finally {
    busy = false;
    buttons();
  }
});
$('download-button').addEventListener('click', () => {
  if (!result) return;
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(result.facts, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = 'resume-facts.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
request('/api/resumes/status')
  .then((status) => {
    applySettings(status, true);
  })
  .catch(() => {
    $('model-status').textContent = '无法连接解析服务，请刷新后重试。';
  });
