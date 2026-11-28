'use strict';
const path = 'latest-itinerary.json';
function compareRevision(a,b) {
  for (const r of [a,b]) {
    if (!Number.isSafeInteger(r?.seconds) || !Number.isInteger(r?.nanoseconds) ||
      r.nanoseconds < 0 || r.nanoseconds >= 1e9) throw new Error('Invalid source revision');
  }
  return Math.sign(a.seconds-b.seconds || a.nanoseconds-b.nanoseconds);
}
async function mirrorLatest({token,repo,readSource,request=globalThis.fetch}) {
  if (!token || !/^MitsuiWei\/[A-Za-z0-9_.-]+$/i.test(repo)) throw new Error('Missing token or unexpected repository owner');
  const root = 'https://api.github.com/repos/' + repo;
  async function api(url,method='GET',body) {
    return request(url,{method,headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json',
      'X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},
      ...(body ? {body:JSON.stringify(body)} : {}),signal:AbortSignal.timeout(12000)});
  }
  const metaResponse = await api(root);
  if (!metaResponse.ok) throw new Error('GitHub repository check failed: '+metaResponse.status);
  const meta = await metaResponse.json();
  if (meta.private !== true || meta.visibility !== 'private') throw new Error('Refusing to mirror personal data to a non-private repository');
  const branch = meta.default_branch;
  if (!branch) throw new Error('Initialize the private mirror repository first');
  const url = root+'/contents/'+path;
  for(let attempt=0; attempt<4; attempt++) {
    // Read the current authoritative document on EVERY attempt; event delivery is unordered.
    const snapshot = await readSource();
    compareRevision(snapshot.sourceRevision,snapshot.sourceRevision);
    const current = await api(url+'?ref='+encodeURIComponent(branch));
    let sha;
    if (current.ok) {
      const existing = await current.json();
      if (existing.type !== 'file' || existing.encoding !== 'base64' || !existing.sha || !existing.content)
        throw new Error('Mirror file is invalid or exceeds supported GitHub Contents response size');
      const old = JSON.parse(Buffer.from(existing.content,'base64').toString('utf8'));
      if (old.source !== snapshot.source || old.schemaVersion !== 1) throw new Error('Refusing to overwrite an unrelated file');
      if (compareRevision(old.sourceRevision,snapshot.sourceRevision)>=0) return 'already current';
      sha = existing.sha;
    } else if(current.status!==404) {
      throw new Error('GitHub mirror read failed: '+current.status);
    }
    const body = {message:'Sync Osaka Kyoto itinerary '+snapshot.sourceUpdatedAt,
      content:Buffer.from(JSON.stringify(snapshot)+'\n','utf8').toString('base64'),branch,
      ...(sha ? {sha} : {})};
    const write = await api(url,'PUT',body);
    if (write.ok) return 'updated';
    if (![409,422].includes(write.status)) throw new Error('GitHub mirror write failed: '+write.status);
    // SHA compare-and-swap prevents stale events from replacing a newer mirror.
  }
  throw new Error('Concurrent GitHub update; retry required');
}
module.exports={mirrorLatest,compareRevision};
