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
test('missing Auth0 configuration deletes local data and reports partial completion', async t => {
 const f = await fixture(); t.after(() => f.db.close()); await f.seed();
 const r = await request(f.app).delete('/api/account/data').set('x-test-user','user-a').send({confirm:'DELETE'});
 assert.equal(r.status,200); assert.equal(r.body.dataDeleted,true); assert.equal(r.body.auth0Deleted,false); assert.match(r.body.warnings.join(' '),/Auth0/); assert.equal(await f.db.one('SELECT subject FROM accounts'),undefined); assert.equal(await f.db.one('SELECT subject FROM mailboxes'),undefined); assert.equal(await f.db.one('SELECT id FROM campaigns'),undefined);
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
test('Auth0 failure deletes local data and blocks stale tokens',async t=>{
 const f=await fixture({}, {prepare:async()=>async()=>{throw Object.assign(new Error('Unavailable'),{status:503});}});t.after(()=>f.db.close());await f.seed();
 const r=await request(f.app).delete('/api/account/data').set('x-test-user','user-a').send({confirm:'DELETE'});
 assert.equal(r.status,200); assert.equal(r.body.auth0Deleted,false); assert.equal(await f.db.one('SELECT * FROM accounts'),undefined); assert.equal(await f.db.one('SELECT status FROM campaigns'),undefined);
 assert.equal((await request(f.app).get('/api/dashboard').set('x-test-user','user-a')).status,401);
});
test('Management API deletes encoded verified subject and accepts already deleted users',async()=>{
 const calls=[];const manager=identityManager({authDomain:'example.auth0.com',managementClientId:'id',managementSecret:'secret'},async(url,options)=>{calls.push({url,options});return calls.length===1?{ok:true,json:async()=>({access_token:'test'})}:{ok:false,status:404};});
 await (await manager.prepare())('google-oauth2|123');
 assert.equal(calls[1].url,'https://example.auth0.com/api/v2/users/google-oauth2%7C123');assert.equal(calls[1].options.method,'DELETE');
});

test('Gmail revocation failure does not retain local credentials or stop Auth0 deletion',async t=>{
 const removed=[];const f=await fixture({}, {prepare:async()=>async subject=>removed.push(subject)});t.after(()=>f.db.close());await f.seed();
 f.mail.revoke=async()=>{throw new Error('Offline');};
 const r=await request(f.app).delete('/api/account/data').set('x-test-user','user-a').send({confirm:'DELETE'});
 assert.equal(r.status,200);assert.equal(r.body.auth0Deleted,true);assert.deepEqual(removed,['user-a']);assert.match(r.body.warnings.join(' '),/Gmail/);assert.equal(await f.db.one('SELECT * FROM mailboxes'),undefined);
});

test('fresh login can explicitly recreate an empty account while old tokens remain blocked', async t => {
 const f=await fixture();t.after(()=>f.db.close());await f.seed();await f.seed('user-b');
 await request(f.app).delete('/api/account/data').set('x-test-user','user-a').send({confirm:'DELETE'});
 const stale=await request(f.app).post('/api/account/recreate').set('x-test-user','user-a').send({confirm:'CREATE'});
 assert.equal(stale.status,401);
 const issued=String(Math.floor(Date.now()/1000)+2);
 const missing=await request(f.app).post('/api/account/recreate').set('x-test-user','user-a').set('x-test-iat',issued).send({});
 assert.equal(missing.status,400);
 const fresh=await request(f.app).post('/api/account/recreate').set('x-test-user','user-a').set('x-test-iat',issued).send({confirm:'CREATE',subject:'user-b'});
 assert.equal(fresh.status,200);
 const dashboard=await request(f.app).get('/api/dashboard').set('x-test-user','user-a').set('x-test-iat',issued);
 assert.equal(dashboard.status,200);assert.equal(dashboard.body.profile,null);assert.deepEqual(dashboard.body.campaigns,[]);assert.equal(dashboard.body.mailbox,null);
 assert.equal((await request(f.app).get('/api/dashboard').set('x-test-user','user-a')).status,401);
 assert.ok(await f.db.one("SELECT profile FROM accounts WHERE subject='user-b'"));
 await request(f.app).delete('/api/account/data').set('x-test-user','user-a').set('x-test-iat',issued).send({confirm:'DELETE'});
 assert.equal((await request(f.app).get('/api/dashboard').set('x-test-user','user-a').set('x-test-iat',issued)).status,401);
});
