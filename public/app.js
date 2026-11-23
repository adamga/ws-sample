/* global chronicleIcons, chronicleMarkdown */
'use strict';
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const icon = (name, className = '') => chronicleIcons.svg(name, className);
const icons = { overview: 'panels-top-left', prompt: 'message-square', response: 'sparkles', reasoning: 'brain', tool: 'terminal', edit: 'file-diff', event: 'activity', model: 'cpu', group: 'folder', context: 'paperclip', file: 'file-code-2' };
const state = {
  library: [], session: null, nodes: new Map(), parents: new Map(), expanded: new Set(), selected: null,
  filter: 'all', query: '', matches: new Set(), tab: 'readable', detail: null, cache: new Map(), visible: [], searchSequence: 0, loadSequence: 0,
  mode: 'library', view: 'library', libraryFilter: '', collapsedWorkspaces: new Set(), indexing: null, emptySessions: 0,
  results: null, highlight: null, globalSequence: 0,
  sortBy: localStorage.getItem('chronicle-sort') || 'date-desc',
  defaultPaths: { vscodeStorage: '', agentSessions: '' }
};
let toastTimer;
let searchTimer;
let recordSequence = 0;
const records = new Map();
let storyVersion = 0;
const storyObservers = new Set();
function stopStory() {
  storyVersion++;
  for (const observer of storyObservers) observer.disconnect();
  storyObservers.clear();
}
const humanize = (value) => value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').replace(/^./, (char) => char.toUpperCase());
const modelName = (value) => (value || 'Not recorded').replace(/^copilot\//, '');
const number = (value) => new Intl.NumberFormat().format(value || 0);
const textOf = (value) => typeof value === 'string' ? value : Array.isArray(value) ? value.map(textOf).join('') : value ? textOf(value.value ?? value.text ?? value.content ?? '') : '';
function date(value, options = {}) {
  if (!value) return 'Time not recorded';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Time not recorded' : parsed.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', ...options });
}
function duration(value) {
  if (value === undefined || value === null) return 'Not recorded';
  return value < 1000 ? `${value} ms` : value < 60000 ? `${(value / 1000).toFixed(1)} s` : `${(value / 60000).toFixed(1)} min`;
}
function refreshIcons(root = document) { chronicleIcons.createIcons({ root, attrs: { 'aria-hidden': 'true' } }); }
function toast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 4000);
}
async function api(url, options) {
  const response = await fetch(url, options);
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || `Request failed (${response.status})`);
  return value;
}
function codeBlock(text, language = '', label, copy = true) {
  text = typeof text === 'string' ? text : JSON.stringify(text, null, 2);
  let content = escapeHtml(text);
  if (language && chronicleMarkdown.supportsLanguage(language) && text.length < 100000) {
    content = chronicleMarkdown.highlightCode(text, language);
  }
  return `<div class="code-block"><div class="code-top"><span>${escapeHtml(label || language || 'plain text')}</span>${copy ? `<button class="copy-code" data-copy-code>${icon('copy')} Copy</button>` : ''}</div><pre><code class="hljs">${content}</code></pre></div>`;
}
function markdown(text) {
  const rendered = chronicleMarkdown.parseMarkdown(text || '', {
    renderCodeBlock: (content, lang) => codeBlock(content, (lang || '').split(/\s+/)[0], undefined, false)
  });
  const html = chronicleMarkdown.sanitizeHtml(rendered);
  const template = document.createElement('template');
  template.innerHTML = html;
  for (const link of template.content.querySelectorAll('a')) {
    const href = link.getAttribute('href') || '';
    if (/^https?:\/\//i.test(href)) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
    else { link.removeAttribute('href'); link.classList.add('disabled-link'); link.title = `${href} (recorded reference; local files are not opened)`; }
  }
  for (const image of template.content.querySelectorAll('img')) {
    const source = image.getAttribute('src') || '';
    if (!/^data:image\/(png|jpeg|gif|webp);base64,/i.test(source)) {
      const marker = document.createElement('span');
      marker.className = 'badge';
      marker.textContent = `Image reference: ${image.alt || source} (not loaded)`;
      image.replaceWith(marker);
    }
  }
  for (const block of template.content.querySelectorAll('.code-block .code-top')) {
    const button = document.createElement('button');
    button.className = 'copy-code';
    button.dataset.copyCode = '';
    button.innerHTML = `${icon('copy')} Copy`;
    block.append(button);
  }
  return `<div class="prose">${template.innerHTML}</div>`;
}
function badge(text, name, green = false) { return `<span class="badge${green ? ' green' : ''}">${name ? icon(name) : ''}${escapeHtml(text)}</span>`; }
function recordSummary(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `${number(value.length)} ${value.length === 1 ? 'item' : 'items'}`;
  if (typeof value === 'object') return `${Object.keys(value).length} fields`;
  return String(value);
}
function renderRecord(value) {
  if (value === null || typeof value !== 'object') return `<div class="record-value">${escapeHtml(value === null ? 'null' : value)}</div>`;
  const entries = Array.isArray(value) ? value.map((item, index) => [String(index + 1), item]) : Object.entries(value);
  if (!entries.length) return '<span class="muted">No recorded values.</span>';
  return `<div class="record-grid">${entries.map(([key, child]) => {
    if (child !== null && typeof child === 'object') {
      const id = String(recordSequence++);
      records.set(id, child);
      return `<details data-record="${id}"><summary>${escapeHtml(humanize(key))} <span class="muted">/ ${recordSummary(child)}</span></summary><div></div></details>`;
    }
    return `<div class="record-leaf"><div class="record-key">${escapeHtml(humanize(key))}</div><div class="record-value">${escapeHtml(child === null ? 'null' : child)}</div></div>`;
  }).join('')}</div>`;
}
function warningsHtml(warnings) {
  if (!warnings.length) return '';
  return `<details class="warning-box"><summary>${icon('triangle-alert')} ${number(warnings.length)} source ${warnings.length === 1 ? 'warning' : 'warnings'} · Some data could not be reconstructed</summary>${warnings.map((item) => `<p>${escapeHtml(item)}</p>`).join('')}</details>`;
}

const bytes = (value) => value >= 1e9 ? `${(value / 1e9).toFixed(1)} GB` : value >= 1e6 ? `${(value / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round((value || 0) / 1e3))} KB`;
const kindLabels = { prompt: 'Prompt', response: 'Response', reasoning: 'Reasoning', tool: 'Tool call', edit: 'File edit', file: 'File' };
let libraryTimer;
let warningsShown = false;
function sessionTimestamp(session) {
  return session.lastAt || session.createdAt || 0;
}
function compareSessionNames(a, b) {
  return String(a.title || '').localeCompare(String(b.title || ''), undefined, { numeric: true, sensitivity: 'base' });
}
function sortSessions(list, sortBy = state.sortBy) {
  const copy = [...list];
  copy.sort((a, b) => {
    if (sortBy === 'date-asc') return sessionTimestamp(a) - sessionTimestamp(b) || compareSessionNames(a, b);
    if (sortBy === 'name-asc') return compareSessionNames(a, b) || sessionTimestamp(b) - sessionTimestamp(a);
    if (sortBy === 'name-desc') return compareSessionNames(b, a) || sessionTimestamp(b) - sessionTimestamp(a);
    return sessionTimestamp(b) - sessionTimestamp(a) || compareSessionNames(a, b);
  });
  return copy;
}
function setSortOrder(nextSort) {
  if (!['date-desc', 'date-asc', 'name-asc', 'name-desc'].includes(nextSort)) return;
  state.sortBy = nextSort;
  localStorage.setItem('chronicle-sort', nextSort);
  if ($('#sidebar-sort')) $('#sidebar-sort').value = nextSort;
  if (state.mode === 'library') renderLibraryTree();
  if (state.view === 'library') renderLibraryPage(false);
}
async function refreshLibrary() {
  const result = await api('/api/sessions');
  if (result.defaultPaths) state.defaultPaths = result.defaultPaths;
  state.library = sortSessions(result.sessions);
  state.indexing = result.indexing;
  state.emptySessions = result.empty || 0;
  if (result.warnings.length && !warningsShown) { warningsShown = true; toast(result.warnings.join(' · ')); }
  const { done, total, active, current } = result.indexing;
  $('#index-progress').hidden = !active;
  if (active) {
    $('#index-bar-fill').style.width = `${total ? Math.round((done / total) * 100) : 0}%`;
    $('#index-label').textContent = `Indexing ${number(done)} / ${number(total)} · ${current || ''}`;
  }
  if (state.mode === 'library') $('#session-count').textContent = `${number(state.library.length)} ${state.library.length === 1 ? 'session' : 'sessions'}${state.emptySessions ? ` · ${number(state.emptySessions)} empty hidden` : ''}`;
  clearTimeout(libraryTimer);
  if (active) libraryTimer = setTimeout(() => refreshLibrary().then(() => {
    if (state.mode === 'library') { renderLibraryTree(); if (state.view === 'library') renderLibraryPage(false); }
  }).catch(() => {}), 1500);
  return result;
}
async function loadLibrary(preferred) {
  await refreshLibrary();
  if (preferred) { await loadSession(preferred); return; }
  showLibrary();
}
function setMode(mode) {
  state.mode = mode;
  $('#session-count').textContent = mode === 'library' ? `${number(state.library.length)} ${state.library.length === 1 ? 'session' : 'sessions'}${state.emptySessions ? ` · ${number(state.emptySessions)} empty hidden` : ''}` : `${number(state.session.stats.prompts)} prompts · ${number(state.session.stats.tools)} tool calls`;
  document.body.classList.toggle('library-mode', mode === 'library');
  $('#back-to-library').hidden = mode === 'library';
  $('#sidebar-eyebrow').textContent = mode === 'library' ? 'LIBRARY' : 'SESSION';
  $('#tree-heading-label').textContent = mode === 'library' ? 'SESSIONS' : 'EXPLORER';
  $('#search').placeholder = mode === 'library' ? 'Filter sessions...' : 'Search the entire session...';
  $('#search').value = mode === 'library' ? state.libraryFilter || '' : '';
  $('#search-scope').querySelector('[value="session"]').disabled = mode === 'library' && !state.session;
}
function showLibrary() {
  stopStory();
  state.loadSequence++;
  setMode('library');
  $('#sidebar-title').textContent = 'Your conversations';
  $('#bottom-source').textContent = 'Session library';
  renderLibraryTree();
  if (!state.library.length) { renderEmpty(); return; }
  renderLibraryPage();
}
function workspaces(list = state.library) {
  const groups = new Map();
  for (const session of sortSessions(list)) {
    const name = session.workspaceName || 'Other sessions';
    if (!groups.has(name)) groups.set(name, { name, path: session.workspacePath, sessions: [] });
    const group = groups.get(name);
    if (!group.path && session.workspacePath) group.path = session.workspacePath;
    group.sessions.push(session);
  }
  const ordered = [...groups.values()];
  ordered.sort((a, b) => {
    if (state.sortBy === 'name-asc') return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    if (state.sortBy === 'name-desc') return b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: 'base' });
    const timeA = sessionTimestamp(a.sessions[0] || {});
    const timeB = sessionTimestamp(b.sessions[0] || {});
    return state.sortBy === 'date-asc' ? timeA - timeB : timeB - timeA;
  });
  return ordered;
}
function filteredLibrary() {
  const filter = (state.libraryFilter || '').toLowerCase();
  const base = filter ? state.library.filter((session) => `${session.title} ${session.firstPrompt || ''} ${session.workspaceName || ''} ${session.clientName || ''}`.toLowerCase().includes(filter)) : state.library;
  return sortSessions(base);
}
function sessionStatus(session) {
  if (session.status === 'error') return `<span class="session-flag error" title="${escapeHtml(session.error)}">${icon('triangle-alert')} Not indexed</span>`;
  if (session.status === 'pending') return `<span class="session-flag">${icon('loader')} Indexing</span>`;
  return '';
}
function sessionOriginBadge(session) {
  return session.sessionFormat === 'agent-host' ? '<span class="origin-tag agent">Agent</span>' : '';
}
function renderLibraryTree() {
  if (state.mode !== 'library') return;
  if ($('#sidebar-sort')) $('#sidebar-sort').value = state.sortBy;
  $('.format-tag').textContent = 'LOCAL';
  const list = filteredLibrary();
  const groups = workspaces(list);
  state.visible = [];
  $('#tree-scroll').innerHTML = groups.map((group) => {
    const open = !state.collapsedWorkspaces.has(group.name) || !!state.libraryFilter;
    return `<div class="workspace-group${open ? ' open' : ''}"><button class="workspace-row" data-workspace="${escapeHtml(group.name)}" title="${escapeHtml(group.path || group.name)}">${icon(open ? 'chevron-down' : 'chevron-right')}${icon('folder-git-2', 'node-icon')}<span class="tree-title">${escapeHtml(group.name)}</span><span class="node-count">${group.sessions.length}</span></button>
      ${open ? `<div class="workspace-sessions">${group.sessions.map((session) => `<button class="session-row${state.session?.id === session.id ? ' current' : ''}" data-session="${session.id}" title="${escapeHtml(session.firstPrompt || session.title)}"><span class="session-row-title">${escapeHtml(session.title)}</span><span class="session-row-meta">${sessionOriginBadge(session)}${session.lastAt || session.createdAt ? date(session.lastAt || session.createdAt, { year: 'numeric', hour: undefined, minute: undefined }) : ''}${session.stats ? ` · ${number(session.stats.prompts)} ${session.stats.prompts === 1 ? 'prompt' : 'prompts'}` : ''} · ${bytes(session.size)}</span>${sessionStatus(session)}</button>`).join('')}</div>` : ''}</div>`;
  }).join('') || `<div class="empty-state">${state.library.length ? 'No sessions match this filter.' : 'No sessions yet.'}</div>`;
  $('#tree-status').textContent = `${number(list.length)} of ${number(state.library.length)} sessions`;
  refreshIcons($('#tree-scroll'));
}
function renderLibraryPage(resetScroll = true) {
  state.view = 'library';
  state.selected = null;
  records.clear();
  $('.rail-button.active')?.classList.remove('active');
  $('#library-button').classList.add('active');
  $('#breadcrumb').innerHTML = 'Library <span>/</span> All sessions';
  const list = state.library;
  const totals = list.reduce((sum, session) => {
    sum.prompts += session.stats?.prompts || 0; sum.tools += session.stats?.tools || 0; sum.size += session.size || 0;
    return sum;
  }, { prompts: 0, tools: 0, size: 0 });
  const filtered = filteredLibrary();
  const groups = workspaces(filtered);
  const { done, total, active } = state.indexing || {};
  const isDateSort = state.sortBy.startsWith('date-');
  const isNameSort = state.sortBy.startsWith('name-');
  const scroll = $('#reader').scrollTop;
  $('#reader').innerHTML = `<article class="reader-inner library-page">
    <div class="session-eyebrow"><span class="line"></span> YOUR CONVERSATION LIBRARY</div>
    <div class="hero"><h1>Every session, one place.</h1><p>${number(list.length)} conversations across ${number(workspaces().length)} workspaces. Open VS Code or Agent Host / Copilot CLI sessions to explore and search them together.</p><div class="hero-art"><span class="orbit-dot"></span>${icon('library')}<span class="orbit-dot"></span></div></div>
    ${active ? `<div class="index-card"><div class="index-card-top">${icon('scan-search')}<span>Building the search index · ${number(done)} of ${number(total)} sessions</span><span class="muted">${escapeHtml(state.indexing.current || '')}</span></div><div class="index-bar large"><span style="width:${total ? Math.round((done / total) * 100) : 0}%"></span></div><p class="muted">Sessions open immediately; search covers each session as soon as it is indexed. The index is cached, so this only happens once per change.</p></div>` : ''}
    <div class="metrics">${metric('Sessions', list.length, 'messages-square', `${number(state.emptySessions)} empty hidden`)}${metric('Workspaces', workspaces().length, 'folder-git-2', 'Grouped by folder')}${metric('Prompts', totals.prompts, 'message-square', 'Across all sessions')}${metric('Tool calls', totals.tools, 'terminal', `${bytes(totals.size)} of history`)}</div>
    <div class="library-toolbar" role="region" aria-label="Sort sessions">
      <span class="library-toolbar-summary">${number(filtered.length)} ${filtered.length === 1 ? 'session' : 'sessions'} shown</span>
      <div class="sort-controls">
        <span class="sort-label">${icon('arrow-up-down')} Sort by</span>
        <button type="button" class="sort-pill${isDateSort ? ' active' : ''}" data-sort-toggle="date">${icon('calendar-days')} Date ${state.sortBy === 'date-asc' ? '↑' : '↓'}</button>
        <button type="button" class="sort-pill${isNameSort ? ' active' : ''}" data-sort-toggle="name">${icon('arrow-down-a-z')} Name ${state.sortBy === 'name-desc' ? 'Z→A' : 'A→Z'}</button>
        <select id="library-page-sort" aria-label="Sort sessions order">
          <option value="date-desc"${state.sortBy === 'date-desc' ? ' selected' : ''}>Date (Newest first)</option>
          <option value="date-asc"${state.sortBy === 'date-asc' ? ' selected' : ''}>Date (Oldest first)</option>
          <option value="name-asc"${state.sortBy === 'name-asc' ? ' selected' : ''}>Name (A → Z)</option>
          <option value="name-desc"${state.sortBy === 'name-desc' ? ' selected' : ''}>Name (Z → A)</option>
        </select>
      </div>
    </div>
    ${groups.map((group) => `<section class="library-group"><div class="section-title"><h2>${icon('folder-git-2')} ${escapeHtml(group.name)} <span>${group.sessions.length}</span></h2><span class="muted library-path">${escapeHtml(group.path || '')}</span></div><div class="session-cards">
      ${group.sessions.map((session) => `<button class="session-card${session.status === 'error' ? ' failed' : ''}" data-session="${session.id}"><div class="preview-top"><span class="prompt-chip">${session.stats ? `${number(session.stats.prompts)} ${session.stats.prompts === 1 ? 'PROMPT' : 'PROMPTS'}` : 'INDEXING'}</span>${sessionOriginBadge(session)}<time>${date(session.lastAt || session.createdAt)}</time></div><div class="session-card-title">${escapeHtml(session.title)}</div><div class="preview-text">${escapeHtml(session.firstPrompt || '')}</div><div class="preview-bottom">${session.stats ? `<span>${number(session.stats.tools)} tool calls</span><span>${escapeHtml(modelName(session.modelTimeline?.at(-1)?.to))}</span>` : ''}<span>${bytes(session.size)}</span>${sessionStatus(session)}</div></button>`).join('')}
    </div></section>`).join('') || '<div class="empty-state">No sessions match this filter.</div>'}
  </article>`;
  $('#reader').scrollTop = resetScroll ? 0 : scroll;
  refreshIcons($('#reader'));
}
function enterSession() {
  state.view = 'session';
  $('.format-tag').textContent = state.session?.sessionFormat === 'agent-host' ? 'AGENT HOST' : 'VS CODE';
  if (state.mode === 'session') return;
  setMode('session');
  $('#sidebar-title').textContent = state.session.title;
  $('#bottom-source').textContent = state.session.file;
}
function renderEmpty() {
  $('#tree-scroll').innerHTML = '<div class="empty-state">Your next discovery starts here.</div>';
  $('#reader').innerHTML = `<div class="empty-state">${icon('orbit')}<h2>A new perspective on your conversations.</h2><p>Open saved VS Code workspaceStorage history or Agent Host / Copilot CLI sessions to uncover the messages, tools, models, and edits behind every task.</p><div class="empty-actions"><button class="button primary" data-open>Open VS Code sessions ${icon('arrow-up-right')}</button><button class="button" data-open-agent>${icon('bot')} Open Agent / CLI sessions</button></div></div>`;
  $('#tree-status').textContent = 'Ready to explore';
  refreshIcons();
}
async function loadSession(id, { render = true } = {}) {
  stopStory();
  const sequence = ++state.loadSequence;
  state.searchSequence++;
  clearTimeout(searchTimer);
  const entry = state.library.find((session) => session.id === id);
  $('#reader').innerHTML = `<div class="loading-state"><span class="spinner"></span> Reconstructing ${entry ? `“${escapeHtml(entry.title)}”` : 'the conversation'}${entry?.size > 50e6 ? ` · reading ${bytes(entry.size)}, this can take a few seconds` : ''}...</div>`;
  let session;
  try { session = await api(`/api/sessions/${id}`); }
  catch (error) {
    if (sequence === state.loadSequence) {
      $('#reader').innerHTML = `<div class="empty-state">${icon('triangle-alert')}<h2>This session could not be opened.</h2><p>${escapeHtml(error.message)}</p><button class="button" data-library>Back to library</button></div>`;
      refreshIcons($('#reader'));
    }
    return false;
  }
  if (sequence !== state.loadSequence) return false;
  state.session = session;
  setMode('session');
  $('#sidebar-title').textContent = session.title;
  $('#sidebar-title').title = session.workspacePath || session.file;
  state.view = 'session';
  state.nodes.clear(); state.parents.clear(); state.expanded.clear(); state.cache.clear();
  state.query = ''; state.matches.clear(); state.filter = 'all'; state.detail = null;
  $('#search').value = '';
  document.querySelectorAll('.filter').forEach((button) => button.classList.toggle('active', button.dataset.filter === 'all'));
  localStorage.setItem('chronicle-session', id);
  function index(item, parent) {
    if (!state.nodes.has(item.id)) {
      state.nodes.set(item.id, item);
      if (parent) state.parents.set(item.id, parent.id);
      item.children.forEach((child) => index(child, item));
    }
  }
  index(session.overview);
  session.requests.forEach((request) => index(request));
  if (session.requests[0]) state.expanded.add(session.requests[0].id);
  state.selected = session.overview.id;
  $('#bottom-source').textContent = session.file;
  $('#bottom-source').title = session.file;
  $('#tree-status').textContent = `${number(state.nodes.size)} recorded items`;
  renderTree();
  if (render) renderOverview();
  return true;
}
function matchesKind(item) {
  return state.filter === 'all' || (state.filter === 'response' ? ['prompt', 'response'].includes(item.kind) : item.kind === state.filter);
}
function renderTree() {
  if (!state.session || state.mode !== 'session') return;
  const scroll = $('#tree-scroll').scrollTop;
  const searching = !!state.query || state.filter !== 'all';
  const visibility = new Map();
  function visible(item) {
    if (visibility.has(item.id)) return visibility.get(item.id);
    const self = matchesKind(item) && (!state.query || state.matches.has(item.id));
    const result = self || item.children.some(visible);
    visibility.set(item.id, result);
    return result;
  }
  state.visible = [];
  function branch(item, level) {
    if (searching && !visible(item)) return '';
    state.visible.push(item.id);
    const children = searching ? item.children.filter(visible) : item.children;
    const expanded = state.expanded.has(item.id) || searching;
    const selected = state.selected === item.id;
    const position = state.visible.length;
    return `<li class="tree-branch" role="none"><div role="treeitem" tabindex="${selected || (state.selected === state.session.overview.id && position === 1) ? '0' : '-1'}" aria-level="${level}" aria-selected="${selected}" ${children.length ? `aria-expanded="${expanded}"` : ''} class="tree-row${item.kind === 'prompt' ? ' prompt-row' : ''}${selected ? ' selected' : ''}${item.failed ? ' failed' : ''}" data-node="${item.id}" data-position="${position}" data-kind="${item.kind}" title="${escapeHtml(item.title)}">
      <button class="twisty${children.length ? '' : ' placeholder'}" tabindex="-1" data-toggle="${item.id}" aria-label="${expanded ? 'Collapse' : 'Expand'}">${icon(expanded ? 'chevron-down' : 'chevron-right')}</button>
      ${item.kind === 'prompt' ? `<span class="prompt-number">${String(item.index).padStart(2, '0')}</span>` : ''}${icon(icons[item.kind] || 'circle', 'node-icon')}<span class="tree-title">${escapeHtml(item.title)}</span>${item.hidden ? icon('eye-off', 'node-icon') : ''}${children.length ? `<span class="node-count">${children.length}</span>` : ''}</div>
      ${item.kind === 'prompt' && !searching ? `<div class="prompt-model">${escapeHtml(modelName(item.model))}</div>` : ''}
      ${children.length && expanded ? `<ul role="group" class="tree-branch tree-children">${children.map((child) => branch(child, level + 1)).join('')}</ul>` : ''}</li>`;
  }
  const overview = state.session.overview;
  const prompts = state.session.requests.map((request) => branch(request, 1)).join('');
  const overviewChildren = state.expanded.has(overview.id) || searching ? overview.children.map((child) => branch(child, 1)).join('') : '';
  $('#tree-scroll').innerHTML = `<button class="tree-overview${state.selected === overview.id ? ' active' : ''}" data-select="${overview.id}">${icon('panels-top-left')}Session overview<span class="overview-count">${state.session.stats.prompts} prompts</span><span class="twisty" data-toggle="${overview.id}" title="Show source records">${icon(state.expanded.has(overview.id) ? 'chevron-down' : 'chevron-right')}</span></button>
    ${overviewChildren ? `<ul class="tree-branch" role="tree" aria-label="Session source records">${overviewChildren}</ul>` : ''}
    <div class="tree-label"><span>CONVERSATION</span><span>${searching ? 'FILTERED' : 'CHRONOLOGICAL'}</span></div>
    <ul class="tree-branch" role="tree" aria-label="Conversation history">${prompts}</ul>${!prompts ? '<div class="empty-state">No matching conversation items.</div>' : ''}`;
  $('#tree-scroll').scrollTop = scroll;
  refreshIcons($('#tree-scroll'));
}
function metric(label, count, name, foot) {
  return `<div class="metric"><div class="metric-top">${label}${icon(name)}</div><div class="metric-value">${number(count)}</div><div class="metric-foot">${foot}</div></div>`;
}
function modelTimelineHtml() {
  return `<div class="model-card">${state.session.modelTimeline.map((item) => `<div class="model-item"><div class="model-name">${escapeHtml(modelName(item.to))}</div><div class="model-desc">${item.from ? 'Switched at' : 'Selected at'} prompt ${String(item.prompt).padStart(2, '0')} · ${date(item.timestamp, { hour: undefined, minute: undefined })}</div><div class="model-config">${Object.entries(item.configuration || {}).map(([key, value]) => `<span>${escapeHtml(humanize(key))}: ${escapeHtml(typeof value === 'object' ? JSON.stringify(value) : numberIfNeeded(value))}</span>`).join('')}</div></div>`).join('') || '<span class="muted">No model metadata was recorded.</span>'}</div>`;
}
function numberIfNeeded(value) { return typeof value === 'number' ? number(value) : String(value); }
function renderOverview(modelsOnly = false) {
  stopStory();
  records.clear();
  const session = state.session;
  const stats = session.stats;
  enterSession();
  state.detail = null; state.tab = 'readable';
  state.selected = session.overview.id;
  $('#breadcrumb').innerHTML = `Sessions <span>/</span> ${modelsOnly ? 'Model timeline' : 'Session overview'}`;
  $('.rail-button.active')?.classList.remove('active');
  $(modelsOnly ? '#models-button' : '#home-button').classList.add('active');
  const preview = session.requests.slice(0, 5);
  $('#reader').innerHTML = `<article class="reader-inner">
    <div class="session-eyebrow"><span class="line"></span> ${modelsOnly ? 'THE INTELLIGENCE BEHIND THE CONVERSATION' : 'THE ANATOMY OF A CONVERSATION'}</div>
    <div class="hero"><h1>${modelsOnly ? 'A clear view of every model.' : escapeHtml(session.title)}</h1><p>${modelsOnly ? 'Model selections and changes, based on the metadata actually recorded in each request.' : 'Go beyond the chat window. Explore every prompt, response, tool call, and file change in one connected history.'}</p><div class="hero-art"><span class="orbit-dot"></span>${icon('fingerprint')}<span class="orbit-dot"></span></div></div>
    <div class="session-meta"><span>${icon('calendar-days')}${date(session.createdAt, { year: 'numeric', hour: undefined, minute: undefined })}</span><span>${icon('cpu')}${stats.models} ${stats.models === 1 ? 'model' : 'models'}</span>${badge('Read-only source', 'shield-check', true)}<span>${icon('hash')}${escapeHtml(session.sessionId.slice(0, 8))}</span>${!modelsOnly ? `<button class="button primary" data-read-story>${icon('book-open')} Read full session</button>` : ''}</div>
    ${warningsHtml(session.warnings)}
    ${modelsOnly ? `${modelTimelineHtml()}<div class="footnote">${icon('info')}Model changes are detected between persisted requests. Internal routing or changes not saved by VS Code cannot be inferred. Tool-specific subagent model metadata is shown on its tool item.</div>` : `
    <div class="metrics">${metric('User prompts', stats.prompts, 'message-square', 'The starting points')}${metric('Tool calls', stats.tools, 'terminal', 'Actions behind the answers')}${metric('File operations', stats.edits, 'file-diff', 'Persisted editing history')}${metric('Reasoning blocks', stats.reasoning, 'brain', 'Including unavailable text')}</div>
    <div class="overview-columns"><section><div class="section-title"><h2>Conversation <span>${stats.prompts} prompts</span></h2><button class="section-link" id="browse-prompts">Explore all ${icon('arrow-up-right')}</button></div><div class="activity-card"><div class="activity-header"><span>THE CONVERSATION, UNFOLDED</span>${icon('messages-square')}</div>
    ${preview.map((request) => `<button class="prompt-preview" data-select="${request.id}"><div class="preview-top"><span class="prompt-chip">PROMPT ${String(request.index).padStart(2, '0')}</span><time>${date(request.timestamp)}</time></div><div class="preview-text">${escapeHtml(request.title)}</div><div class="preview-bottom"><span>${escapeHtml(modelName(request.model))}</span><span>${request.children.filter((child) => child.kind === 'tool').length} tool calls</span><span>${number(request.children.length)} items</span></div></button>`).join('') || '<div class="empty-state">This session has no persisted prompts.</div>'}
    </div><div class="footnote">${icon('corner-down-right')}Select a prompt in the explorer to follow its story. Everything beneath it belongs to that turn.</div></section>
    <div class="overview-side"><div><div class="section-title"><h2>Model timeline</h2>${badge(`${Math.max(0, session.modelTimeline.length - 1)} switches`, null)}</div>${modelTimelineHtml()}</div>
    <div><div class="section-title"><h2>Connected sources</h2>${icon('layers')}</div><div class="source-list">
    ${session.sessionFormat === 'agent-host'
      ? `${sourceRow('Agent event stream', `events.jsonl (${number(session.sources.transcript)} events)`, true, 'activity')}${sourceRow('Workspace metadata', 'workspace.yaml', !!session.sources.workspaceYaml, 'folder-git-2')}${sourceRow('Recorded file edits', `${number(stats.edits)} operations`, !!session.sources.editing, 'files')}${sourceRow('Model metadata', 'Connected', !!session.sources.models, 'cpu')}${sourceRow('Checkpoints', `${number(session.sources.checkpoints || 0)} saved`, !!session.sources.checkpoints, 'flag')}`
      : `${sourceRow('Persisted session', session.sources.session, true, 'messages-square')}${sourceRow('Agent transcript', `${number(session.sources.transcript)} events`, !!session.sources.transcript, 'activity')}${sourceRow('Editing snapshots', session.sources.editing ? 'Connected' : 'Not found', session.sources.editing, 'files')}${sourceRow('Model catalog', session.sources.models ? 'Connected' : 'Not found', session.sources.models, 'cpu')}${sourceRow('Debug log', `${number(session.sources.debug)} events`, !!session.sources.debug, 'scan-line')}`}</div></div></div></div>
    <hr class="section-divider"><div class="section-title"><h2>Your data stays where it belongs.</h2>${badge('100% local', 'hard-drive', true)}</div><div class="footnote">${icon('lock-keyhole')}Original files are never modified, recorded tools are never executed, and remote images are never fetched. Unavailable reasoning and missing sources are labeled, not guessed.</div><div class="source-path">${escapeHtml(session.file)}</div>`}
    </article>`;
  $('#reader').scrollTop = 0;
  renderTree();
  refreshIcons($('#reader'));
}
function sourceRow(label, value, available, name) {
  return `<div class="source-row">${icon(name)}<span>${label}</span><span class="source-value${available ? '' : ' unavailable'}">${available ? (label === 'Persisted session' ? '.json / .jsonl' : escapeHtml(value)) : 'Not found'}</span></div>`;
}

function parentPrompt(id) {
  let node = state.nodes.get(id);
  while (node && node.kind !== 'prompt') node = state.nodes.get(state.parents.get(node.id));
  return node;
}
async function selectNode(id) {
  const item = state.nodes.get(id);
  if (!item) return;
  if (item.kind === 'overview') { renderOverview(); return; }
  stopStory();
  enterSession();
  state.selected = id;
  state.tab = 'readable';
  let parent = state.parents.get(id);
  while (parent) { state.expanded.add(parent); parent = state.parents.get(parent); }
  renderTree();
  $('.rail-button.active')?.classList.remove('active');
  const prompt = parentPrompt(id);
  $('#breadcrumb').innerHTML = `Sessions <span>/</span>${prompt ? `Prompt ${String(prompt.index).padStart(2, '0')} <span>/</span>` : ''}${escapeHtml(humanize(item.kind))}`;
  $('#reader').innerHTML = '<div class="loading-state"><span class="spinner"></span> Reading recorded contents...</div>';
  const sessionId = state.session.id;
  try {
    const detail = state.cache.get(id) || await api(`/api/sessions/${sessionId}/nodes/${id}`);
    if (state.selected !== id || state.session.id !== sessionId) return;
    state.cache.set(id, detail); state.detail = detail;
    renderDetail();
    $('#reader').scrollTop = 0;
  } catch (error) {
    if (state.selected === id) $('#reader').innerHTML = `<div class="empty-state">${icon('triangle-alert')} ${escapeHtml(error.message)}</div>`;
    refreshIcons();
  }
}
function renderDetail() {
  const item = state.detail;
  if (!item) return;
  stopStory();
  records.clear();
  const prompt = parentPrompt(item.id);
  const tabs = item.before !== undefined && item.after !== undefined
    ? [['readable', 'Changes'], ['before', 'Before'], ['after', 'After'], ['raw', 'Raw record']]
    : [['readable', item.kind === 'prompt' ? 'Conversation story' : 'Readable'], ['raw', 'Raw record']];
  const title = item.kind === 'prompt' ? `Prompt ${String(prompt?.index || item.index).padStart(2, '0')}` :
    item.kind === 'response' ? 'Assistant response' : item.kind === 'reasoning' ? 'Recorded reasoning' : item.title;
  $('#reader').innerHTML = `<article class="reader-inner"><header class="detail-header"><div class="detail-symbol">${icon(icons[item.kind] || 'activity')}</div><div><div class="detail-kicker">${escapeHtml(item.kind === 'prompt' ? 'USER MESSAGE' : humanize(item.kind))}${prompt && item.kind !== 'prompt' ? ` / PROMPT ${String(prompt.index).padStart(2, '0')}` : ''}</div><h1>${escapeHtml(title)}</h1><div class="detail-meta">${item.model || prompt?.model ? badge(modelName(item.model || prompt?.model), 'cpu', true) : ''}${badge(item.source, 'database')}${item.timestamp ? badge(date(item.timestamp), 'clock-3') : ''}${item.duration !== undefined && item.duration !== null ? badge(duration(item.duration), 'timer') : ''}${item.hidden ? badge('Hidden in original transcript', 'eye-off') : ''}${item.failed ? badge('Tool reported an error', 'triangle-alert') : ''}</div></div></header>
    <div class="detail-tabs" role="tablist">${tabs.map(([key, label]) => `<button class="detail-tab${state.tab === key ? ' active' : ''}" role="tab" aria-selected="${state.tab === key}" data-tab="${key}">${label}</button>`).join('')}<button class="icon-button" id="copy-item" title="Copy current item" aria-label="Copy current item">${icon('copy')}</button></div>
    <div class="content-panel" role="tabpanel">${state.tab === 'raw' ? `${item.rawTruncated ? `<div class="footnote">${icon('scissors')}This record is very large, so the preview is shortened. Long strings and lists are trimmed and marked; the source file is unchanged.</div>` : ''}${codeBlock(JSON.stringify(item.raw, null, 2), 'json', 'Original persisted record · JSON')}` :
      state.tab === 'before' || state.tab === 'after' ? codeBlock(item[state.tab], languageFor(item.file), `${state.tab === 'before' ? 'Before' : 'After'} · ${item.file}`) : renderReadable(item)}</div>
    </article>`;
  if (state.results && state.highlight?.nodeId === item.id && !$('#breadcrumb [data-back-results]')) {
    $('#breadcrumb').insertAdjacentHTML('afterbegin', `<button class="back-to-results" data-back-results>${icon('arrow-left')} Results</button>`);
    refreshIcons($('#breadcrumb'));
  }
  refreshIcons($('#reader'));
  if (state.highlight?.nodeId === item.id) {
    const hit = markTerms($('.content-panel'), state.highlight.terms);
    if (hit) requestAnimationFrame(() => hit.scrollIntoView({ block: 'center' }));
  }
  if (item.kind === 'prompt' && state.tab === 'readable') {
    mountStory($('#prompt-story'), `/api/sessions/${state.session.id}/story?parent=${item.id}`, storyVersion);
  }
}
function languageFor(file = '') {
  const ext = file.split('.').at(-1).toLowerCase();
  return ({ js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', json: 'json', css: 'css', html: 'xml', md: 'markdown', py: 'python', ps1: 'powershell', yml: 'yaml', yaml: 'yaml', sh: 'bash' })[ext] || '';
}
function keyValues(entries) {
  return `<dl class="key-values">${entries.filter(([, value]) => value !== undefined && value !== null).map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`).join('')}</dl>`;
}
function relatedItems(id) {
  const children = state.nodes.get(id)?.children || [];
  if (!children.length) return '';
  return `<div class="section-title"><h2>Recorded items <span>${children.length}</span></h2></div><div class="related-items">${children.map((child) => `<button class="related-item" data-select="${child.id}">${icon(icons[child.kind] || 'activity')}<span>${escapeHtml(child.title)}</span>${icon('arrow-up-right')}</button>`).join('')}</div>`;
}
function renderReadable(item) {
  if (item.kind === 'prompt') {
    const raw = item.raw;
    return `<section class="story-prompt-text">${markdown(item.text)}</section><details class="story-metadata"><summary>${icon('sliders-horizontal')} Prompt metadata & model configuration</summary>${keyValues([
      ['Model', item.model], ['Agent', raw.agent?.fullName || raw.agent?.name], ['Mode', raw.modeInfo?.name || raw.modeInfo?.kind],
      ['Input tokens', raw.promptTokens === undefined ? undefined : number(raw.promptTokens)], ['Output tokens', raw.completionTokens === undefined ? undefined : number(raw.completionTokens)],
      ['Elapsed', raw.elapsedMs === undefined ? undefined : duration(raw.elapsedMs)], ['Request ID', raw.requestId]
    ])}${raw.modelConfiguration ? `<div class="tool-section"><h3>Model configuration</h3>${renderRecord(raw.modelConfiguration)}</div>` : ''}</details><div class="story-divider"><span>THE CONVERSATION CONTINUES</span></div><div id="prompt-story" class="story-stream"></div>`;
  }
  if (item.kind === 'response') return markdown(item.text);
  if (item.kind === 'reasoning') {
    return item.available ? markdown(item.text) : `<div class="empty-reasoning">${icon('brain')}<h3>This reasoning text wasn't saved.</h3><p>The session contains reasoning markers or opaque IDs, but no readable reasoning transcript for this block. Those IDs are not text and cannot be decoded. The complete persisted records are available in the Raw record tab.</p></div>`;
  }
  if (item.kind === 'model') {
    return `${keyValues([['Previous model', item.raw.from || 'Initial selection'], ['Selected model', item.raw.to], ['Effective at', `Prompt ${item.raw.prompt}`]])}<div class="tool-section"><h3>Recorded configuration</h3>${renderRecord(item.raw.configuration || {})}</div>`;
  }
  if (item.kind === 'tool') return renderTool(item);
  if (item.kind === 'edit') {
    if (item.diff) return renderDiff(item);
    const edits = item.raw.edits;
    return `${item.file ? `<div class="source-path">${escapeHtml(item.file)}</div>` : ''}<div class="footnote">${icon('info')}${item.before !== undefined && item.after !== undefined ? 'Diff computation exceeded its time limit. Complete before and after contents are available in their tabs.' : 'Recorded edit payload. A complete before/after pair is not available here; reconstructed changes, when available, are under File edit history.'}</div>${edits ? edits.flat().map((edit) => `<div class="tool-section"><h3>${edit.range ? `Lines ${edit.range.startLineNumber}:${edit.range.startColumn} – ${edit.range.endLineNumber}:${edit.range.endColumn}` : 'Recorded edit'}</h3>${codeBlock(edit.text ?? JSON.stringify(edit, null, 2), languageFor(item.file))}</div>`).join('') : renderRecord(item.raw)}`;
  }
  if (item.kind === 'group') return `<p class="group-hint">${escapeHtml(item.raw.description)}</p>${relatedItems(item.id)}`;
  if (item.kind === 'event') {
    const data = item.raw.data || item.raw.attrs;
    return `${item.text ? markdown(item.text) : ''}${data ? `<div class="tool-section"><h3>Event data</h3>${renderRecord(data)}</div>${keyValues([['Event type', item.raw.type], ['Event ID', item.raw.id], ['Parent ID', item.raw.parentId], ['Source line', item.line]])}` : renderRecord(item.raw)}`;
  }
  return renderRecord(item.raw);
}
function renderTool(item, inline = false) {
  const raw = item.raw;
  const specific = raw.toolSpecificData || {};
  const command = specific.commandLine?.original || (typeof specific.commandLine === 'string' ? specific.commandLine : null);
  const result = raw.resultDetails;
  const output = result?.output;
  return `${raw.invocationMessage ? markdown(textOf(raw.pastTenseMessage) || textOf(raw.invocationMessage)) : ''}
    ${inline ? '' : keyValues([['Tool', raw.toolId], ['Call ID', raw.toolCallId], ['Status', item.failed ? 'Reported error' : raw.isComplete ? 'Completed' : 'Completion not recorded'], ['Duration', item.duration === null ? undefined : duration(item.duration)], ['Source', raw.source?.label]])}
    ${command ? `<div class="tool-section"><h3>Terminal command</h3>${codeBlock(command, specific.language === 'pwsh' ? 'powershell' : 'bash')}</div>` : ''}
    ${item.arguments !== undefined ? `<div class="tool-section"><h3>Tool input</h3>${codeBlock(typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments, null, 2), typeof item.arguments === 'object' ? 'json' : '')}</div>` : ''}
    ${output ? `<div class="tool-section"><h3>Tool output</h3>${Array.isArray(output) ? output.map((entry) => entry.isText || typeof entry === 'string' ? codeBlock(textOf(entry), '', 'Recorded output') : renderRecord(entry)).join('') : codeBlock(typeof output === 'string' ? output : JSON.stringify(output, null, 2))}</div>` : ''}
    ${result ? `<div class="tool-section"><h3>Result details</h3>${inline ? renderStoryContext(result) : renderRecord(result)}</div>` : inline ? '' : '<div class="footnote">' + icon('info') + 'No separate result payload was persisted for this tool. Related events may provide additional context.</div>'}
    ${specific.kind === 'subagent' ? `<div class="tool-section"><h3>Subagent prompt</h3>${markdown(specific.prompt || '(Not recorded)')}<h3>Subagent result</h3>${markdown(specific.result || '(Not recorded)')}</div>` : ''}
    ${Object.keys(specific).length ? `<${inline ? 'details' : 'div'} class="tool-section">${inline ? '<summary>Additional tool metadata</summary>' : '<h3>Tool-specific data</h3>'}${renderRecord(specific)}</${inline ? 'details' : 'div'}>` : ''}${inline ? '' : relatedItems(item.id)}`;
}
function renderDiff(item) {
  let oldLine = 1;
  let newLine = 1;
  let additions = 0;
  let deletions = 0;
  const lines = item.diff.map((part) => {
    const list = part.value.split('\n');
    if (list.at(-1) === '') list.pop();
    if (part.added) additions += list.length;
    if (part.removed) deletions += list.length;
    return list.map((line) => `<div class="diff-line${part.added ? ' added' : part.removed ? ' removed' : ''}"><span class="line-number">${part.added ? '' : oldLine++}</span><span class="line-number">${part.removed ? '' : newLine++}</span><span class="line-sign">${part.added ? '+' : part.removed ? '-' : ' '}</span><span class="line-content">${escapeHtml(line.replace(/\r$/, ''))}</span></div>`).join('');
  }).join('');
  return `<div class="diff-toolbar"><span>${escapeHtml(item.file)}</span><span class="diff-stats"><span class="addition">+${additions}</span><span class="deletion">−${deletions}</span></span></div><div class="diff-body">${lines || '<div class="empty-state">No text change in this operation.</div>'}</div><div class="footnote">${icon('git-compare-arrows')}${item.source === 'Saved snapshots' ? 'Exact saved content blobs. Session-wide original versus saved current version; not a single-prompt diff.' : `Reconstructed from the persisted edit timeline. Epoch ${item.epoch ?? 'not recorded'}.`} Source files are never opened or modified.</div>`;
}

function renderStoryContext(value) {
  const texts = [];
  function collect(current, key = '') {
    if (typeof current === 'string') {
      if (current.trim() && (/^(text|value|content|message|summary|summaries|description|prompt|result|output)$/i.test(key) || current.length > 200)) texts.push(current);
    } else if (Array.isArray(current)) current.forEach((entry) => collect(entry, key));
    else if (current && typeof current === 'object') Object.entries(current).forEach(([name, entry]) => collect(entry, name));
  }
  collect(value);
  return `${texts.map((text) => markdown(text)).join('')}<details class="story-metadata"><summary>${icon('list-tree')} ${texts.length ? 'Supporting' : 'Recorded'} metadata</summary>${renderRecord(value)}</details>`;
}
function renderStoryItem(item) {
  const label = { response: 'Copilot', reasoning: 'Reasoning', prompt: `You / Prompt ${String(item.index).padStart(2, '0')}`, tool: item.toolName || 'Tool activity', edit: 'File change', model: 'Model selection', context: item.title, event: item.title }[item.kind] || humanize(item.kind);
  let contents;
  if (item.kind === 'prompt') {
    contents = `<div class="story-prompt-text">${markdown(item.text)}</div>${item.raw.modelConfiguration ? `<details class="story-metadata"><summary>${icon('cpu')} Model configuration</summary>${renderRecord(item.raw.modelConfiguration)}</details>` : ''}`;
  } else if (item.kind === 'response') contents = markdown(item.text);
  else if (item.kind === 'reasoning') {
    contents = item.available ? markdown(item.text) : '<div class="story-unavailable">Reasoning was recorded, but its text was not persisted.</div>';
  } else if (item.kind === 'tool') contents = renderTool(item, true);
  else if (item.kind === 'group') {
    return `<details class="story-source-group" data-story-group="${item.id}"><summary>${icon(icons[item.kind] || 'folder')} ${escapeHtml(item.title)} <span>${number(item.childCount)} source items · expands here</span></summary><p class="group-hint">${escapeHtml(item.raw.description || 'Additional recorded source data.')}</p><div class="story-stream"></div></details>`;
  } else if (item.kind === 'context' || item.kind === 'event') {
    contents = renderStoryContext(item.raw);
  } else contents = renderReadable(item);
  return `<section class="story-item story-${item.kind}" data-story-item="${item.id}"><header class="story-item-header"><span class="story-speaker">${icon(icons[item.kind] || 'activity')}${escapeHtml(label)}</span>${item.kind === 'prompt' && item.model ? badge(modelName(item.model), 'cpu', true) : ''}${item.timestamp ? `<time>${date(item.timestamp)}</time>` : ''}${item.failed ? badge('Reported error', 'triangle-alert') : ''}<button class="icon-button story-inspect" data-select="${item.id}" title="Inspect original record" aria-label="Inspect original record">${icon('scan-line')}</button></header>${contents}</section>`;
}
function mountStory(container, endpoint, version) {
  if (!container) return;
  let offset = 0;
  let loading = false;
  let finished = false;
  const sentinel = document.createElement('div');
  sentinel.className = 'story-sentinel';
  sentinel.innerHTML = '<span class="spinner"></span><span>Unfolding the next part of the story...</span>';
  container.append(sentinel);
  const observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) load();
  }, { root: $('#reader'), rootMargin: '1000px 0px' });
  storyObservers.add(observer);
  async function load() {
    if (loading || finished || version !== storyVersion) return;
    loading = true;
    try {
      const page = await api(`${endpoint}${endpoint.includes('?') ? '&' : '?'}offset=${offset}&limit=16`);
      if (version !== storyVersion || !container.isConnected) return;
      const batch = document.createElement('div');
      batch.className = 'story-batch';
      batch.innerHTML = page.items.map(renderStoryItem).join('');
      container.insertBefore(batch, sentinel);
      refreshIcons(batch);
      if (page.nextOffset === null) {
        finished = true;
        observer.disconnect(); storyObservers.delete(observer);
        sentinel.className = 'story-end';
        sentinel.textContent = `All ${number(page.total)} recorded items in this section are shown.`;
      } else {
        offset = page.nextOffset;
        sentinel.innerHTML = '<span class="spinner"></span><span>The story continues as you scroll...</span>';
      }
    } catch (error) {
      if (version !== storyVersion) return;
      observer.disconnect();
      sentinel.innerHTML = `<span class="story-error">${escapeHtml(error.message)}</span><button class="button" type="button">Retry loading</button>`;
      sentinel.querySelector('button').addEventListener('click', () => { observer.observe(sentinel); load(); }, { once: true });
    } finally { loading = false; }
    if (!finished && version === storyVersion && !sentinel.querySelector('button')) {
      requestAnimationFrame(() => {
        if (sentinel.getBoundingClientRect().top < $('#reader').getBoundingClientRect().bottom + 1000) load();
      });
    }
  }
  observer.observe(sentinel);
  load();
}
function renderSessionStory() {
  if (!state.session) return;
  stopStory(); records.clear();
  enterSession();
  state.detail = null; state.selected = state.session.overview.id;
  $('.rail-button.active')?.classList.remove('active');
  $('#story-button').classList.add('active');
  $('#breadcrumb').innerHTML = 'Sessions <span>/</span> Full session story';
  $('#reader').innerHTML = `<article class="reader-inner story-reader"><div class="session-eyebrow"><span class="line"></span> THE COMPLETE CONVERSATION</div><div class="hero"><h1>${escapeHtml(state.session.title)}</h1><p>Read it as it unfolded. Every prompt, reply, saved thought, summary, and tool activity, together in one continuous story.</p></div><div class="session-meta">${badge(`${state.session.stats.prompts} prompts`, 'messages-square', true)}${badge('Chronological reading', 'book-open')}<span>More appears automatically as you scroll.</span></div>${warningsHtml(state.session.warnings)}<div id="session-story" class="story-stream"></div></article>`;
  $('#reader').scrollTop = 0;
  renderTree(); refreshIcons($('#reader'));
  mountStory($('#session-story'), `/api/sessions/${state.session.id}/story`, storyVersion);
}

function moveSelection(direction) {
  if (!state.visible.length) return;
  const index = state.visible.indexOf(state.selected);
  const next = index < 0 ? 0 : Math.max(0, Math.min(state.visible.length - 1, index + direction));
  selectNode(state.visible[next]);
}
const termPattern = (terms) => new RegExp(terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi');
function highlightSnippet(text, terms) {
  const pattern = termPattern(terms);
  let html = '';
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    html += `${escapeHtml(text.slice(last, match.index))}<mark>${escapeHtml(match[0])}</mark>`;
    last = match.index + match[0].length;
  }
  return html + escapeHtml(text.slice(last));
}
function markTerms(root, terms) {
  if (!root || !terms?.length) return null;
  const pattern = termPattern(terms);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => node.parentElement.closest('mark, script, style, button') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
  });
  const targets = [];
  while (walker.nextNode() && targets.length < 500) { pattern.lastIndex = 0; if (pattern.test(walker.currentNode.nodeValue)) targets.push(walker.currentNode); }
  for (const node of targets) {
    const fragment = document.createDocumentFragment();
    const text = node.nodeValue;
    let last = 0;
    for (const match of text.matchAll(pattern)) {
      fragment.append(text.slice(last, match.index));
      const mark = document.createElement('mark');
      mark.className = 'search-hit';
      mark.textContent = match[0];
      fragment.append(mark);
      last = match.index + match[0].length;
    }
    fragment.append(text.slice(last));
    node.replaceWith(fragment);
  }
  return root.querySelector('mark.search-hit');
}
async function runGlobalSearch(query, scope = $('#search-scope').value) {
  query = query.trim();
  if (!query) return;
  const sequence = ++state.globalSequence;
  const sessionId = scope === 'session' && state.session ? state.session.id : '';
  stopStory();
  state.view = 'results';
  $('.rail-button.active')?.classList.remove('active');
  $('#global-search-button').classList.add('active');
  $('#breadcrumb').innerHTML = `Search <span>/</span> ${escapeHtml(sessionId ? state.session.title : 'All sessions')}`;
  $('#reader').innerHTML = '<div class="loading-state"><span class="spinner"></span> Searching your conversations...</div>';
  try {
    const result = await api(`/api/search?q=${encodeURIComponent(query)}${sessionId ? `&session=${sessionId}` : ''}`);
    if (sequence !== state.globalSequence) return;
    state.results = { ...result, query, scope, sessionId };
    renderResults();
  } catch (error) {
    if (sequence === state.globalSequence) $('#reader').innerHTML = `<div class="empty-state">${icon('triangle-alert')} ${escapeHtml(error.message)}</div>`;
    refreshIcons($('#reader'));
  }
}
function renderResults() {
  const { results, total, truncated, terms = [], query, sessionId, counts, pending } = state.results;
  stopStory();
  state.view = 'results';
  state.selected = null;
  $('.rail-button.active')?.classList.remove('active');
  $('#global-search-button').classList.add('active');
  $('#breadcrumb').innerHTML = `Search <span>/</span> ${escapeHtml(sessionId ? (state.library.find((item) => item.id === sessionId)?.title || 'This session') : 'All sessions')}`;
  const groups = new Map();
  for (const hit of results) {
    if (!groups.has(hit.sessionId)) groups.set(hit.sessionId, []);
    groups.get(hit.sessionId).push(hit);
  }
  $('#reader').innerHTML = `<article class="reader-inner results-page">
    <div class="session-eyebrow"><span class="line"></span> SEARCH ${sessionId ? 'THIS SESSION' : 'EVERY SESSION'}</div>
    <div class="results-hero"><h1>“${escapeHtml(query)}”</h1><p>${total ? `${number(total)} ${total === 1 ? 'match' : 'matches'} in ${number(Object.keys(counts).length)} ${Object.keys(counts).length === 1 ? 'session' : 'sessions'}${truncated ? ` · showing the first ${number(results.length)}` : ''}` : 'No matches found. Try fewer or different words.'}</p>
    ${pending ? `<div class="footnote">${icon('loader')}${number(pending)} ${pending === 1 ? 'session is' : 'sessions are'} still being indexed; search again shortly for complete results.</div>` : ''}</div>
    ${[...groups].map(([id, hits]) => `<section class="result-group"><div class="result-session">${icon('messages-square')}<span class="result-session-title">${escapeHtml(hits[0].sessionTitle)}</span><span class="muted">${escapeHtml(hits[0].workspaceName)}</span><span class="node-count">${number(counts[id])}</span></div>
      ${hits.map((hit) => `<button class="result-row" data-result-session="${hit.sessionId}" data-result-node="${hit.nodeId}" data-result-prompt="${hit.promptIndex}">${icon(icons[hit.kind] || 'activity', 'result-icon')}<span class="result-kind">${escapeHtml(kindLabels[hit.kind] || humanize(hit.kind))}${hit.promptIndex ? ` · P${String(hit.promptIndex).padStart(2, '0')}` : ''}</span><span class="result-snippet">${highlightSnippet(hit.snippet, terms)}</span>${icon('arrow-up-right', 'result-go')}</button>`).join('')}
    </section>`).join('')}
  </article>`;
  $('#reader').scrollTop = 0;
  refreshIcons($('#reader'));
}
async function openResult(sessionId, nodeId, promptIndex) {
  state.highlight = { nodeId, terms: state.results?.terms || [] };
  if (state.session?.id !== sessionId || state.mode !== 'session') {
    if (!(await loadSession(sessionId, { render: false }))) return;
  }
  const target = state.nodes.has(nodeId) ? nodeId : state.session.requests[(promptIndex || 1) - 1]?.id;
  if (!target) { renderOverview(); toast('That item is no longer in this session.'); return; }
  state.highlight.nodeId = target;
  await selectNode(target);
  $('#tree-scroll').querySelector(`[data-node="${target}"]`)?.scrollIntoView({ block: 'center' });
}
function openDialog() {
  if ($('#open-agent-dialog')?.open) $('#open-agent-dialog').close();
  $('#import-error').textContent = '';
  if (!$('#path-input').value.trim() && state.defaultPaths.vscodeStorage) {
    $('#path-input').value = state.defaultPaths.vscodeStorage;
  }
  if (!$('#open-dialog').open) $('#open-dialog').showModal();
  $('#path-input').focus();
  $('#path-input').select();
}
function openAgentDialog() {
  if ($('#open-dialog')?.open) $('#open-dialog').close();
  $('#agent-import-error').textContent = '';
  if (!$('#agent-path-input').value.trim() && state.defaultPaths.agentSessions) {
    $('#agent-path-input').value = state.defaultPaths.agentSessions;
  }
  if (!$('#open-agent-dialog').open) $('#open-agent-dialog').showModal();
  $('#agent-path-input').focus();
  $('#agent-path-input').select();
}
document.addEventListener('click', async (event) => {
  const target = event.target.closest('button, [data-node], [data-toggle]');
  if (!target) return;
  const toggle = event.target.closest('[data-toggle]');
  if (toggle) {
    const id = toggle.dataset.toggle;
    state.expanded.has(id) ? state.expanded.delete(id) : state.expanded.add(id);
    renderTree();
    return;
  }
  if (target.dataset.session) { await loadSession(target.dataset.session); return; }
  if (target.dataset.workspace !== undefined) {
    const name = target.dataset.workspace;
    state.collapsedWorkspaces.has(name) ? state.collapsedWorkspaces.delete(name) : state.collapsedWorkspaces.add(name);
    renderLibraryTree();
    return;
  }
  if (target.dataset.resultSession) { await openResult(target.dataset.resultSession, target.dataset.resultNode, Number(target.dataset.resultPrompt)); return; }
  if (target.hasAttribute('data-back-results') && state.results) { renderResults(); return; }
  if (target.hasAttribute('data-library')) { showLibrary(); return; }
  if (target.dataset.select || target.dataset.node) {
    await selectNode(target.dataset.select || target.dataset.node);
    return;
  }
  if (target.dataset.close) { document.getElementById(target.dataset.close).close(); return; }
  if (target.hasAttribute('data-open')) { openDialog(); return; }
  if (target.hasAttribute('data-open-agent')) { openAgentDialog(); return; }
  if (target.dataset.sortToggle) {
    const kind = target.dataset.sortToggle;
    if (kind === 'date') setSortOrder(state.sortBy === 'date-desc' ? 'date-asc' : 'date-desc');
    else if (kind === 'name') setSortOrder(state.sortBy === 'name-asc' ? 'name-desc' : 'name-asc');
    return;
  }
  if (target.hasAttribute('data-read-story')) { renderSessionStory(); return; }
  if (target.dataset.tab) { state.tab = target.dataset.tab; renderDetail(); return; }
  if (target.hasAttribute('data-copy-code')) {
    try { await navigator.clipboard.writeText(target.closest('.code-block').querySelector('code').textContent); toast('Code copied to clipboard'); }
    catch (error) { toast(`Could not copy: ${error.message}`); }
    return;
  }
  if (target.id === 'copy-item' && state.detail) {
    const item = state.detail;
    const content = state.tab === 'raw' ? JSON.stringify(item.raw, null, 2) : ['before', 'after'].includes(state.tab) ? item[state.tab] : item.text || JSON.stringify(item.raw, null, 2);
    try { await navigator.clipboard.writeText(content); toast('Item copied to clipboard'); }
    catch (error) { toast(`Could not copy: ${error.message}`); }
  }
  if (target.id === 'browse-prompts' && state.session.requests[0]) selectNode(state.session.requests[0].id);
});
document.addEventListener('toggle', (event) => {
  const details = event.target;
  if (details instanceof HTMLDetailsElement && details.open && details.dataset.storyGroup && !details.dataset.loaded) {
    details.dataset.loaded = 'true';
    mountStory(details.querySelector('.story-stream'), `/api/sessions/${state.session.id}/story?parent=${details.dataset.storyGroup}`, storyVersion);
    return;
  }
  if (!(details instanceof HTMLDetailsElement) || !details.open || !details.dataset.record || details.dataset.loaded) return;
  details.dataset.loaded = 'true';
  details.querySelector('div').innerHTML = renderRecord(records.get(details.dataset.record));
}, true);
$('#back-to-library').addEventListener('click', showLibrary);
$('#library-button').addEventListener('click', async () => { await refreshLibrary().catch(() => {}); showLibrary(); });
$('#global-search-button').addEventListener('click', () => { if (state.results) renderResults(); $('#global-search').focus(); $('#global-search').select(); });
$('#global-search-form').addEventListener('submit', (event) => { event.preventDefault(); runGlobalSearch($('#global-search').value); });
$('#search-scope').addEventListener('change', () => { if ($('#global-search').value.trim()) runGlobalSearch($('#global-search').value); });
$('#filters').addEventListener('click', (event) => {
  const button = event.target.closest('[data-filter]');
  if (!button) return;
  state.filter = button.dataset.filter;
  document.querySelectorAll('.filter').forEach((filter) => filter.classList.toggle('active', filter === button));
  renderTree();
});
$('#search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  const sequence = ++state.searchSequence;
  const value = $('#search').value.trim();
  if (state.mode === 'library') { state.libraryFilter = value; renderLibraryTree(); if (state.view === 'library') renderLibraryPage(); return; }
  state.query = value;
  if (!value) { state.matches.clear(); renderTree(); if (state.session) $('#tree-status').textContent = `${number(state.nodes.size)} recorded items`; return; }
  searchTimer = setTimeout(async () => {
    if (!state.session) return;
    const id = state.session.id;
    try {
      const result = await api(`/api/sessions/${id}/search?q=${encodeURIComponent(value)}`);
      if (sequence !== state.searchSequence || id !== state.session.id) return;
      state.matches = new Set(result.ids);
      renderTree();
      $('#tree-status').textContent = `${number(result.ids.length)} matching items`;
    } catch (error) { toast(error.message); }
  }, 200);
});
$('#tree-scroll').addEventListener('keydown', (event) => {
  const row = event.target.closest('[data-node]');
  if (!row) return;
  const item = state.nodes.get(row.dataset.node);
  const rows = [...$('#tree-scroll').querySelectorAll('[data-node]')];
  const index = rows.indexOf(row);
  let next;
  if (event.key === 'ArrowDown') next = rows[Math.min(index + 1, rows.length - 1)];
  if (event.key === 'ArrowUp') next = rows[Math.max(index - 1, 0)];
  if (event.key === 'Home') next = rows[0];
  if (event.key === 'End') next = rows.at(-1);
  if (event.key === 'ArrowRight' && item.children.length) { state.expanded.add(item.id); renderTree(); next = $('#tree-scroll').querySelector(`[data-node="${item.id}"]`); }
  if (event.key === 'ArrowLeft') {
    if (state.expanded.has(item.id)) { state.expanded.delete(item.id); renderTree(); next = $('#tree-scroll').querySelector(`[data-node="${item.id}"]`); }
    else next = $('#tree-scroll').querySelector(`[data-node="${state.parents.get(item.id)}"]`);
  }
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectNode(item.id); }
  if (next) { event.preventDefault(); next.focus(); next.scrollIntoView({ block: 'nearest' }); }
});
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'f') { event.preventDefault(); $('#global-search').focus(); $('#global-search').select(); return; }
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'o') { event.preventDefault(); openAgentDialog(); return; }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('#search').focus(); $('#search').select(); }
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'o') { event.preventDefault(); openDialog(); }
});
document.addEventListener('change', (event) => {
  if (event.target.id === 'sidebar-sort' || event.target.id === 'library-page-sort') {
    setSortOrder(event.target.value);
  }
});
$('#open-button').addEventListener('click', openDialog);
$('#open-agent-button').addEventListener('click', openAgentDialog);
$('#reset-vscode-default').addEventListener('click', () => {
  if (state.defaultPaths.vscodeStorage) $('#path-input').value = state.defaultPaths.vscodeStorage;
  $('#path-input').focus();
});
$('#reset-agent-default').addEventListener('click', () => {
  if (state.defaultPaths.agentSessions) $('#agent-path-input').value = state.defaultPaths.agentSessions;
  $('#agent-path-input').focus();
});
$('#help-button').addEventListener('click', () => $('#help-dialog').showModal());
$('#home-button').addEventListener('click', () => state.session && renderOverview());
$('#story-button').addEventListener('click', renderSessionStory);
$('#models-button').addEventListener('click', () => state.session && renderOverview(true));
$('#collapse-button').addEventListener('click', () => { state.expanded.clear(); renderTree(); });
$('#expand-button').addEventListener('click', () => { state.session?.requests.forEach((request) => state.expanded.add(request.id)); renderTree(); });
$('#previous-button').addEventListener('click', () => moveSelection(-1));
$('#next-button').addEventListener('click', () => moveSelection(1));
$('#export-button').addEventListener('click', () => {
  if (!state.session) { toast('Open a session first'); return; }
  const link = document.createElement('a');
  link.href = `/api/sessions/${state.session.id}/export`; link.download = `chat-${state.session.id}.json`; link.click();
});
$('#theme-button').addEventListener('click', () => { document.body.classList.toggle('light'); localStorage.setItem('chronicle-theme', document.body.classList.contains('light') ? 'light' : 'dark'); });
$('#open-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('#import-error').textContent = '';
  $('#import-submit').disabled = true;
  $('#import-submit').textContent = 'Scanning folder...';
  try {
    const result = await api('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: $('#path-input').value }) });
    $('#open-dialog').close();
    await loadLibrary(result.sessions.length === 1 ? result.sessions[0] : undefined);
    toast(`Found ${number(result.found)} session ${result.found === 1 ? 'file' : 'files'}${result.indexing ? ` · indexing ${number(result.indexing)} for search` : ''}. Sources unchanged.`);
  } catch (error) { $('#import-error').textContent = error.message; }
  finally { $('#import-submit').disabled = false; $('#import-submit').innerHTML = `Explore session ${icon('arrow-up-right')}`; refreshIcons($('#open-dialog')); }
});
$('#open-agent-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('#agent-import-error').textContent = '';
  $('#agent-import-submit').disabled = true;
  $('#agent-import-submit').textContent = 'Scanning agent sessions...';
  try {
    const result = await api('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: $('#agent-path-input').value }) });
    $('#open-agent-dialog').close();
    await loadLibrary(result.sessions.length === 1 ? result.sessions[0] : undefined);
    toast(`Found ${number(result.found)} agent session ${result.found === 1 ? 'file' : 'files'}${result.indexing ? ` · indexing ${number(result.indexing)} for search` : ''}. Sources unchanged.`);
  } catch (error) { $('#agent-import-error').textContent = error.message; }
  finally { $('#agent-import-submit').disabled = false; $('#agent-import-submit').innerHTML = `Explore agent sessions ${icon('arrow-up-right')}`; refreshIcons($('#open-agent-dialog')); }
});
const resizeHandle = $('#resize-handle');
function resizeSidebar(width) { document.documentElement.style.setProperty('--sidebar', `${Math.max(250, Math.min(650, width))}px`); }
resizeHandle.addEventListener('pointerdown', (event) => {
  resizeHandle.setPointerCapture(event.pointerId);
  const move = (pointer) => resizeSidebar(pointer.clientX - $('.rail').getBoundingClientRect().width);
  resizeHandle.addEventListener('pointermove', move);
  resizeHandle.addEventListener('pointerup', () => resizeHandle.removeEventListener('pointermove', move), { once: true });
});
resizeHandle.addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  resizeSidebar($('#sidebar').getBoundingClientRect().width + (event.key === 'ArrowRight' ? 20 : -20));
});
if (localStorage.getItem('chronicle-theme') === 'light') document.body.classList.add('light');
refreshIcons();
loadLibrary().catch((error) => {
  $('#reader').innerHTML = `<div class="empty-state">${icon('triangle-alert')}<h2>Could not open the library.</h2><p>${escapeHtml(error.message)}</p><button class="button primary" data-open>Open a session</button></div>`;
  $('#tree-scroll').innerHTML = '<div class="empty-state">Library unavailable.</div>';
  refreshIcons();
});
