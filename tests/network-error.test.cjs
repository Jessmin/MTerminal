const { test } = require('node:test');
const assert = require('node:assert/strict');
const { connectionError } = require('../electron/network-error.cjs');

test('unreachable network error offers platform-specific guidance and keeps original diagnostic', () => {
  const error = Object.assign(new Error('connect EHOSTUNREACH 192.0.2.10:22'), { code: 'EHOSTUNREACH' });
  const host = { hostname: '192.0.2.10', port: 22 };
  assert.match(connectionError(error, host, 'darwin'), /本地网络.*MTerminal/);
  assert.match(connectionError(error, host, 'darwin'), /原始错误：connect EHOSTUNREACH/);
  assert.doesNotMatch(connectionError(error, host, 'win32'), /系统设置/);
  const auth = Object.assign(new Error('All configured authentication methods failed'), { level: 'client-authentication' });
  assert.equal(connectionError(auth, host), auth.message);
});
