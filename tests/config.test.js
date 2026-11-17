import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHANNEL, IDLE } from '../src/config.js';

test('the broadcast channel has a name', () => {
  assert.equal(typeof CHANNEL, 'string');
  assert.ok(CHANNEL.length > 0);
});

test('the idle screen has text in both languages', () => {
  assert.ok(IDLE.en.length > 0);
  assert.ok(IDLE.zh.length > 0);
});
