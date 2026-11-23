import { firebaseConfig } from './firebase-config.js?v=20261108b';

const tripId = 'osaka-kyoto-2026';
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));

function findItem(data, id) {
  for (const day of data.days) {
    const index = day.items.findIndex(item => item.id === id);
    if (index !== -1) return { day, index };
  }
  return null;
}

const sectionOf = (item) => item.section || '行程';

// Number at the start of a section title: ⓪, ①–⑳, ➀–➉, ❶–❿ or plain digits. Unnumbered groups go last.
function sectionRank(section) {
  const text = String(section || '').trim();
  const c = text.codePointAt(0) || 0;
  if (c === 0x24EA) return 0;                                 // ⓪
  if (c >= 0x2460 && c <= 0x2473) return c - 0x2460 + 1;      // ①–⑳
  if (c >= 0x2780 && c <= 0x2789) return c - 0x2780 + 1;      // ➀–➉
  if (c >= 0x2776 && c <= 0x277F) return c - 0x2776 + 1;      // ❶–❿
  const digits = text.match(/^\d+/);
  return digits ? Number(digits[0]) : Infinity;
}

// Stable sort: groups follow their circled number; cards keep their order inside each group.
function sortDayBySection(day) {
  day.items = day.items.map((item, index) => ({ item, index }))
    .sort((a, b) => (sectionRank(a.item.section) - sectionRank(b.item.section)) || (a.index - b.index))
    .map(({ item }) => item);
}

export function applyChange(data, change) {
  if (change.type === 'replace') return structuredClone(change.data);
  const next = structuredClone(data);
  const found = change.id ? findItem(next, change.id) : null;
  if (change.type === 'upsert') {
    const target = next.days[change.day];
    if (!target) throw new Error('找不到指定日期');
    const old = findItem(next, change.item.id);
    const oldSection = old ? old.day.items[old.index].section : null;
    if (old) old.day.items.splice(old.index, 1);
    if (old?.day === target) target.items.splice(old.index, 0, change.item);
    else target.items.push(change.item);
    // New card, moved to another day, or its group title changed: put it with its numbered group.
    if (!old || old.day !== target || oldSection !== change.item.section) sortDayBySection(target);
  } else if (change.type === 'delete' && found) {
    found.day.items.splice(found.index, 1);
  } else if (change.type === 'setDone' && found) {
    found.day.items[found.index].done = change.done;
  } else if (change.type === 'move' && found) {
    const target = found.index + change.direction;
    if (target >= 0 && target < found.day.items.length) {
      [found.day.items[found.index], found.day.items[target]] = [found.day.items[target], found.day.items[found.index]];
    }
  } else if (change.type === 'renameSection') {
    // Rename one group in one day: every card whose section matches gets the new name.
    const day = next.days[change.day];
    if (!day) throw new Error('找不到指定日期');
    for (const item of day.items) if (sectionOf(item) === change.from) item.section = change.to;
    sortDayBySection(day);
  } else if (change.type === 'reorderSection') {
    // Reorder cards inside one group only. Cards are matched by id, so edits made by
    // someone else at the same time (new or deleted cards) are kept.
    const day = next.days[change.day];
    if (!day) throw new Error('找不到指定日期');
    const inGroup = day.items.map((item, index) => ({ item, index })).filter(({ item }) => sectionOf(item) === change.section);
    const rank = new Map(change.ids.map((id, n) => [id, n]));
    const sorted = [...inGroup].sort((a, b) => ((rank.get(a.item.id) ?? Infinity) - (rank.get(b.item.id) ?? Infinity)) || (a.index - b.index));
    inGroup.forEach(({ index }, n) => { day.items[index] = sorted[n].item; });
  } else if (change.type === 'initLists') {
    // One-time upgrade: each old checklist entry becomes its own list, keeping its links.
    if (!Array.isArray(next.lists)) {
      next.lists = (next.checklist || []).map((entry, n) => ({ id: entry.id || `list-${n}`, title: entry.title || '清單', links: entry.links || [], items: [] }));
    }
  } else if (change.type === 'addList') {
    if (!Array.isArray(next.lists)) next.lists = [];
    if (!next.lists.some(list => list.id === change.list.id)) next.lists.push(change.list);
  } else if (change.type === 'renameList') {
    const list = (next.lists || []).find(l => l.id === change.listId);
    if (list) list.title = change.title;
  } else if (change.type === 'deleteList') {
    next.lists = (next.lists || []).filter(l => l.id !== change.listId);
  } else if (change.type === 'upsertListItem') {
    const lists = next.lists || [];
    const target = lists.find(l => l.id === change.listId);
    if (!target) throw new Error('找不到這份清單，可能已被刪除');
    let oldList = null;
    let oldIndex = -1;
    for (const list of lists) {
      const index = list.items.findIndex(item => item.id === change.item.id);
      if (index !== -1) { oldList = list; oldIndex = index; break; }
    }
    if (oldList) oldList.items.splice(oldIndex, 1);
    if (oldList === target) target.items.splice(oldIndex, 0, change.item);
    else target.items.push(change.item);
  } else if (change.type === 'deleteListItem') {
    for (const list of next.lists || []) {
      const index = list.items.findIndex(item => item.id === change.itemId);
      if (index !== -1) { list.items.splice(index, 1); break; }
    }
  } else if (change.type === 'setListItemDone') {
    for (const list of next.lists || []) {
      const item = list.items.find(entry => entry.id === change.itemId);
      if (item) { item.done = change.done; break; }
    }
  }
  return next;
}

export async function createSync({ initial, onRemote, onReady, onStatus }) {
  if (!firebaseConfig?.apiKey || !firebaseConfig?.projectId) throw new Error('雲端設定不完整');
  const [{ initializeApp }, { getFirestore, doc, getDoc, setDoc, onSnapshot, runTransaction, serverTimestamp }] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js'),
  ]);
  const db = getFirestore(initializeApp(firebaseConfig));
  const ref = doc(db, 'sharedTrips', tripId);

  let creating = false;
  onSnapshot(ref, { includeMetadataChanges: true }, snapshot => {
    const remote = snapshot.data()?.data;
    if (snapshot.metadata.fromCache) {
      if (remote?.days) onRemote(remote);
      onReady(false);
      onStatus('離線，暫停編輯');
      return;
    }
    if (!snapshot.exists()) {
      if (creating) return;
      creating = true;
      onStatus('建立共用行程中');
      // Only create the shared trip when the server confirms it does not exist.
      runTransaction(db, async transaction => {
        const current = await transaction.get(ref);
        if (!current.exists()) transaction.set(ref, { data: initial, updatedAt: serverTimestamp() });
      }).catch(error => {
        onReady(false);
        onStatus('同步失敗');
        console.error(error);
      }).finally(() => { creating = false; });
      return;
    }
    if (!remote?.days) { onReady(false); onStatus('共用行程無法讀取'); return; }
    onRemote(remote);
    onReady(true);
    onStatus('即時同步中');
  }, error => {
    onReady(false);
    onStatus('同步失敗');
    console.error(error);
  });

  return {
    apply: change => runTransaction(db, async transaction => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists() || !snapshot.data()?.data?.days) throw new Error('共用行程不存在');
      const data = applyChange(snapshot.data().data, change);
      transaction.set(ref, { data, updatedAt: serverTimestamp() });
    }),
    refresh: async () => {
      const snapshot = await getDoc(ref);
      if (snapshot.exists() && snapshot.data()?.data?.days) onRemote(snapshot.data().data);
    },
    // Photos live in their own documents (the itinerary document has a 1 MB limit).
    uploadImage: async ({ dataUrl, width, height }) => {
      const id = `img-${uid()}`;
      await setDoc(doc(db, 'sharedTripImages', id), { trip: tripId, data: dataUrl, width, height, createdAt: serverTimestamp() });
      return id;
    },
    getImage: async (id) => {
      const snapshot = await getDoc(doc(db, 'sharedTripImages', id));
      return snapshot.exists() ? snapshot.data().data || '' : '';
    },
  };
}

