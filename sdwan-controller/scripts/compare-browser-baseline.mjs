import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

// Same OS/browser/font stack only. Compare login and navigation header chrome; page copy and inventory content are intentionally editable.
const regions = [
  { name: 'login-desktop', x: 0, y: 0, width: 1440, height: 900 },
  { name: 'login-mobile', x: 0, y: 0, width: 390, height: 750 },
  { name: 'overview-desktop', x: 248, y: 0, width: 1192, height: 72 },
  { name: 'overview-mobile', x: 0, y: 0, width: 390, height: 72 },
];
const results = [];
for (const region of regions) {
  const before = PNG.sync.read(readFileSync(`../docs/evidence/browser/baseline/${region.name}.png`));
  const after = PNG.sync.read(readFileSync(`../docs/evidence/browser/${region.name}.png`));
  let changed = 0;
  assert.ok(before.width >= region.x + region.width && after.width >= region.x + region.width);
  assert.ok(before.height >= region.y + region.height && after.height >= region.y + region.height);
  for (let y = region.y; y < region.y + region.height; y++) {
    for (let x = region.x; x < region.x + region.width; x++) {
      const first = (before.width * y + x) * 4;
      const second = (after.width * y + x) * 4;
      if (before.data.subarray(first, first + 4).compare(after.data.subarray(second, second + 4))) changed++;
    }
  }
  results.push({ ...region, changedPixels: changed });
  console.log(`${region.name}: ${changed} changed pixels in protected region`);
}
writeFileSync('../docs/evidence/browser/protected-region-comparison.json', JSON.stringify({ scope: 'same local Chromium/OS; excludes development overlay and intentional inventory content', results }, null, 2) + '\n');
assert.ok(results.every((result) => result.changedPixels === 0), 'Protected region changed; inspect evidence before accepting.');
