import assert from 'node:assert/strict';
import { test } from 'node:test';
import { breakpointFor } from '../src/hooks/breakpoints.js';
test('all requested widths select compact, medium or expanded without orientation locking', () => {
 for (const width of [360,390,430,600,820,1024,1440]) {
  const actual = breakpointFor(width, 900);
  assert.equal(actual.size, width < 600 ? 'compact' : width < 1024 ? 'medium' : 'expanded');
  assert.equal(actual.landscape, width > 900);
 }
 assert.equal(breakpointFor(599,390).compact,true);
 assert.equal(breakpointFor(600,390).compact,false);
});
