import test from 'node:test';
import assert from 'node:assert/strict';
import { startAuthSession } from '../web/auth-session.mjs';

const config = { authDomain: 'example.auth0.com', clientId: 'client', audience: 'api' };
const location = { origin: 'https://nudge.example', pathname: '/', search: '' };
test('page startup never invokes silent session or token requests', async () => {
  class Client {
    constructor(options) { this.options = options; }
    checkSession() { assert.fail('Silent session must not block startup'); }
    getTokenSilently() { assert.fail('No token request during startup'); }
    handleRedirectCallback() { assert.fail('Not a callback'); }
  }
  const auth = await startAuthSession(Client, config, location, {});
  assert.equal(auth.options.cacheLocation, 'memory');
  assert.equal(auth.options.authorizationParams.redirect_uri, 'https://nudge.example/auth/callback');
});
test('successful callback finishes before navigating to dashboard', async () => {
  const actions = [];
  class Client { async handleRedirectCallback() { actions.push('callback'); } }
  await startAuthSession(Client, config, { ...location, pathname: '/auth/callback', search: '?code=test&state=test' },
    { replaceState(_state, _title, url) { actions.push(url); } });
  assert.deepEqual(actions, ['callback', '/dashboard']);
});
test('Auth0 callback errors surface instead of returning to sign-in', async () => {
  class Client { async handleRedirectCallback() { throw new Error('Application access denied'); } }
  await assert.rejects(startAuthSession(Client, config, { ...location, pathname: '/auth/callback', search: '?error=invalid_request&state=test' },
    { replaceState() { assert.fail('Do not navigate after failed login'); } }), /Application access denied/);
});
