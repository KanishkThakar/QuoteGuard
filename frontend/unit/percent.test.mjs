import assert from 'node:assert/strict';
import test from 'node:test';
import { ratioToPercent, percentToRatio } from '../src/percent.ts';

for (const [percent, ratio] of [
  ['2.9', '0.029000'],
  ['33.3333', '0.333333'],
  ['99.9999', '0.999999'],
  ['0.0001', '0.000001'],
  ['0', '0.000000'],
  ['30', '0.300000'],
]) {
  test(`${percent}% round trips within the API six-place ratio precision`, () => {
    assert.equal(percentToRatio(percent), ratio);
    assert.equal(ratioToPercent(ratio), percent);
  });
}
