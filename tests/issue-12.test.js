import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPhrase } from '../src/phrasebook.js';

test('issue-12: supplied quick phrase resolves in both directions', () => {
  assert.equal(
    findPhrase('The couple will now exchange rings.', 'en'),
    '现在请两位新人交换婚戒。'
  );
  assert.equal(
    findPhrase('现在请两位新人交换婚戒。', 'zh'),
    'The couple will now exchange rings.'
  );
});
