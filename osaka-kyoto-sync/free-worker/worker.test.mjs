import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sync,decode,revision} from './worker.mjs';
const env={MIRROR_REPO:'MitsuiWei/private-test',GITHUB_TOKEN:'mock'};
const val={mapValue:{fields:{days:{arrayValue:{values:Array.from({length:8},()=>({mapValue:{fields:{title:{stringValue:'大阪'}}}}))}},flag:{booleanValue:true},number:{integerValue:'5'}}}};
function mock(privateRepo=true) {
  let state=null, count=0, time='2026-11-28T00:00:00.001Z';
  const r=(status,data)=>({status,ok:status>=200&&status<300,json:async()=>data});
  const request=async(url,options={})=>{
    if(url.includes('firestore.googleapis.com')) return r(200,{updateTime:time,fields:{data:val}});
    if(!url.includes('/contents/')) return r(200,{private:privateRepo,visibility:privateRepo?'private':'public',default_branch:'main'});
    if(options.method==='PUT'){
      const body=JSON.parse(options.body);count++;
      state={type:'file',encoding:'base64',sha:String(count),content:body.content};return r(200,{});
    }
    return state?r(200,state):r(404,{});
  };
  return {request,count:()=>count,time:t=>time=t,state:()=>state};
}
test('Firestore decoding and precision',()=>{
 assert.equal(decode(val).days[0].title,'大阪');
 assert.equal(revision('2026-11-28T00:00:00.000000123Z').nanoseconds,123);
});
test('create, unchanged, update, stale',async()=>{
 const f=mock();
 assert.equal(await sync(env,f.request),'updated');
 assert.equal(await sync(env,f.request),'unchanged');
 f.time('2026-11-28T00:00:00.002Z');
 assert.equal(await sync(env,f.request),'updated');
 f.time('2026-11-28T00:00:00.001Z');
 assert.equal(await sync(env,f.request),'unchanged');
 assert.equal(f.count(),2);
 assert.equal(JSON.parse(Buffer.from(f.state().content,'base64').toString()).data.days[0].title,'大阪');
});
test('never write public destination',async()=>{
 const f=mock(false);await assert.rejects(sync(env,f.request),/private/);assert.equal(f.count(),0);
});
