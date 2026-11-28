const SOURCE='sharedTrips/osaka-kyoto-2026';
const PROJECT='project-ad1d2';
const PATH='latest-itinerary.json';
export function decode(v) {
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) {
    const n=Number(v.integerValue);
    if(!Number.isSafeInteger(n)) throw new Error('Unsafe Firestore integer');
    return n;
  }
  if ('doubleValue' in v) {
    if(!Number.isFinite(v.doubleValue)) throw new Error('Non-finite Firestore number');
    return v.doubleValue;
  }
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decode);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k,x])=>[k,decode(x)]));
  throw new Error('Unsupported Firestore value');
}
export function revision(time) {
  const m=/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?Z$/.exec(time||'');
  if(!m) throw new Error('Invalid Firestore updateTime');
  const seconds=Date.parse(m[1]+'Z')/1000;
  if(!Number.isSafeInteger(seconds)) throw new Error('Invalid timestamp');
  return {seconds,nanoseconds:Number((m[2]||'').padEnd(9,'0'))};
}
function cmp(a,b) {
  for(const r of [a,b]) if(!Number.isSafeInteger(r?.seconds)||!Number.isInteger(r?.nanoseconds)||r.nanoseconds<0||r.nanoseconds>=1e9) throw new Error('Invalid mirror revision');
  return Math.sign(a.seconds-b.seconds||a.nanoseconds-b.nanoseconds);
}
function encode64(text) {
  const bytes=new TextEncoder().encode(text);
  let out='';
  for(let i=0;i<bytes.length;i+=8192) out+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(out);
}
function decode64(text) {
  return new TextDecoder().decode(Uint8Array.from(atob(text.replace(/\s/g,'')),c=>c.charCodeAt(0)));
}
export async function sync(env,request=fetch) {
  const repo=env.MIRROR_REPO;
  if(!/^MitsuiWei\/[A-Za-z0-9_.-]+$/i.test(repo||'')||!env.GITHUB_TOKEN) throw new Error('Mirror configuration missing');
  const root='https://api.github.com/repos/'+repo;
  const github=(url,method='GET',body)=>request(url,{method,headers:{Authorization:'Bearer '+env.GITHUB_TOKEN,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json','User-Agent':'osaka-kyoto-free-sync'},...(body?{body:JSON.stringify(body)}:{})});
  const metaResponse=await github(root);
  if(!metaResponse.ok) throw new Error('GitHub metadata HTTP '+metaResponse.status);
  const meta=await metaResponse.json();
  if(meta.private!==true||meta.visibility!=='private') throw new Error('Destination must be private');
  if(!meta.default_branch) throw new Error('Initialize destination first');
  const url=root+'/contents/'+PATH;
  const sourceUrl='https://firestore.googleapis.com/v1/projects/'+PROJECT+'/databases/(default)/documents/'+SOURCE;
  for(let attempt=0;attempt<3;attempt++){
    const fs=await request(sourceUrl,{headers:{Accept:'application/json'}});
    if(!fs.ok) throw new Error('Firestore HTTP '+fs.status);
    const doc=await fs.json();
    const data=decode(doc.fields?.data||{});
    if(!Array.isArray(data?.days)||data.days.length!==8) throw new Error('Unexpected source schema');
    const snapshot={schemaVersion:1,source:SOURCE,sourceRevision:revision(doc.updateTime),sourceUpdatedAt:doc.updateTime,data};
    const current=await github(url+'?ref='+encodeURIComponent(meta.default_branch));
    let sha;
    if(current.ok){
      const f=await current.json();
      if(f.type!=='file'||f.encoding!=='base64'||!f.sha||!f.content) throw new Error('Unsupported mirror file');
      const old=JSON.parse(decode64(f.content));
      if(old.source!==SOURCE||old.schemaVersion!==1) throw new Error('Refusing to overwrite unrelated file');
      if(cmp(old.sourceRevision,snapshot.sourceRevision)>=0) return 'unchanged';
      sha=f.sha;
    }else if(current.status!==404) throw new Error('Mirror read HTTP '+current.status);
    const json=JSON.stringify(snapshot)+'\n';
    if(new TextEncoder().encode(json).length>950000) throw new Error('Mirror too large for GitHub Contents read');
    const res=await github(url,'PUT',{message:'Sync trip '+snapshot.sourceUpdatedAt,content:encode64(json),branch:meta.default_branch,...(sha?{sha}:{})});
    if(res.ok) return 'updated';
    if(![409,422].includes(res.status)) throw new Error('Mirror write HTTP '+res.status);
  }
  throw new Error('Concurrent update; next scheduled run will retry');
}
export default {
  async scheduled(_event,env) {
    const result=await sync(env);
    console.log('Trip sync:',result);
  }
};
