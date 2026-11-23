import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { calculate } from './calculator.js';
import { createServer } from './server.js';

test('evaluates scientific expressions with correct precedence and angles', () => {
  assert.equal(calculate('2 + 3 * 4'), 14);
  assert.equal(calculate('-2^2'), -4);
  assert.equal(calculate('2^-2'), 0.25);
  assert.equal(calculate('2^3^2'), 512);
  assert.equal(calculate('sqrt(9) + log(100) + ln(e)'), 6);
  assert.ok(Math.abs(calculate('sin(30)', 'deg') - 0.5) < 1e-12);
  assert.ok(Math.abs(calculate('asin(1)', 'deg') - 90) < 1e-12);
  assert.equal(calculate('cos(pi)'), -1);
  assert.equal(calculate('1e-3 + .5'), 0.501);
});

test('rejects invalid expressions and non-finite results', () => {
  for (const expression of ['', '2(3)', 'sqrt(-1)', '1/0', '2+', 'sin(1', 'process.exit()', '1e999']) {
    assert.throws(() => calculate(expression), expression);
  }
});

test('serves only local calculator assets', async (t) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const url = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /SciCalc/);
  assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal((await fetch(`${url}/calculator.js`)).status, 200);
  assert.equal((await fetch(`${url}/server.js`)).status, 404);
  assert.equal((await fetch(url, { headers: { origin: 'https://example.com' } })).status, 403);
  const foreignHostStatus = await new Promise((resolve, reject) => {
    http.get(url, { headers: { host: 'example.com' } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    }).on('error', reject);
  });
  assert.equal(foreignHostStatus, 403);
  assert.equal((await fetch(url, { method: 'POST' })).status, 405);
});
