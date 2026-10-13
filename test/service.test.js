import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serviceEnv, servicePlist } from '../lib/service.js';

const base = { label: 'com.lights.server', node: '/opt/homebrew/bin/node', server: '/x/server.js', root: '/x', log: '/x/data/server.log' };

test('only non-empty LIGHTS_* settings are saved with the service, never the API key', () => {
  const env = serviceEnv({
    LIGHTS_PORT: '8500', LIGHTS_ALLOWED_HOSTS: 'lights.example.com', LIGHTS_ALLOW_SLEEP: '',
    GOVEE_API_KEY: 'secret', PATH: '/usr/bin', NO_COLOR: '1', lights_port: '1',
  });
  assert.deepEqual(env, { LIGHTS_ALLOWED_HOSTS: 'lights.example.com', LIGHTS_PORT: '8500' });
});

test('the service file carries the settings, escaped', () => {
  const xml = servicePlist({ ...base, env: { LIGHTS_ALLOWED_HOSTS: 'a.lan,b&c<d>' } });
  assert.match(xml, /<key>EnvironmentVariables<\/key>\s*<dict>\s*<key>LIGHTS_ALLOWED_HOSTS<\/key><string>a\.lan,b&amp;c&lt;d&gt;<\/string>\s*<\/dict>/);
  assert.match(xml, /<string>\/x\/server\.js<\/string>/);
  assert.doesNotMatch(xml, /secret/);
});

test('without settings there is no EnvironmentVariables entry', () => {
  const xml = servicePlist(base);
  assert.doesNotMatch(xml, /EnvironmentVariables/);
  assert.match(xml, /<key>RunAtLoad<\/key><true\/>/);
});
