const $ = (id) => document.getElementById(id);
const state = { boards: [], page: 1, hasMore: false, running: false };
const compact = matchMedia('(max-width: 760px)');
function companyPanel() {
  $('company-panel').open = !compact.matches;
  $('company-panel').querySelector('summary').tabIndex = 0;
}
companyPanel();
compact.addEventListener('change', companyPanel);
let requestVersion = 0;
let searchTimer;
let noticeTimer;
let pollTimer;
const date = (value) =>
  new Date(value).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
function notice(message) {
  $('notice').textContent = message;
  $('notice').hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    $('notice').hidden = true;
  }, 6000);
}
async function api(path, options = {}) {
  const response = await fetch(`/api/${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', 'x-outbox-local': '1' },
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(typeof data.message === 'string' ? data.message : '请求失败，请稍后重试。');
  return data;
}
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function selected() {
  return state.boards.filter((board) => board.enabled);
}
function renderBoards() {
  const search = $('company-search').value.trim().toLowerCase();
  const rows = state.boards.filter(
    (board) => board.company.toLowerCase().includes(search) && (!$('selected-only').checked || board.enabled),
  );
  const list = $('company-list');
  const scroll = list.scrollTop;
  list.replaceChildren();
  for (const board of rows) {
    const label = element('label', 'company-row');
    const checkbox = element('input');
    checkbox.type = 'checkbox';
    checkbox.checked = board.enabled;
    checkbox.setAttribute('aria-label', `关注 ${board.company}（${board.provider}）`);
    const info = element('div');
    info.append(element('div', 'company-name', board.company));
    const status = board.syncedAt ? `${board.activeJobs} 个岗位 · ${date(board.syncedAt)}` : '等待首次更新';
    info.append(element('div', 'company-meta', `${board.provider} · ${status}`));
    if (board.enabled && board.lastError)
      info.append(element('div', 'company-meta company-error', '上次更新失败，已保留原岗位'));
    label.append(checkbox, info);
    list.append(label);
    checkbox.addEventListener('change', async () => {
      checkbox.disabled = true;
      try {
        const updated = await api(`boards/${board.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ enabled: checkbox.checked }),
        });
        Object.assign(board, updated);
        renderBoards();
        updateCompanyFilter();
        state.page = 1;
        await loadJobs();
      } catch (error) {
        checkbox.checked = board.enabled;
        checkbox.disabled = false;
        notice(error.message);
      }
    });
  }
  if (!rows.length) list.append(element('p', 'muted small', '没有找到匹配的公司。可以在下方添加招聘页。'));
  list.scrollTop = scroll;
  $('selected-count').textContent = `${selected().length} 家`;
  $('sync-button').disabled = state.running || !selected().length;
}
function updateCompanyFilter() {
  const filter = $('company-filter'),
    value = filter.value;
  filter.replaceChildren(new Option('全部已关注公司', ''));
  for (const board of selected()) filter.add(new Option(board.company, board.id));
  filter.value = selected().some((board) => board.id === value) ? value : '';
}
async function loadBoards() {
  state.boards = await api('boards');
  renderBoards();
  updateCompanyFilter();
}
function empty(title, message) {
  const node = element('div', 'empty');
  node.append(element('div', 'empty-icon', '↗'), element('h3', '', title), element('p', '', message));
  $('jobs').replaceChildren(node);
}
async function loadJobs() {
  const version = ++requestVersion;
  if (!selected().length) {
    empty('先选几家你想去的公司', '勾选想关注的公司，再点击“更新岗位”。你的选择会保存在本机。');
    $('result-note').textContent = '';
    state.hasMore = false;
    updatePagination();
    return;
  }
  $('result-note').textContent = '正在查找…';
  const params = new URLSearchParams({ page: String(state.page), limit: '25', active: $('job-state').value });
  if ($('job-search').value.trim()) params.set('q', $('job-search').value.trim());
  if ($('location-search').value.trim()) params.set('location', $('location-search').value.trim());
  if ($('company-filter').value) params.set('boardId', $('company-filter').value);
  if ($('remote-only').checked) params.set('remote', 'true');
  try {
    const data = await api(`jobs?${params}`);
    if (version !== requestVersion) return;
    state.hasMore = data.hasMore;
    $('result-note').textContent = `本页 ${data.items.length} 个岗位`;
    $('jobs').replaceChildren();
    for (const job of data.items) {
      const card = element('article', 'job-card'),
        info = element('div', 'job-info');
      card.append(element('div', 'company-initial', job.company.charAt(0).toUpperCase()));
      info.append(element('p', 'job-company', job.company));
      const title = element('button', 'job-title', job.title);
      title.type = 'button';
      title.addEventListener('click', () => openJob(job.id));
      info.append(title);
      const meta = element('div', 'job-meta');
      meta.append(element('span', '', job.location || '地点未注明'));
      if (job.department) meta.append(element('span', '', job.department));
      if (job.remote) meta.append(element('span', 'remote-tag', '远程'));
      if (!job.active) meta.append(element('span', '', '已下架'));
      info.append(meta);
      card.append(info);
      const link = element('a', 'job-link', '招聘页 ↗');
      link.href = job.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      card.append(link);
      $('jobs').append(card);
    }
    if (!data.items.length) empty('暂时没有匹配的岗位', '尝试调整筛选条件，或更新你关注公司的招聘信息。');
    updatePagination();
  } catch (error) {
    if (version !== requestVersion) return;
    $('result-note').textContent = '读取失败';
    notice(error.message);
  }
}
function updatePagination() {
  $('previous').disabled = state.page <= 1;
  $('next').disabled = !state.hasMore;
  $('page-number').textContent = `第 ${state.page} 页`;
}
async function openJob(id) {
  try {
    const job = await api(`jobs/${id}`);
    $('detail-company').textContent = job.company;
    $('detail-title').textContent = job.title;
    $('detail-location').textContent = `${job.location || '地点未注明'}${job.remote ? ' · 远程' : ''}`;
    $('detail-state').textContent = `${job.active ? '正在招聘' : '已下架'} · 最近读取于 ${date(job.seenAt)}`;
    $('detail-description').textContent = job.description || '公司未提供岗位说明，请查看原招聘页面。';
    $('detail-link').href = job.url;
    $('job-detail').showModal();
  } catch (error) {
    notice(error.message);
  }
}
function displaySync(progress) {
  state.running = progress.running;
  renderBoards();
  if (progress.running)
    $('sync-status').textContent = `正在更新 ${progress.completed} / ${progress.total || '…'} 家公司…`;
  else if (progress.error) $('sync-status').textContent = '更新遇到问题，已保留原岗位。可以稍后重试。';
  else if (progress.finishedAt) {
    const failures = progress.results.filter((r) => r.error).length;
    $('sync-status').textContent =
      `最近更新 ${date(progress.finishedAt)}${failures ? ` · ${failures} 家更新失败，原岗位已保留` : ' · 已完成'}`;
  }
}
async function poll() {
  clearTimeout(pollTimer);
  try {
    const progress = await api('sync');
    displaySync(progress);
    if (progress.running) pollTimer = setTimeout(poll, 1200);
    else {
      await loadBoards();
      await loadJobs();
    }
  } catch (error) {
    state.running = false;
    renderBoards();
    $('sync-status').textContent = '连接中断，稍后可刷新页面查看更新状态。';
    notice(error.message);
  }
}
$('company-search').addEventListener('input', renderBoards);
$('selected-only').addEventListener('change', renderBoards);
$('filters').addEventListener('submit', (event) => event.preventDefault());
for (const id of ['job-search', 'location-search'])
  $(id).addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.page = 1;
      void loadJobs();
    }, 250);
  });
for (const id of ['company-filter', 'job-state', 'remote-only'])
  $(id).addEventListener('change', () => {
    state.page = 1;
    void loadJobs();
  });
$('previous').addEventListener('click', () => {
  state.page--;
  void loadJobs();
});
$('next').addEventListener('click', () => {
  state.page++;
  void loadJobs();
});
$('close-detail').addEventListener('click', () => $('job-detail').close());
$('sync-button').addEventListener('click', async () => {
  $('sync-button').disabled = true;
  try {
    displaySync(await api('sync', { method: 'POST' }));
    await poll();
  } catch (error) {
    state.running = false;
    renderBoards();
    notice(error.message);
  }
});
$('add-company-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('add-company-button').disabled = true;
  try {
    await api('boards', {
      method: 'POST',
      body: JSON.stringify({ company: $('new-company').value.trim(), url: $('new-url').value.trim() }),
    });
    $('company-search').value = $('new-company').value.trim();
    $('selected-only').checked = false;
    $('add-company-form').reset();
    await loadBoards();
    notice('公司已添加。勾选关注后即可更新岗位。');
  } catch (error) {
    notice(error.message);
  } finally {
    $('add-company-button').disabled = false;
  }
});
(async () => {
  try {
    await loadBoards();
    await poll();
  } catch (error) {
    empty('暂时无法读取公司目录', '请确认本地服务和数据库已启动，再刷新页面。');
    notice(error.message);
  }
})();
