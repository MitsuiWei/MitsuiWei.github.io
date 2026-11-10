import { firebaseConfig } from './firebase-config.js?v=20261108b';

const tripId = 'osaka-kyoto-2026';

function findItem(data, id) {
  for (const day of data.days) {
    const index = day.items.findIndex(item => item.id === id);
    if (index !== -1) return { day, index };
  }
  return null;
}

function applyChange(data, change) {
  if (change.type === 'replace') return structuredClone(change.data);
  const next = structuredClone(data);
  const found = change.id ? findItem(next, change.id) : null;
  if (change.type === 'upsert') {
    const target = next.days[change.day];
    if (!target) throw new Error('找不到指定日期');
    const old = findItem(next, change.item.id);
    if (old) old.day.items.splice(old.index, 1);
    if (old?.day === target) target.items.splice(old.index, 0, change.item);
    else target.items.push(change.item);
  } else if (change.type === 'delete' && found) {
    found.day.items.splice(found.index, 1);
  } else if (change.type === 'setDone' && found) {
    found.day.items[found.index].done = change.done;
  } else if (change.type === 'move' && found) {
    const target = found.index + change.direction;
    if (target >= 0 && target < found.day.items.length) {
      [found.day.items[found.index], found.day.items[target]] = [found.day.items[target], found.day.items[found.index]];
    }
  }
  return next;
}

export async function createSync({ initial, onRemote, onReady, onStatus }) {
  if (!firebaseConfig?.apiKey || !firebaseConfig?.projectId) throw new Error('雲端設定不完整');
  const [{ initializeApp }, { getFirestore, doc, getDoc, onSnapshot, runTransaction, serverTimestamp }] = await Promise.all([
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
  };
}

