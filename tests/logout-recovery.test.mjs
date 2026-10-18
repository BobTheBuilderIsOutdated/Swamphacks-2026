import test from 'node:test';
import assert from 'node:assert/strict';
test('logout without an initialized Auth0 client preserves the signed-out barrier and returns home', async () => {
 const previous = {location:globalThis.location,sessionStorage:globalThis.sessionStorage};
 const stored=new Map();let redirected;
 globalThis.location={search:'',origin:'https://example.org',replace:path=>redirected=path};
 globalThis.sessionStorage={getItem:key=>stored.get(key),setItem:(key,value)=>stored.set(key,value)};
 try {
  const {logout}=await import('../web/api.mjs?logout-recovery');
  await logout();
  assert.equal(stored.get('nudge-signed-out'),'1');
  assert.equal(redirected,'/');
 } finally { Object.assign(globalThis,previous); }
});
