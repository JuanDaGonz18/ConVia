/**
 * Auth redirect parsing (e-mail confirmation and Microsoft). Run with `npm test`.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { microsoftErrorMessage, parseAuthLink, parseAuthUrl } from './authLink.ts';

describe('redirect URLs', () => {
  test('a successful redirect carries the PKCE code in the query', () => {
    assert.deepEqual(parseAuthUrl('convia://callback?code=abc-123'), { code: 'abc-123', errorCode: null, errorDescription: null });
  });

  test('errors can come in the query or in the fragment', () => {
    const query = parseAuthUrl('convia://callback?error=access_denied&error_description=User+cancelled');
    assert.equal(query.code, null);
    assert.equal(query.errorCode, 'access_denied');
    assert.equal(query.errorDescription, 'User cancelled');
    const fragment = parseAuthUrl('convia://callback#error=server_error&error_code=unexpected_failure&error_description=Database+error+saving+new+user');
    assert.equal(fragment.errorCode, 'unexpected_failure');
    assert.match(fragment.errorDescription ?? '', /Database error/);
  });

  test('an invalid or empty callback has neither code nor error', () => {
    assert.deepEqual(parseAuthUrl('convia://callback'), { code: null, errorCode: null, errorDescription: null });
    assert.deepEqual(parseAuthLink(null, {}), { code: null, errorCode: null, errorDescription: null });
  });
});

describe('Microsoft errors shown to the user', () => {
  test('a tenant or domain the server rejects', () => {
    assert.match(microsoftErrorMessage({ errorCode: 'server_error', errorDescription: 'Database error saving new user' }), /institución habilitada/);
    assert.match(microsoftErrorMessage({ errorCode: null, errorDescription: 'TENANT_NO_AUTORIZADO' }), /institución habilitada/);
  });

  test('missing administrator consent', () => {
    assert.match(microsoftErrorMessage({ errorCode: 'access_denied', errorDescription: 'AADSTS65001: consent required' }), /administrador/);
  });

  test('anything else is a generic retry message without internal details', () => {
    const message = microsoftErrorMessage({ errorCode: 'weird', errorDescription: 'stack trace at line 3' });
    assert.equal(message, 'No pudimos iniciar sesión con Microsoft. Inténtalo de nuevo.');
  });
});
