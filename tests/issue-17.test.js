import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPhrase } from '../src/phrasebook.js';

test('issue-17: supplied quick phrase resolves in both directions', () => {
  assert.equal(findPhrase('Please repeat after me.', 'en'), '请跟我一起说');
  assert.equal(findPhrase('请跟我一起说', 'zh'), 'Please repeat after me.');
});
