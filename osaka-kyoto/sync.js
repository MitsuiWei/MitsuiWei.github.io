import { firebaseConfig } from './firebase-config.js?v=20261108b';

const tripId = 'osaka-kyoto-2026';

export async function createSync({ getLocal, onRemote, onUser, onStatus }) {
  if (!firebaseConfig?.apiKey || !firebaseConfig?.projectId) return null;

  const [{ initializeApp }, authModule, firestoreModule] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js'),
    import('https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js'),
  ]);
  const { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } = authModule;
  const { getFirestore, doc, getDoc, onSnapshot, setDoc, serverTimestamp } = firestoreModule;
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  let user = null;
  let unsubscribe = null;
  let isInitializing = false;

  onAuthStateChanged(auth, async nextUser => {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    user = nextUser;
    onUser(nextUser);
    if (!nextUser) return;
    const ref = doc(db, 'users', nextUser.uid, 'trips', tripId);
    isInitializing = true;
    onStatus('正在連接雲端');
    try {
      const first = await getDoc(ref);
      if (first.exists() && first.data().data?.days) onRemote(first.data().data);
      else await setDoc(ref, { data: getLocal(), updatedAt: serverTimestamp() });
      unsubscribe = onSnapshot(ref, snapshot => {
        if (isInitializing || !snapshot.exists()) return;
        const remote = snapshot.data().data;
        if (remote?.days) onRemote(remote);
        onStatus('已連接雲端');
      }, error => onStatus(`同步失敗：${error.code || error.message}`));
      isInitializing = false;
      onStatus('已連接雲端');
    } catch (error) { isInitializing = false; onStatus('同步失敗'); console.error(error); }
  });

  return {
    login: () => signInWithPopup(auth, new GoogleAuthProvider()),
    logout: () => signOut(auth),
    save: async data => {
      if (!user || isInitializing) return;
      const ref = doc(db, 'users', user.uid, 'trips', tripId);
      await setDoc(ref, { data, updatedAt: serverTimestamp() });
      onStatus('已連接雲端');
    },
  };
}

