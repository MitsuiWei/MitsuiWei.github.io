'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {mirrorLatest,compareRevision} = require('./mirror');
const snap = (n) => ({schemaVersion:1,source:'sharedTrips/osaka-kyoto-2026',sourceRevision:{seconds:100,nanoseconds:n},sourceUpdatedAt:'2026-11-28T00:00:00.000Z',data:{days:[]}});
const response = (status, data) => ({status,ok:status>=200&&status<300,json:async()=>data});
const repo='MitsuiWei/test-private';
function fake({old=null,isPrivate=true,conflict=false}={}) {
  let state=old, writes=0, sha=1;
  const request=async (url, options) => {
    if (!url.includes('/contents/')) return response(200,{private:isPrivate,visibility:isPrivate?'private':'public',default_branch:'main'});
    if (options.method==='GET') return state?response(200,{type:'file',encoding:'base64',sha:String(sha),content:Buffer.from(JSON.stringify(state)).toString('base64')}):response(404,{});
    writes++;
    if(conflict&&writes===1){state=snap(9);sha++;return response(409,{});}
    const body=JSON.parse(options.body);
    if(state&&body.sha!==String(sha)) return response(409,{});
    state=JSON.parse(Buffer.from(body.content,'base64').toString('utf8'));sha++;return response(200,{});
  };
  return {request,state:()=>state,writes:()=>writes};
}
async function run(f, n) {return mirrorLatest({token:'mock',repo,readSource:async()=>snap(n),request:f.request});}
test('create and update mirror; repeat and stale are no-op',async()=>{
  const f=fake();assert.equal(await run(f,1),'updated');assert.equal(await run(f,2),'updated');
  assert.equal(await run(f,2),'already current');assert.equal(await run(f,1),'already current');
  assert.equal(f.writes(),2);assert.equal(f.state().sourceRevision.nanoseconds,2);
});
test('private-only guard',async()=>{const f=fake({isPrivate:false});await assert.rejects(run(f,1),/non-private/);assert.equal(f.writes(),0);});
test('concurrent newer write is never overwritten',async()=>{const f=fake({old:snap(1),conflict:true});assert.equal(await run(f,2),'already current');assert.equal(f.state().sourceRevision.nanoseconds,9);});
test('nanosecond revision comparison',()=>{assert.equal(compareRevision(snap(1).sourceRevision,snap(2).sourceRevision),-1);assert.throws(()=>compareRevision({},snap(1).sourceRevision));});
