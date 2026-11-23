import { createSync, applyChange } from './sync.js?v=20261123a';

const $ = (selector) => document.querySelector(selector);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));
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
let dayGroups = [];        // groups shown in the current day view, indexed by data-section-index
let sectionEdit = null;    // index of the group whose title is being edited
let press = null;          // pending long-press
let drag = null;           // active drag inside one group
let pendingRemote = false; // a cloud update arrived while editing or dragging
let suppressClick = false;
let listEdit = null;       // id of the list whose title is being edited
let editingListItem = null;// { listId, itemId } open in the list editor
let pendingImage = null;   // { dataUrl, width, height } | 'remove' | null
let initListsRequested = false;
const imageCache = new Map();
const listEditor = $('#list-editor');
const listForm = $('#list-form');
const photoViewer = $('#photo-viewer');

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
  return `<article class="entry ${item.done ? 'done' : ''}" data-id="${escapeHtml(item.id)}">
    <div class="entry-marker"><button class="done-toggle" data-done="${escapeHtml(item.id)}" type="button" aria-label="${item.done ? '標記未完成' : '標記完成'}：${escapeHtml(item.title)}" aria-pressed="${Boolean(item.done)}">${icon('check')}</button></div>
    <div class="entry-main"><div class="entry-topline"><span class="category">${escapeHtml(item.category || '景點')}</span>${item.favorite ? '<span class="favorite-mark" aria-label="收藏">★</span>' : ''}</div>${title}${item.note ? `<p class="entry-note">${escapeHtml(item.note)}</p>` : ''}</div>
    <div class="entry-actions">${map ? `<a href="${escapeHtml(mapsUrl(map))}" target="_blank" rel="noopener noreferrer" aria-label="Google Maps：${escapeHtml(item.title)}">${icon('map')}</a>` : ''}${tabelogLink}${links.map((link, n) => { const url = safeUrl(link.url); const isInstagram = url.includes('instagram.com/'); return url ? `<a class="${isInstagram ? 'instagram' : 'reference'}" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" aria-label="開啟 ${escapeHtml(item.title)} 的參考連結 ${n + 1}" title="${escapeHtml(link.text || '參考連結')}">${icon(isInstagram ? 'instagram' : 'link')}</a>` : ''; }).join('')}<button data-edit="${escapeHtml(item.id)}" type="button" aria-label="編輯 ${escapeHtml(item.title)}">${icon('edit')}</button></div>
  </article>`;
}

function groupItems(items) {
  const groups = [];
  for (const item of items) {
    const title = item.section || '行程';
    let group = groups.find(g => g.title === title);
    if (!group) { group = { title, items: [] }; groups.push(group); }
    group.items.push(item);
  }
  return groups;
}

// editable: day view only. Titles can be renamed and cards dragged within their group.
function sectionsHtml(items, city = '', editable = false) {
  if (!items.length) return '<div class="empty-state"><strong>這裡還沒有行程</strong><p>點選「新增行程」開始安排。</p></div>';
  const groups = groupItems(items);
  if (editable) dayGroups = groups;
  return groups.map((group, index) => {
    const title = editable
      ? `<h4 class="section-title editable" data-section-title="${index}"><span class="section-name">${escapeHtml(group.title)}</span><button class="section-edit" type="button" data-section-edit="${index}" aria-label="編輯小標題：${escapeHtml(group.title)}">${icon('edit')}</button></h4>`
      : `<h4 class="section-title">${escapeHtml(group.title)}</h4>`;
    return `<section class="section">${title}<div class="entry-list"${editable ? ` data-section-index="${index}"` : ''}>${group.items.map(item => entryHtml(item, item.city || city)).join('')}</div></section>`;
  }).join('');
}

function renderContent() {
  sectionEdit = null;
  listEdit = null;
  dayGroups = [];
  pendingRemote = false;
  cancelPress();
  if (drag) { cancelAnimationFrame(drag.frame); document.body.classList.remove('is-dragging'); drag = null; }
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
    content.innerHTML = `<div class="day-intro"><div><span class="day-date">${escapeHtml(fullDateLabel(day.date))} · DAY ${activeDay + 1}</span><h3>${escapeHtml(day.title)}</h3></div><span class="city">${escapeHtml(day.city)}</span></div>${sectionsHtml(day.items, day.city, true)}`;
  } else if (view === 'favorites') {
    const favorites = data.days.flatMap(day => day.items.filter(item => item.favorite).map(item => ({ ...item, city:day.city, section: `${dateLabel(day.date)} · ${item.section || day.title}` })));
    heading.textContent = '收藏地點'; count.textContent = `${favorites.length} 個項目`;
    content.innerHTML = favorites.length ? sectionsHtml(favorites) : '<div class="empty-state"><strong>還沒有收藏地點</strong><p>編輯行程時可將項目加入收藏。</p></div>';
  } else if (view === 'lists') {
    heading.textContent = '清單';
    if (!Array.isArray(data.lists)) {
      count.textContent = '';
      content.innerHTML = '<div class="empty-state"><strong>清單準備中</strong><p>連上共用行程後會自動建立。</p></div>';
      if (cloudReady && sync && !initListsRequested) {
        initListsRequested = true;
        queueMicrotask(() => { const change = { type:'initLists' }; data = applyChange(data, change); save(change); });
      }
      return;
    }
    count.textContent = `${data.lists.length} 份清單`;
    content.innerHTML = `${data.lists.map(listHtml).join('')}<form class="new-list-form"><input name="listName" maxlength="50" required placeholder="新清單名稱，例如：藥妝" aria-label="新清單名稱"><button type="submit">${icon('plus')}新增清單</button></form>`;
    hydrateImages();
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
    id: existing?.item.id || `custom-${uid()}`,
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

// ---------- Lists: many lists, each with items (text, location, one photo, checkbox) ----------

const linkIcons = (links, label) => (Array.isArray(links) ? links : []).map((link, n) => { const url = safeUrl(link.url); const isInstagram = url.includes('instagram.com/'); return url ? `<a class="${isInstagram ? 'instagram' : 'reference'}" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" aria-label="開啟 ${escapeHtml(label)} 的參考連結 ${n + 1}" title="${escapeHtml(link.text || '參考連結')}">${icon(isInstagram ? 'instagram' : 'link')}</a>` : ''; }).join('');

function listItemHtml(item) {
  const map = item.mapQuery?.trim();
  const label = item.title || item.note || '項目';
  const title = item.title ? (map ? `<a class="entry-title map-title" href="${escapeHtml(mapsUrl(map))}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a>` : `<span class="entry-title">${escapeHtml(item.title)}</span>`) : '';
  const thumb = item.imageId ? `<button class="thumb" type="button" data-photo="${escapeHtml(item.imageId)}" aria-label="放大照片：${escapeHtml(label)}"><img data-image-id="${escapeHtml(item.imageId)}" alt=""></button>` : '';
  return `<article class="entry list-entry ${item.done ? 'done' : ''} ${thumb ? 'has-thumb' : ''}" data-item-id="${escapeHtml(item.id)}">
    <div class="entry-marker"><button class="done-toggle" data-list-done="${escapeHtml(item.id)}" type="button" aria-label="${item.done ? '取消打勾' : '打勾'}：${escapeHtml(label)}" aria-pressed="${Boolean(item.done)}">${icon('check')}</button></div>
    ${thumb}
    <div class="entry-main">${title}${item.note ? `<p class="entry-note">${escapeHtml(item.note)}</p>` : ''}</div>
    <div class="entry-actions">${map ? `<a href="${escapeHtml(mapsUrl(map))}" target="_blank" rel="noopener noreferrer" aria-label="Google Maps：${escapeHtml(label)}">${icon('map')}</a>` : ''}${linkIcons(item.links, label)}<button data-list-item-edit="${escapeHtml(item.id)}" type="button" aria-label="編輯 ${escapeHtml(label)}">${icon('edit')}</button></div>
  </article>`;
}

function listHtml(list) {
  const doneCount = list.items.filter(item => item.done).length;
  const countText = list.items.length ? `${doneCount}/${list.items.length}` : '';
  return `<section class="list-block" data-list-id="${escapeHtml(list.id)}">
    <div class="list-head"><h3 class="list-title" data-list-title="${escapeHtml(list.id)}"><span class="list-name">${escapeHtml(list.title)}</span>${countText ? `<span class="list-count">${countText}</span>` : ''}<button class="section-edit" type="button" data-list-edit="${escapeHtml(list.id)}" aria-label="編輯清單名稱：${escapeHtml(list.title)}">${icon('edit')}</button></h3><div class="entry-actions">${linkIcons(list.links, list.title)}</div></div>
    <div class="entry-list list-items">${list.items.length ? list.items.map(listItemHtml).join('') : '<p class="list-empty">還沒有項目</p>'}</div>
    <button class="list-add" type="button" data-list-add="${escapeHtml(list.id)}">${icon('plus')}新增項目</button>
  </section>`;
}

function findListItem(itemId) {
  for (const list of data.lists || []) {
    const item = list.items.find(entry => entry.id === itemId);
    if (item) return { list, item };
  }
  return null;
}

function setImage(img, url) {
  if (url) { img.src = url; img.closest('.thumb')?.classList.remove('missing'); }
  else img.closest('.thumb')?.classList.add('missing');
}

function hydrateImages() {
  const ids = new Set([...content.querySelectorAll('img[data-image-id]')].map(img => img.dataset.imageId));
  for (const id of ids) {
    const apply = (url) => content.querySelectorAll(`img[data-image-id="${CSS.escape(id)}"]`).forEach(img => setImage(img, url));
    if (imageCache.has(id)) { apply(imageCache.get(id)); continue; }
    if (!sync) continue;
    sync.getImage(id).then(url => { imageCache.set(id, url); apply(url); }).catch(error => { console.error(error); apply(''); });
  }
}

function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('無法讀取這張照片')); };
    img.src = url;
  });
}

// Shrink a phone photo to a JPEG small enough to store (well under Firestore's 1 MB document limit).
async function compressImage(file) {
  const img = await loadImageFile(file);
  let maxSide = 1280;
  let quality = 0.8;
  for (let attempt = 0; attempt < 7; attempt++) {
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    canvas.getContext('2d').drawImage(img, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    if (dataUrl.length < 700000) return { dataUrl, width, height };
    maxSide = Math.round(maxSide * 0.8);
    quality = Math.max(0.5, quality - 0.07);
  }
  throw new Error('照片太大，請換一張');
}

function showPhotoPreview(url) {
  const preview = $('#photo-preview');
  preview.hidden = !url;
  preview.querySelector('img').src = url || '';
  $('#photo-pick-text').textContent = url ? '換一張照片' : '從相簿選擇照片';
}

function openListEditor(listId, itemId = null) {
  if (!canEdit()) return;
  const found = itemId ? findListItem(itemId) : null;
  const item = found?.item;
  editingListItem = { listId: found?.list.id || listId, itemId: item?.id || null };
  pendingImage = null;
  listForm.reset();
  listForm.elements.list.innerHTML = data.lists.map(list => `<option value="${escapeHtml(list.id)}">${escapeHtml(list.title)}</option>`).join('');
  listForm.elements.list.value = editingListItem.listId;
  listForm.elements.title.value = item?.title || '';
  listForm.elements.mapQuery.value = item?.mapQuery || '';
  listForm.elements.note.value = item?.note || '';
  $('#photo-input').value = '';
  showPhotoPreview(item?.imageId ? imageCache.get(item.imageId) || '' : '');
  if (item?.imageId && !imageCache.has(item.imageId)) sync.getImage(item.imageId).then(url => { imageCache.set(item.imageId, url); if (editingListItem?.itemId === item.id && !pendingImage) showPhotoPreview(url); }).catch(console.error);
  $('#list-editor-title').textContent = item ? '編輯項目' : '新增項目';
  $('#list-item-delete').hidden = !item;
  $('#list-save').disabled = false;
  $('#list-save').textContent = '儲存';
  showListError('');
  listEditor.showModal();
}

function showListError(message) {
  const box = $('#list-error');
  box.hidden = !message;
  box.querySelector('p').textContent = message;
}

$('#list-save-without-photo').addEventListener('click', () => {
  const existing = editingListItem?.itemId ? findListItem(editingListItem.itemId)?.item : null;
  pendingImage = existing?.imageId ? null : 'remove';
  showPhotoPreview(existing?.imageId ? imageCache.get(existing.imageId) || '' : '');
  showListError('');
  listForm.requestSubmit();
});

$('#photo-input').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    $('#photo-pick-text').textContent = '處理照片中…';
    pendingImage = await compressImage(file);
    showPhotoPreview(pendingImage.dataUrl);
  } catch (error) {
    toast(error.message);
    showPhotoPreview($('#photo-preview').hidden ? '' : $('#photo-preview img').src);
  }
});
$('#photo-remove').addEventListener('click', () => { pendingImage = 'remove'; $('#photo-input').value = ''; showPhotoPreview(''); });
listEditor.querySelector('[data-list-close]').addEventListener('click', () => listEditor.close());
listEditor.addEventListener('click', event => { if (event.target === listEditor) listEditor.close(); });

listForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!canEdit() || !editingListItem) return;
  const title = listForm.elements.title.value.trim();
  const note = listForm.elements.note.value.trim();
  const mapQuery = listForm.elements.mapQuery.value.trim();
  const listId = listForm.elements.list.value;
  const existing = editingListItem.itemId ? findListItem(editingListItem.itemId)?.item : null;
  const keepsImage = pendingImage !== 'remove' && Boolean(pendingImage || existing?.imageId);
  if (!title && !note && !keepsImage) { toast('請至少填名稱、備註或放一張照片'); return; }
  const saveButton = $('#list-save');
  let imageId = pendingImage === 'remove' ? '' : existing?.imageId || '';
  if (pendingImage && pendingImage !== 'remove') {
    saveButton.disabled = true; saveButton.textContent = '上傳照片中…';
    try {
      imageId = await Promise.race([sync.uploadImage(pendingImage), new Promise((_, reject) => setTimeout(() => reject(new Error('上傳逾時，請確認網路後再試')), 30000))]);
      imageCache.set(imageId, pendingImage.dataUrl);
    } catch (error) {
      console.error(error);
      saveButton.disabled = false; saveButton.textContent = '儲存';
      showListError(error.code === 'permission-denied' ? '照片上傳失敗：雲端拒絕存照片（Firebase 安全規則還沒更新）。' : `照片上傳失敗：${error.message}`);
      return;
    }
  }
  const item = { id: existing?.id || `li-${uid()}`, title, note, mapQuery, imageId, links: existing?.links || [], done: existing?.done || false };
  const change = { type:'upsertListItem', listId, item };
  try { data = applyChange(data, change); } catch (error) { toast(error.message); saveButton.disabled = false; saveButton.textContent = '儲存'; return; }
  listEditor.close();
  editingListItem = null; pendingImage = null;
  save(change);
  toast(existing ? '項目已更新' : '項目已新增');
});

$('#list-item-delete').addEventListener('click', () => {
  if (!canEdit() || !editingListItem?.itemId) return;
  const found = findListItem(editingListItem.itemId);
  if (!found || !confirm(`確定刪除「${found.item.title || '這個項目'}」？`)) return;
  const change = { type:'deleteListItem', itemId: found.item.id };
  data = applyChange(data, change);
  listEditor.close(); editingListItem = null;
  save(change); toast('項目已刪除');
});

function startListEdit(listId) {
  if (!canEdit()) return;
  const list = (data.lists || []).find(l => l.id === listId);
  const heading = content.querySelector(`[data-list-title="${CSS.escape(listId)}"]`);
  if (!list || !heading) return;
  listEdit = listId;
  heading.innerHTML = `<form class="section-form list-rename-form" data-list-form="${escapeHtml(listId)}"><input name="listName" maxlength="50" required aria-label="清單名稱" value="${escapeHtml(list.title)}"><button class="section-save" type="submit">儲存</button><button class="section-cancel list-delete" type="button" data-list-delete="${escapeHtml(listId)}">刪除</button><button class="section-cancel" type="button" data-list-cancel>取消</button></form>`;
  const input = heading.querySelector('input');
  input.focus(); input.select();
}

content.addEventListener('click', event => {
  if (view !== 'lists') return;
  const photo = event.target.closest('[data-photo]');
  if (photo) { const url = imageCache.get(photo.dataset.photo); if (url) { photoViewer.querySelector('img').src = url; photoViewer.showModal(); } return; }
  const done = event.target.closest('[data-list-done]');
  if (done) { if (!canEdit()) return; const found = findListItem(done.dataset.listDone); if (found) { const change = { type:'setListItemDone', itemId: found.item.id, done: !found.item.done }; data = applyChange(data, change); save(change); } return; }
  const edit = event.target.closest('[data-list-item-edit]');
  if (edit) { const found = findListItem(edit.dataset.listItemEdit); if (found) openListEditor(found.list.id, found.item.id); return; }
  const add = event.target.closest('[data-list-add]');
  if (add) { openListEditor(add.dataset.listAdd); return; }
  if (event.target.closest('[data-list-cancel]')) { listEdit = null; render(); return; }
  const del = event.target.closest('[data-list-delete]');
  if (del) {
    if (!canEdit()) return;
    const list = (data.lists || []).find(l => l.id === del.dataset.listDelete);
    if (!list || !confirm(`確定刪除清單「${list.title}」${list.items.length ? `和裡面 ${list.items.length} 個項目` : ''}？`)) return;
    const change = { type:'deleteList', listId: list.id };
    listEdit = null; data = applyChange(data, change); save(change); toast('清單已刪除');
    return;
  }
  if (event.target.closest('.list-rename-form')) return;
  const rename = event.target.closest('[data-list-edit], [data-list-title]');
  if (rename) startListEdit(rename.dataset.listEdit ?? rename.dataset.listTitle);
});

content.addEventListener('submit', event => {
  const renameForm = event.target.closest('.list-rename-form');
  if (renameForm) {
    event.preventDefault();
    if (!canEdit()) return;
    const listId = renameForm.dataset.listForm;
    const title = renameForm.elements.listName.value.trim();
    const list = (data.lists || []).find(l => l.id === listId);
    listEdit = null;
    if (!list || !title || title === list.title) { render(); return; }
    const change = { type:'renameList', listId, title };
    data = applyChange(data, change); save(change); toast('清單名稱已更新');
    return;
  }
  const newForm = event.target.closest('.new-list-form');
  if (newForm) {
    event.preventDefault();
    if (!canEdit()) return;
    const title = newForm.elements.listName.value.trim();
    if (!title) return;
    newForm.elements.listName.blur();
    const change = { type:'addList', list:{ id:`list-${uid()}`, title, links:[], items:[] } };
    data = applyChange(data, change); save(change); toast(`已新增清單「${title}」`);
  }
});
photoViewer.addEventListener('click', () => photoViewer.close());

// Typing in an inline form on the page: hold cloud refreshes until the field loses focus.
const typingInContent = () => content.contains(document.activeElement) && document.activeElement.matches('input, textarea');
// The delay lets a tap on the form's own button submit first (submitting re-renders anyway).
content.addEventListener('focusout', () => setTimeout(() => { if (pendingRemote && !drag && sectionEdit === null && listEdit === null && !typingInContent()) render(); }, 400));

// ---------- Section title editing (applies to every card in the group) ----------

function startSectionEdit(index) {
  if (!canEdit()) return;
  const group = dayGroups[index];
  const heading = content.querySelector(`[data-section-title="${index}"]`);
  if (!group || !heading) return;
  if (sectionEdit !== null) finishSectionEdit();
  sectionEdit = index;
  heading.innerHTML = `<form class="section-form" data-section-form="${index}"><input name="sectionName" maxlength="50" required aria-label="小標題" value="${escapeHtml(group.title)}"><button class="section-save" type="submit">儲存</button><button class="section-cancel" type="button" data-section-cancel>取消</button></form>`;
  const input = heading.querySelector('input');
  input.focus();
  input.select();
}

function finishSectionEdit() {
  sectionEdit = null;
  render();
}

function submitSectionEdit(form) {
  const index = Number(form.dataset.sectionForm);
  const group = dayGroups[index];
  const to = form.elements.sectionName.value.trim();
  if (!group) { finishSectionEdit(); return; }
  if (!to) { toast('小標題不能空白'); return; }
  if (to === group.title) { finishSectionEdit(); return; }
  if (!canEdit()) return;
  const merged = dayGroups.some((g, n) => n !== index && g.title === to);
  const change = { type:'renameSection', day:activeDay, from:group.title, to };
  sectionEdit = null;
  data = applyChange(data, change);
  save(change);
  toast(merged ? '已改名，並和同名小標題合併' : `已更新 ${group.items.length} 張卡片的小標題`);
}

content.addEventListener('click', event => {
  if (event.target.closest('[data-section-cancel]')) { finishSectionEdit(); return; }
  if (event.target.closest('.section-form')) return;
  const trigger = event.target.closest('[data-section-edit], [data-section-title]');
  if (!trigger) return;
  startSectionEdit(Number(trigger.dataset.sectionEdit ?? trigger.dataset.sectionTitle));
});
content.addEventListener('submit', event => {
  const form = event.target.closest('[data-section-form]');
  if (!form) return;
  event.preventDefault();
  submitSectionEdit(form);
});
content.addEventListener('keydown', event => {
  if (event.key === 'Escape' && event.target.closest('[data-section-form]')) finishSectionEdit();
  if (event.key === 'Escape' && event.target.closest('.list-rename-form')) { listEdit = null; render(); }
});

// ---------- Long-press drag to reorder cards inside one group ----------

const LONG_PRESS_MS = 350;
const MOVE_TOLERANCE = 8;
const idsOf = (list) => [...list.querySelectorAll('.entry[data-id]')].map(el => el.dataset.id);

function dragTarget(target) {
  if (view !== 'days' || search || sectionEdit !== null) return null;
  if (target.closest('.entry-actions, .done-toggle')) return null;
  const entry = target.closest('.entry[data-id]');
  const list = entry?.closest('.entry-list[data-section-index]');
  return entry && list ? { entry, list } : null;
}

function pressStart(target, x, y) {
  cancelPress();
  const hit = dragTarget(target);
  if (!hit) return;
  press = { ...hit, x, y, timer: setTimeout(beginDrag, LONG_PRESS_MS) };
}

function cancelPress() {
  if (press) clearTimeout(press.timer);
  press = null;
}

function beginDrag() {
  if (!press) return;
  const { entry, list, x, y } = press;
  press = null;
  if (!canEdit()) return;
  if (list.querySelectorAll('.entry').length < 2) return;
  const rect = entry.getBoundingClientRect();
  drag = { entry, list, x, y, grabX: x - rect.left, grabY: y - rect.top, startIds: idsOf(list), frame: 0 };
  entry.classList.add('dragging');
  document.body.classList.add('is-dragging');
  navigator.vibrate?.(15);
  drag.frame = requestAnimationFrame(dragLoop);
}

function moveDrag(x, y) {
  drag.x = x;
  drag.y = y;
  updateDrag();
}

function updateDrag() {
  const { entry, list, x, y } = drag;
  entry.style.transform = '';
  const own = entry.getBoundingClientRect();
  const ownCy = own.top + own.height / 2;
  const cards = [...list.querySelectorAll('.entry')];
  const ownIndex = cards.indexOf(entry);
  for (const [index, card] of cards.entries()) {
    if (card === entry) continue;
    const r = card.getBoundingClientRect();
    const inside = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    const above = index === 0 && y < r.top;
    const below = index === cards.length - 1 && y > r.bottom;
    if (!inside && !above && !below) continue;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const sameRow = Math.abs(cy - ownCy) < 10;
    // Only swap once the finger passes the middle of the card, so cards don't flicker back and forth.
    if (index > ownIndex && (above || below || y > cy || (sameRow && x > cx))) list.insertBefore(entry, card.nextElementSibling);
    else if (index < ownIndex && (above || below || y < cy || (sameRow && x < cx))) list.insertBefore(entry, card);
    break;
  }
  const now = entry.getBoundingClientRect();
  entry.style.transform = `translate(${x - drag.grabX - now.left}px, ${y - drag.grabY - now.top}px)`;
}

function dragLoop() {
  if (!drag) return;
  const edge = 90;
  const bottom = window.innerHeight - 110; // keep clear of the bottom navigation
  let step = 0;
  if (drag.y < edge) step = -Math.ceil((edge - drag.y) / 6);
  else if (drag.y > bottom) step = Math.ceil((drag.y - bottom) / 6);
  if (step) { window.scrollBy(0, step); updateDrag(); }
  drag.frame = requestAnimationFrame(dragLoop);
}

function endDrag(commit = true) {
  if (!drag) return;
  const { entry, list, startIds, frame } = drag;
  cancelAnimationFrame(frame);
  drag = null;
  entry.classList.remove('dragging');
  entry.style.transform = '';
  document.body.classList.remove('is-dragging');
  const group = dayGroups[Number(list.dataset.sectionIndex)];
  const ids = idsOf(list);
  if (commit && group && ids.join() !== startIds.join() && canEdit()) {
    const change = { type:'reorderSection', day:activeDay, section:group.title, ids };
    data = applyChange(data, change);
    save(change);
    toast('順序已調整');
    return;
  }
  if (!commit || pendingRemote) render();
}

content.addEventListener('touchstart', event => {
  if (event.touches.length !== 1) { cancelPress(); return; }
  const touch = event.touches[0];
  pressStart(event.target, touch.clientX, touch.clientY);
}, { passive:true });
document.addEventListener('touchmove', event => {
  const touch = event.touches[0];
  if (!touch) return;
  if (drag) { event.preventDefault(); moveDrag(touch.clientX, touch.clientY); return; }
  if (press && Math.hypot(touch.clientX - press.x, touch.clientY - press.y) > MOVE_TOLERANCE) cancelPress();
}, { passive:false });
document.addEventListener('touchend', event => {
  cancelPress();
  if (!drag) return;
  event.preventDefault(); // stop the tap from opening the map link under the finger
  endDrag(true);
});
document.addEventListener('touchcancel', () => { cancelPress(); endDrag(false); });

content.addEventListener('mousedown', event => {
  if (event.button !== 0) return;
  pressStart(event.target, event.clientX, event.clientY);
});
document.addEventListener('mousemove', event => {
  if (drag) { event.preventDefault(); moveDrag(event.clientX, event.clientY); return; }
  if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > MOVE_TOLERANCE) cancelPress();
});
document.addEventListener('mouseup', () => {
  cancelPress();
  if (!drag) return;
  suppressClick = true;
  setTimeout(() => { suppressClick = false; }, 0);
  endDrag(true);
});
document.addEventListener('click', event => {
  if (!suppressClick) return;
  suppressClick = false;
  event.preventDefault();
  event.stopPropagation();
}, true);
content.addEventListener('contextmenu', event => { if (press || drag) event.preventDefault(); });
content.addEventListener('dragstart', event => { if (press || drag) event.preventDefault(); });

async function init() {
  const response = await fetch('./itinerary.json?v=20261109a');
  if (!response.ok) throw new Error('行程資料載入失敗');
  const initial = await response.json();
  data = initial;
  render();
  setSyncStatus('連線中');
  const connectionTimer = setTimeout(() => {
    if (!cloudReady && $('#sync-label').textContent === '連線中') setSyncStatus('連線逾時，請重新整理');
  }, 12000);
  try {
    sync = await createSync({
      initial,
      onRemote: remote => {
        data = remote;
        localStorage.setItem(storageKey, JSON.stringify(data));
        // Don't wipe an open title editor or a card being dragged; refresh when they finish.
        if (drag || sectionEdit !== null || listEdit !== null || typingInContent()) { pendingRemote = true; return; }
        render();
      },
      onReady: ready => { cloudReady = ready; if (ready) { clearTimeout(connectionTimer); render(); } },
      onStatus: status => setSyncStatus(status),
    });
    render();
  } catch (error) { clearTimeout(connectionTimer); setSyncStatus('同步無法使用'); console.error(error); }
}
init().catch(error => { content.innerHTML = `<div class="empty-state"><strong>行程無法載入</strong><p>${escapeHtml(error.message)}。請重新整理頁面。</p></div>`; });

