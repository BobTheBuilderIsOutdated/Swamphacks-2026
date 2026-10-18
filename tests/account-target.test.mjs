import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { fixture, goal, leadResearch } from './fixtures.mjs';
import { identityManager } from '../server/identity.mjs';
const target = { name: 'Test Researcher', organization: 'Example Lab', sourceUrl: 'https://example.org/team' };
test('targeted campaigns stay paused and require review despite automatic authorization', async t => {
 const f = await fixture(); t.after(() => f.db.close()); await f.seed();
 await f.db.query('UPDATE accounts SET auto_authorize=true');
 const r = await request(f.app).post('/api/campaigns').set('x-test-user','user-a').send({...goal,target});
 assert.equal(r.status,200); const c = await f.db.one('SELECT * FROM campaigns WHERE id=$1',[r.body.id]);
 assert.equal(c.status,'paused'); assert.equal(c.goal.mode,'review'); assert.equal(c.goal.dailyLimit,1);
});
test('target discovery rejects substitutes and stops after one verified contact', async t => {
 const f = await fixture({sendingEnabled:false}); t.after(() => f.db.close()); await f.seed('user-a',{target,mode:'review'});
 f.ai.research = async () => ({leads:[{...leadResearch,name:'Someone Else'},leadResearch,leadResearch],searchSummary:'test'});
 await f.engine.tick(); assert.equal((await f.db.query('SELECT * FROM leads')).rows.length,1); assert.equal(f.sent.length,0);
 const lead = await f.db.one('SELECT research FROM leads'); assert.equal(lead.research.name,target.name);
});
test('missing deletion configuration preserves account data', async t => {
 const f = await fixture(); t.after(() => f.db.close()); await f.seed();
 const r = await request(f.app).delete('/api/account/data').set('x-test-user','user-a').send({confirm:'DELETE'});
 assert.equal(r.status,503); assert.ok(await f.db.one('SELECT subject FROM accounts'));
});
test('deletion removes only caller and prevents stale tokens recreating their account', async t => {
 const removed=[]; const f=await fixture({}, {prepare:async()=>async subject=>removed.push(subject)}); t.after(()=>f.db.close());
 await f.seed(); await f.seed('user-b');
 const r=await request(f.app).delete('/api/account/data').set('x-test-user','user-a').send({confirm:'DELETE',subject:'user-b'});
 assert.equal(r.status,200); assert.deepEqual(removed,['user-a']);
 assert.equal(await f.db.one("SELECT * FROM accounts WHERE subject='user-a'"),undefined);
 assert.ok(await f.db.one("SELECT * FROM accounts WHERE subject='user-b'"));
 assert.equal((await request(f.app).get('/api/dashboard').set('x-test-user','user-a')).status,401);
});
test('Auth0 failure pauses campaigns but retains data for retry',async t=>{
 const f=await fixture({}, {prepare:async()=>async()=>{throw Object.assign(new Error('Unavailable'),{status:503});}});t.after(()=>f.db.close());await f.seed();
 assert.equal((await request(f.app).delete('/api/account/data').set('x-test-user','user-a').send({confirm:'DELETE'})).status,503);
 assert.ok(await f.db.one('SELECT * FROM accounts'));assert.equal((await f.db.one('SELECT status FROM campaigns')).status,'paused');
});
test('Management API deletes encoded verified subject and accepts already deleted users',async()=>{
 const calls=[];const manager=identityManager({authDomain:'example.auth0.com',managementClientId:'id',managementSecret:'secret'},async(url,options)=>{calls.push({url,options});return calls.length===1?{ok:true,json:async()=>({access_token:'test'})}:{ok:false,status:404};});
 await (await manager.prepare())('google-oauth2|123');
 assert.equal(calls[1].url,'https://example.auth0.com/api/v2/users/google-oauth2%7C123');assert.equal(calls[1].options.method,'DELETE');
});
