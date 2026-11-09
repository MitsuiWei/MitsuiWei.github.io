import { createSync } from './sync.js?v=20261108d';

const $ = (selector) => document.querySelector(selector);
const storageKey = 'osaka-kyoto-shared-2026-v1';
const dayTabs = $('#day-tabs');
const content = $('#content');
const editor = $('#editor');
const form = $('#editor-form');
let data;
let view = 'days';
let activeDay = 0;
let search = '';
let editingId = null;
let sync = null;
let cloudReady = false;
let toastTimer;

const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"></use></svg>`;
const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
const safeUrl = (value) => { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } };
const mapsUrl = (query) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
const foodCategories = new Set(['早餐', '午餐', '晚餐', '甜點']);
const isTabelogUrl = (value) => { try { const url = new URL(value); return url.protocol === 'https:' && (url.hostname === 'tabelog.com' || url.hostname.endsWith('.tabelog.com')); } catch { return false; } };
const tabelogSearchUrl = (title, city) => { const query = `${title} ${city || ''}`.trim(); return `https://tabelog.com/rstLst/?${new URLSearchParams({ vs:'1', sa:city || '', sk:query, sw:query })}`; };
const dateLabel = (value) => new Intl.DateTimeFormat('zh-TW', { month:'numeric', day:'numeric', weekday:'short', timeZone:'Asia/Tokyo' }).format(new Date(`${value}T12:00:00+09:00`));
const fullDateLabel = (value) => new Intl.DateTimeFormat('zh-TW', { month:'long', day:'numeric', weekday:'long', timeZone:'Asia/Tokyo' }).format(new Date(`${value}T12:00:00+09:00`));

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

function save(change) {
  localStorage.setItem(storageKey, JSON.stringify(data));
  render();
  setSyncStatus('儲存中');
  sync.apply(change).then(() => setSyncStatus('即時同步中')).catch(async error => {
    setSyncStatus('同步失敗');
    toast(`雲端儲存失敗：${error.message}`);
    try { await sync.refresh(); } catch (refreshError) { console.error(refreshError); }
  });
}

function canEdit() {
  if (cloudReady && sync) return true;
  toast('請等候共用行程連線');
  return false;
}

function setSyncStatus(label) {
  $('#sync-label').textContent = label;
  $('#sync-button').setAttribute('aria-label', `同步狀態：${label}。點擊查看設定`);
  if (view === 'settings') renderContent();
}

function findItem(id) {
  for (const day of data.days) {
    const index = day.items.findIndex(item => item.id === id);
    if (index !== -1) return { day, index, item: day.items[index] };
  }
  return null;
}

function renderTabs() {
  dayTabs.hidden = view !== 'days' || Boolean(search);
  if (dayTabs.hidden) return;
  dayTabs.innerHTML = data.days.map((day, index) => `<button class="day-tab ${index === activeDay ? 'active' : ''}" type="button" data-day="${index}" aria-current="${index === activeDay ? 'date' : 'false'}"><strong>${escapeHtml(dateLabel(day.date))}</strong><small>DAY ${index + 1}</small></button>`).join('');
  const selected = dayTabs.querySelector('.active');
  selected?.scrollIntoView({ block:'nearest', inline:'nearest' });
}

function entryHtml(item, city = '') {
  const map = item.mapQuery?.trim();
  const links = Array.isArray(item.links) ? item.links : [];
  const directTabelog = isTabelogUrl(item.tabelogUrl) ? item.tabelogUrl : '';
  const tabelog = directTabelog || (foodCategories.has(item.category) ? tabelogSearchUrl(item.title, city || (map?.includes('京都') ? '京都' : '大阪')) : '');
  const tabelogLink = tabelog ? `<a class="tabelog" href="${escapeHtml(tabelog)}" target="_blank" rel="noopener noreferrer" aria-label="${directTabelog ? '在食べログ開啟' : '在食べログ搜尋'} ${escapeHtml(item.title)}" title="${directTabelog ? '食べログ店家頁面' : '食べログ搜尋結果'}"><span class="tabelog-mark" aria-hidden="true">食</span></a>` : '';
  const title = map ? `<a class="entry-title map-title" href="${escapeHtml(mapsUrl(map))}" target="_blank" rel="noopener noreferrer" aria-label="在 Google Maps 開啟 ${escapeHtml(item.title)}">${escapeHtml(item.title)}</a>` : `<span class="entry-title">${escapeHtml(item.title)}</span>`;
  return `<article class="entry ${item.done ? 'done' : ''}">
    <div class="entry-marker"><button class="done-toggle" data-done="${escapeHtml(item.id)}" type="button" aria-label="${item.done ? '標記未完成' : '標記完成'}：${escapeHtml(item.title)}" aria-pressed="${Boolean(item.done)}">${icon('check')}</button></div>
    <div class="entry-main"><div class="entry-topline"><span class="category">${escapeHtml(item.category || '景點')}</span>${item.favorite ? '<span class="favorite-mark" aria-label="收藏">★</span>' : ''}</div>${title}${item.note ? `<p class="entry-note">${escapeHtml(item.note)}</p>` : ''}</div>
    <div class="entry-actions">${map ? `<a href="${escapeHtml(mapsUrl(map))}" target="_blank" rel="noopener noreferrer" aria-label="Google Maps：${escapeHtml(item.title)}">${icon('map')}</a>` : ''}${tabelogLink}${links.map((link, n) => { const url = safeUrl(link.url); const isInstagram = url.includes('instagram.com/'); return url ? `<a class="${isInstagram ? 'instagram' : 'reference'}" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" aria-label="開啟 ${escapeHtml(item.title)} 的參考連結 ${n + 1}" title="${escapeHtml(link.text || '參考連結')}">${icon(isInstagram ? 'instagram' : 'link')}</a>` : ''; }).join('')}<button data-edit="${escapeHtml(item.id)}" type="button" aria-label="編輯 ${escapeHtml(item.title)}">${icon('edit')}</button></div>
  </article>`;
}

function sectionsHtml(items, city = '') {
  if (!items.length) return '<div class="empty-state"><strong>這裡還沒有行程</strong><p>點選「新增行程」開始安排。</p></div>';
  const groups = [];
  for (const item of items) {
    const title = item.section || '行程';
    let group = groups.find(g => g.title === title);
    if (!group) { group = { title, items: [] }; groups.push(group); }
    group.items.push(item);
  }
  return groups.map(group => `<section class="section"><h4 class="section-title">${escapeHtml(group.title)}</h4><div class="entry-list">${group.items.map(item => entryHtml(item, item.city || city)).join('')}</div></section>`).join('');
}

function renderContent() {
  const heading = $('#view-heading');
  const count = $('#view-count');
  if (search) {
    const results = data.days.flatMap(day => day.items.map(item => ({ ...item, city:day.city, section: `${dateLabel(day.date)} · ${item.section || day.title}` }))).filter(item => `${item.title} ${item.note} ${item.section}`.toLocaleLowerCase().includes(search));
    heading.textContent = '搜尋結果'; count.textContent = `${results.length} 個項目`;
    content.innerHTML = results.length ? sectionsHtml(results) : '<div class="empty-state"><strong>找不到符合的行程</strong><p>試試地點、餐廳或備註中的其他字詞。</p></div>';
    return;
  }
  if (view === 'days') {
    const day = data.days[activeDay];
    heading.textContent = '每日行程'; count.textContent = `${day.items.length} 個項目`;
    content.innerHTML = `<div class="day-intro"><div><span class="day-date">${escapeHtml(fullDateLabel(day.date))} · DAY ${activeDay + 1}</span><h3>${escapeHtml(day.title)}</h3></div><span class="city">${escapeHtml(day.city)}</span></div>${sectionsHtml(day.items, day.city)}`;
  } else if (view === 'favorites') {
    const favorites = data.days.flatMap(day => day.items.filter(item => item.favorite).map(item => ({ ...item, city:day.city, section: `${dateLabel(day.date)} · ${item.section || day.title}` })));
    heading.textContent = '收藏地點'; count.textContent = `${favorites.length} 個項目`;
    content.innerHTML = favorites.length ? sectionsHtml(favorites) : '<div class="empty-state"><strong>還沒有收藏地點</strong><p>編輯行程時可將項目加入收藏。</p></div>';
  } else if (view === 'lists') {
    heading.textContent = '購物與參考清單'; count.textContent = `${data.checklist.length} 份清單`;
    content.innerHTML = `<div class="list-group"><h3>出發前與旅途中</h3>${data.checklist.map(item => `<div class="checklist-item"><span>${escapeHtml(item.title)}</span><div class="link-row">${(item.links || []).map((link,n) => { const url = safeUrl(link.url); return url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" aria-label="開啟 ${escapeHtml(item.title)} 參考連結 ${n + 1}">${icon(url.includes('instagram.com/') ? 'instagram' : 'link')}</a>` : ''; }).join('')}</div></div>`).join('')}</div>`;
  } else {
    heading.textContent = '共用與備份'; count.textContent = '';
    content.innerHTML = `<div class="settings-panel"><h3>大家共用同一份行程</h3><p>不需登入。任何人新增、編輯或勾選項目後，所有開著網站的人都會即時看到更新。</p><span class="status">${icon('cloud')}${escapeHtml($('#sync-label').textContent)}</span><div class="settings-actions"><button id="export-data" type="button">下載行程備份</button><label>匯入行程備份<input id="import-data" type="file" accept="application/json,.json"></label></div><p class="settings-hint">餐飲項目的橘色「食」按鈕可開啟食べログ；未指定店家的項目會顯示搜尋結果。匯入備份會取代所有人目前看到的共用行程。</p></div>`;
  }
}

function render() {
  renderTabs();
  renderContent();
  $('#add-button').hidden = view === 'lists' || view === 'settings';
  document.querySelectorAll('.bottom-nav button').forEach(button => button.classList.toggle('active', button.dataset.view === view));
}

function openEditor(id = null) {
  if (!canEdit()) return;
  editingId = id;
  const found = id ? findItem(id) : null;
  const item = found?.item;
  form.reset();
  form.elements.day.innerHTML = data.days.map((day, index) => `<option value="${index}">${escapeHtml(dateLabel(day.date))} · ${escapeHtml(day.title)}</option>`).join('');
  form.elements.day.value = found ? String(data.days.indexOf(found.day)) : String(activeDay);
  form.elements.title.value = item?.title || '';
  form.elements.category.value = item?.category || '景點';
  form.elements.section.value = item?.section || (data.days[activeDay].items.at(-1)?.section || '行程');
  form.elements.mapQuery.value = item?.mapQuery || '';
  form.elements.igUrl.value = item?.links?.[0]?.url || '';
  form.elements.tabelogUrl.value = item?.tabelogUrl || '';
  form.elements.note.value = item?.note || '';
  form.elements.favorite.checked = Boolean(item?.favorite);
  $('#editor-title').textContent = id ? '編輯行程' : '新增行程';
  $('#delete-button').hidden = !id;
  $('#move-up').hidden = !id;
  $('#move-down').hidden = !id;
  editor.showModal();
  form.elements.title.focus();
}

form.addEventListener('submit', event => {
  event.preventDefault();
  if (!canEdit()) return;
  if (!form.reportValidity()) return;
  const targetDay = data.days[Number(form.elements.day.value)];
  const existing = editingId ? findItem(editingId) : null;
  const oldLinks = existing?.item.links || [];
  const igUrl = safeUrl(form.elements.igUrl.value.trim());
  if (form.elements.igUrl.value.trim() && !igUrl) { toast('請輸入有效的 https 連結'); return; }
  const tabelogUrl = form.elements.tabelogUrl.value.trim();
  if (tabelogUrl && !isTabelogUrl(tabelogUrl)) { toast('請輸入 https://tabelog.com 的店家網址'); return; }
  const item = {
    id: existing?.item.id || `custom-${crypto.randomUUID()}`,
    title: form.elements.title.value.trim(),
    category: form.elements.category.value,
    section: form.elements.section.value.trim() || '行程',
    mapQuery: form.elements.mapQuery.value.trim(),
    tabelogUrl,
    links: igUrl ? [{ text:'自訂參考連結', url:igUrl }, ...oldLinks.filter(link => link.url !== existing?.item.links?.[0]?.url)] : oldLinks.slice(1),
    note: form.elements.note.value.trim(),
    favorite: form.elements.favorite.checked,
    done: existing?.item.done || false,
  };
  if (existing) existing.day.items.splice(existing.index, 1);
  if (existing && existing.day === targetDay) targetDay.items.splice(existing.index, 0, item);
  else targetDay.items.push(item);
  activeDay = data.days.indexOf(targetDay);
  view = 'days'; search = ''; $('#search').value = '';
  editor.close(); save({ type:'upsert', item, day:activeDay }); toast(existing ? '行程已更新' : '行程已新增');
});

$('#delete-button').addEventListener('click', () => {
  if (!canEdit()) return;
  const found = findItem(editingId);
  if (!found || !confirm(`確定刪除「${found.item.title}」？`)) return;
  found.day.items.splice(found.index, 1);
  editor.close(); save({ type:'delete', id:editingId }); toast('行程已刪除');
});

function moveItem(direction) {
  if (!canEdit()) return;
  const found = findItem(editingId);
  if (!found) return;
  const next = found.index + direction;
  if (next < 0 || next >= found.day.items.length) { toast('已在這天行程的最前或最後'); return; }
  [found.day.items[found.index], found.day.items[next]] = [found.day.items[next], found.day.items[found.index]];
  editor.close(); save({ type:'move', id:editingId, direction }); toast('順序已調整');
}
$('#move-up').addEventListener('click', () => moveItem(-1));
$('#move-down').addEventListener('click', () => moveItem(1));
document.querySelector('[data-close]').addEventListener('click', () => editor.close());
editor.addEventListener('click', event => { if (event.target === editor) editor.close(); });
$('#add-button').addEventListener('click', () => openEditor());
$('#sync-button').addEventListener('click', () => { view = 'settings'; search = ''; $('#search').value = ''; render(); });
dayTabs.addEventListener('click', event => { const button = event.target.closest('[data-day]'); if (!button) return; activeDay = Number(button.dataset.day); render(); });
document.querySelector('.bottom-nav').addEventListener('click', event => { const button = event.target.closest('[data-view]'); if (!button) return; view = button.dataset.view; search = ''; $('#search').value = ''; render(); window.scrollTo({ top:0, behavior:'smooth' }); });
$('#search').addEventListener('input', event => { search = event.target.value.trim().toLocaleLowerCase(); render(); });
content.addEventListener('click', async event => {
  const done = event.target.closest('[data-done]');
  if (done) { if (!canEdit()) return; const found = findItem(done.dataset.done); if (found) { found.item.done = !found.item.done; save({ type:'setDone', id:found.item.id, done:found.item.done }); } return; }
  const edit = event.target.closest('[data-edit]');
  if (edit) { openEditor(edit.dataset.edit); return; }
  if (event.target.closest('#export-data')) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'osaka-kyoto-2026-itinerary.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('備份已下載');
  }
});
content.addEventListener('change', async event => {
  if (event.target.id !== 'import-data') return;
  if (!canEdit()) return;
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const imported = JSON.parse(await file.text());
    if (!Array.isArray(imported.days) || imported.days.length !== 8 || !imported.days.every(day => Array.isArray(day.items))) throw new Error('檔案格式不正確');
    if (!confirm('匯入備份會取代所有人目前看到的共用行程，確定繼續？')) return;
    data = imported; save({ type:'replace', data:imported }); toast('行程已匯入');
  } catch (error) { toast(`無法匯入：${error.message}`); }
});

async function init() {
  const response = await fetch('./itinerary.json?v=20261109a');
  if (!response.ok) throw new Error('行程資料載入失敗');
  const initial = await response.json();
  data = initial;
  render();
  setSyncStatus('連線中');
  try {
    sync = await createSync({
      initial,
      onRemote: remote => { data = remote; localStorage.setItem(storageKey, JSON.stringify(data)); render(); },
      onReady: ready => { cloudReady = ready; if (ready) render(); },
      onStatus: status => setSyncStatus(status),
    });
    render();
  } catch (error) { setSyncStatus('同步無法使用'); console.error(error); }
}
init().catch(error => { content.innerHTML = `<div class="empty-state"><strong>行程無法載入</strong><p>${escapeHtml(error.message)}。請重新整理頁面。</p></div>`; });

