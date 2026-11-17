import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHRASES, normalize, findPhrase } from '../src/phrasebook.js';

test('normalize ignores case, spaces and punctuation', () => {
  assert.equal(normalize('Good evening, everyone!'), 'goodeveningeveryone');
  assert.equal(normalize("  Cheers!  "), 'cheers');
});

test('normalize keeps Chinese characters and drops Chinese punctuation', () => {
  assert.equal(normalize('大家，晚上好！'), '大家晚上好');
  assert.equal(normalize('干杯！'), '干杯');
});

test('findPhrase matches English regardless of case and punctuation', () => {
  assert.equal(findPhrase('good evening, everyone!', 'en'), '大家晚上好');
  assert.equal(findPhrase('CHEERS', 'en'), '干杯！');
});

test('findPhrase matches Chinese regardless of punctuation', () => {
  assert.equal(findPhrase('大家晚上好', 'zh'), 'Good evening everyone');
  assert.equal(findPhrase('大家，晚上好！', 'zh'), 'Good evening everyone');
});

test('findPhrase returns null for text that is not in the phrasebook', () => {
  assert.equal(findPhrase('Nice to meet you', 'en'), null);
  assert.equal(findPhrase('很高兴认识你', 'zh'), null);
});

test('findPhrase returns null for an unknown language', () => {
  assert.equal(findPhrase('Cheers!', 'fr'), null);
});

test('every phrase round-trips in both directions', () => {
  for (const p of PHRASES) {
    assert.equal(findPhrase(p.en, 'en'), p.zh, `en -> zh failed for "${p.en}"`);
    assert.equal(findPhrase(p.zh, 'zh'), p.en, `zh -> en failed for "${p.zh}"`);
  }
});

test('phrases do not collide after normalization', () => {
  for (const lang of ['en', 'zh']) {
    const keys = PHRASES.map((p) => normalize(p[lang]));
    assert.equal(new Set(keys).size, keys.length, `duplicate ${lang} phrase after normalize`);
  }
});
