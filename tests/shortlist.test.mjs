import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, leadResearch } from './fixtures.mjs';
const organization = { name: 'Example Lab', website: 'https://example.org', location: 'Gainesville', distanceMiles: 3, remote: false, sectorFit: 'Research tools', sources: leadResearch.sources };
test('company verification and persisted shortlist precede employee search; outsiders are rejected',async t=>{
 const f=await fixture({sendingEnabled:false});t.after(()=>f.db.close());await f.seed();const order=[];
 f.ai.organizations=async()=>{order.push('companies');return {organizations:[organization]};};
 f.ai.verifyOrganization=async()=>{order.push('verify');return {eligible:true};};
 f.ai.research=async(_p,_g,_c,_e,_s,shortlist)=>{
  order.push('employees');assert.equal(shortlist.length,1);
  const saved=await f.db.one("SELECT detail FROM events WHERE kind='organizations_shortlisted'");assert.equal(saved.detail.organizations[0].name,'Example Lab');
  return {leads:[{...leadResearch,organization:'Unlisted Firm'},leadResearch],searchSummary:'Employees'};
 };
 await f.engine.tick();assert.deepEqual(order,['companies','verify','employees']);
 const leads=(await f.db.query('SELECT research FROM leads')).rows;assert.equal(leads.length,1);assert.equal(leads[0].research.organization,'Example Lab');assert.equal(f.sent.length,0);
});
test('out-of-radius, unknown distance, unverifiable sources and failed sector audit cannot reach employee search',async t=>{
 for(const candidate of [{...organization,distanceMiles:100},{...organization,distanceMiles:null},{...organization,sources:[{...organization.sources[0],excerpt:'Invented evidence'}]},organization]){
  const f=await fixture({sendingEnabled:false});try{
   await f.seed();f.ai.organizations=async()=>({organizations:[candidate]});f.ai.verifyOrganization=async()=>({eligible:false});
   let employeeCalls=0;f.ai.research=async()=>{employeeCalls++;return {leads:[],searchSummary:''};};await f.engine.tick();assert.equal(employeeCalls,0);
   assert.equal((await f.db.query('SELECT id FROM leads')).rows.length,0);
   const saved=await f.db.one("SELECT detail FROM events WHERE kind='organizations_shortlisted'");assert.deepEqual(saved.detail.organizations,[]);
  }finally{await f.db.close();}
 }
});
test('explicit remote organization can qualify beyond radius only with remote enabled',async t=>{
 const f=await fixture({sendingEnabled:false});t.after(()=>f.db.close());await f.seed('user-a',{remote:true});
 f.ai.organizations=async()=>({organizations:[{...organization,distanceMiles:1000,remote:true}]});
 let count=0;f.ai.research=async()=>{count++;return {leads:[],searchSummary:'Remote'};};await f.engine.tick();assert.equal(count,1);
});
