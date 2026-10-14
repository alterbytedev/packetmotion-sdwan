import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import SwaggerParser from '@apidevtools/swagger-parser';

test('inventory OpenAPI is valid and matches implemented protected methods', async () => {
  const spec = await SwaggerParser.validate('../api/openapi.yaml', { resolve: { external: false } });
  const branding = spec.paths['/api/branding/logo'];
  const brandingRoute = readFileSync('src/app/api/branding/logo/route.ts', 'utf8');
  for (const method of ['get', 'put', 'delete']) assert.match(brandingRoute, new RegExp(`export async function ${method.toUpperCase()}\\(`));
  assert.equal(branding.get.security, undefined);
  assert.deepEqual(branding.put.security, [{ operatorSession: [] }]);
  assert.deepEqual(branding.delete.security, [{ operatorSession: [] }]);
  assert.match(branding.put.description, /Superadmin only/);
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
