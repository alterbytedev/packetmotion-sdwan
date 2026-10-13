import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import SwaggerParser from '@apidevtools/swagger-parser';

test('inventory OpenAPI is valid and matches implemented protected methods', async () => {
  const spec = await SwaggerParser.validate('../api/openapi.yaml', { resolve: { external: false } });
  for (const resource of ['sites', 'nodes']) {
    const path = spec.paths[`/api/operator/${resource}`];
    const source = readFileSync(`src/app/api/operator/${resource}/route.ts`, 'utf8');
    for (const method of ['get', 'post']) {
      assert.ok(path[method]);
      assert.match(source, new RegExp(`export function ${method.toUpperCase()}\\(`));
      assert.deepEqual(path[method].security, [{ operatorSession: [] }]);
      assert.ok(path[method].responses['401']);
      assert.ok(path[method].responses['403']);
    }
  }
});
