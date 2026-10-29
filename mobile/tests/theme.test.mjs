import assert from 'node:assert/strict';
import { test } from 'node:test';
import tokens from '../src/theme/tokens.js';

function luminance(hex) {
  const [r, g, b] = hex.slice(1).match(/../g).map(part => parseInt(part, 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
test('operational palette keeps readable text and action labels at AA contrast', () => {
  const { colors } = tokens;
  for (const foreground of ['textPrimary', 'textSecondary', 'textMutedReadable', 'accentHi', 'warning']) {
    for (const background of ['bg', 'surface', 'surfaceHi']) {
      const a = luminance(colors[foreground]); const b = luminance(colors[background]);
      assert.ok((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5, `${foreground} on ${background}`);
    }
  }
  assert.ok((luminance(colors.accent) + 0.05) / (luminance(colors.textOnAccent) + 0.05) >= 4.5);
});
