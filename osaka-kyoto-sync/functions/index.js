'use strict';
const {initializeApp} = require('firebase-admin/app');
const {getFirestore} = require('firebase-admin/firestore');
const {onDocumentWritten} = require('firebase-functions/v2/firestore');
const {onSchedule} = require('firebase-functions/v2/scheduler');
const {defineSecret, defineString} = require('firebase-functions/params');
const {mirrorLatest} = require('./mirror');
initializeApp();
const token = defineSecret('TRIP_MIRROR_GITHUB_TOKEN');
const repo = defineString('TRIP_MIRROR_REPO', {default:'MitsuiWei/osaka-kyoto-private-sync'});
const region = defineString('TRIP_MIRROR_REGION', {default:'us-central1'});
const docPath = 'sharedTrips/osaka-kyoto-2026';
const options = {region, secrets:[token], timeoutSeconds:120, maxInstances:1, concurrency:1};
async function sync() {
  const result = await mirrorLatest({
    token:token.value(), repo:repo.value(),
    readSource:async () => {
      const snap = await getFirestore().doc(docPath).get();
      if (!snap.exists) throw new Error('Source trip document missing; mirror not modified');
      const data = snap.get('data');
      if (!Array.isArray(data?.days) || data.days.length !== 8) throw new Error('Unexpected itinerary schema');
      return {schemaVersion:1, source:docPath,
        sourceRevision:{seconds:snap.updateTime.seconds,nanoseconds:snap.updateTime.nanoseconds},
        sourceUpdatedAt:snap.updateTime.toDate().toISOString(), data};
    }
  });
  console.info('Trip mirror:', result);
}
exports.syncOsakaKyotoLive = onDocumentWritten({...options,document:docPath,retry:true},sync);
exports.reconcileOsakaKyotoMirror = onSchedule({...options,schedule:'every 15 minutes',retryCount:3},sync);
