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
  const operators = spec.paths['/api/operator/operators'];
  const operatorsRoute = readFileSync('src/app/api/operator/operators/route.ts', 'utf8');
  for (const method of ['get', 'post']) {
    assert.ok(operators[method]);
    assert.match(operatorsRoute, new RegExp(`export function ${method.toUpperCase()}\\(`));
    assert.deepEqual(operators[method].security, [{ operatorSession: [] }]);
    assert.ok(operators[method].responses['401']);
    assert.ok(operators[method].responses['403']);
  }
  assert.match(operators.post.description, /Superadmins may create admins or viewers; admins may create viewers only/);
  const device = spec.paths['/api/operator/nodes/{id}'];
  const deviceRoute = readFileSync('src/app/api/operator/nodes/[id]/route.ts', 'utf8');
  for (const method of ['patch', 'delete']) {
    assert.ok(device[method]);
    assert.match(deviceRoute, new RegExp(`export function ${method.toUpperCase()}\\(`));
    assert.deepEqual(device[method].security, [{ operatorSession: [] }]);
    assert.ok(device[method].responses['401']);
    assert.ok(device[method].responses['403']);
  }
  assert.match(device.delete.description, /WireGuard address\/port reservations are retained/);
  const httpHosts = spec.paths['/api/operator/controller-settings/insecure-http-hosts'];
  const httpHostsRoute = readFileSync('src/app/api/operator/controller-settings/insecure-http-hosts/route.ts', 'utf8');
  for (const method of ['get', 'put']) {
    assert.ok(httpHosts[method]);
    assert.match(httpHostsRoute, new RegExp(`export function ${method.toUpperCase()}\\(`));
    assert.deepEqual(httpHosts[method].security, [{ operatorSession: [] }]);
    assert.ok(httpHosts[method].responses['401']);
    assert.ok(httpHosts[method].responses['403']);
  }
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

test('WireGuard contracts preserve device scope and separate receipt from apply', async () => {
  const spec = await SwaggerParser.validate('../api/openapi.yaml', { resolve: { external: false } });
  for (const endpoint of ['wireguard-key', 'wireguard-status']) {
    assert.deepEqual(spec.paths[`/api/agent/v1/${endpoint}`].post.security, [{ deviceCertificate: [] }]);
  }
  assert.deepEqual(spec.components.schemas.DeviceConfig.properties.schemaVersion.enum, [1, 2]);
  assert.deepEqual(spec.components.schemas.WireguardStatusInput.properties.status.enum, ['disabled', 'applied', 'failed']);
  assert.equal(spec.components.schemas.WireguardEdgeInput.properties.hubIds.maxItems, 8);
  assert.match(spec.paths['/api/operator/controller-settings/tunnels'].put.description, /Superadmin only/);
});
