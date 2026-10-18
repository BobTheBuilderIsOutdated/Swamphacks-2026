import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemo,DEMO_PHRASE} from '../web/demo.mjs';
test('scenario progresses organizations -> people -> drafts -> replies and resets',()=>{
 const d=createDemo();const read=()=>d.request('/dashboard');const next=()=>d.request('/run',{method:'POST'});
 assert.equal(read().leads.length,0);next();assert.equal(read().events[0].detail.organizations.length,3);assert.equal(read().leads.length,0);
 next();assert.equal(read().leads.length,3);assert.equal(read().pending.length,0);
 next();assert.equal(read().pending.length,3);assert.match(d.request('/threads/person-0').drafts[0].content.body,/leakage/);
 next();assert.equal(read().sent,2);assert.equal(read().pending.length,1);assert.equal(d.request('/threads/person-0').history.length,2);
 d.request('/threads/person-0/reply',{method:'POST',body:{body:'Here is the project summary.'}});assert.equal(d.request('/threads/person-0').history.length,3);
 d.request('/demo/reset',{method:'POST'});assert.equal(read().demoStage,0);assert.equal(read().sent,0);
});
test('scenario state persists and unsupported operations never fall through',()=>{
 let saved;const d=createDemo(null,s=>saved=s);d.request('/run',{method:'POST'});
 assert.equal(createDemo(saved).request('/dashboard').demoStage,1);
 for(const path of ['/gmail/connect','/profile','/account/data','/campaigns'])assert.throws(()=>d.request(path,{method:'POST'}),/No live request/);
 d.request('/campaigns/scenario-dartmouth/control',{method:'POST',body:{action:'pause'}});d.request('/run',{method:'POST'});assert.equal(d.request('/dashboard').demoStage,1);
});
test('demo API entry bypasses fetch, Auth0 and extension transport for every action',async()=>{
 const original={location:globalThis.location,sessionStorage:globalThis.sessionStorage,fetch:globalThis.fetch};let calls=0;
 globalThis.location={search:'?demo='+DEMO_PHRASE,origin:'https://example.org'};
 const storage=new Map();globalThis.sessionStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};
 globalThis.fetch=()=>{calls++;throw new Error('Network must not be used');};
 try{
  const api=await import('../web/api.mjs?isolation-test');assert.equal(api.demoMode,true);await api.initialize();assert.equal(await api.signedIn(),true);await api.login();
  for(let i=0;i<4;i++)await api.api('/run',{method:'POST'});
  await api.api('/dashboard');await api.api('/threads/person-0');await api.api('/messages/draft-2/approve',{method:'POST',body:{subject:'Test',body:'Test'}});await api.api('/threads/person-0/reply',{method:'POST',body:{body:'Test'}});
  await assert.rejects(()=>api.api('/gmail/connect',{method:'POST'}));assert.equal(calls,0);
 }finally{Object.assign(globalThis,original);}
});
