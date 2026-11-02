import 'server-only';
import { getDatabase } from '../db';
import { authorize, authorizeSuperadmin, FabricError } from './authorization';
import { mutate } from './inventory';
import { lockTopology, publishWireguardPlans } from './wireguard-plan';
import { transitRulesInput } from './transit-validation';
import { tunnelObject, tunnelVersion } from './wireguard-validation';
import type { Actor } from './types';

const LAN_PREFIXES = `SELECT DISTINCT l.advertised_prefix::text AS prefix FROM lan_profiles l
  JOIN nodes n ON n.id=l.node_id WHERE n.revoked_at IS NULL ORDER BY 1`;

export async function readTransitPolicy(actor: Actor | null) {
  authorize(actor);
  const database = getDatabase();
  const policy = await database.query('SELECT rules,draft_rules AS "draftRules",version FROM transit_policy');
  const lans = await database.query(LAN_PREFIXES);
  return { ...policy.rows[0], lanPrefixes: lans.rows.map((row) => row.prefix) };
}

export async function saveTransitDraft(actor: Actor | null, value: unknown) {
  authorizeSuperadmin(actor);
  const input = transitRulesInput(value);
  return mutate(actor, async (client, fresh) => {
    authorizeSuperadmin(fresh);
    await lockTopology(client);
    const prior = await client.query('SELECT version FROM transit_policy FOR UPDATE');
    if (prior.rows[0].version !== input.expectedVersion)
      throw new FabricError(409, 'Transit policy changed; reload and retry.');
    // Only saved LAN prefixes may be named; management and underlay networks never qualify.
    const lans = new Set((await client.query(LAN_PREFIXES)).rows.map((row) => row.prefix));
    for (const rule of input.rules)
      if (!lans.has(rule.source) || !lans.has(rule.destination))
        throw new FabricError(400, 'Rules may only name saved device LAN prefixes.');
    const version = input.expectedVersion + 1;
    await client.query('UPDATE transit_policy SET draft_rules=$1,version=$2,updated_at=now()',
      [JSON.stringify(input.rules), version]);
    await client.query("INSERT INTO audit_events(actor_id,actor_email,action,resource_id) VALUES($1,$2,'transit.draft_saved',$3)",
      [fresh.id, fresh.email, '00000000-0000-0000-0000-000000000011']);
    return { saved: true, version };
  });
}

export async function deployTransitDraft(actor: Actor | null, value: unknown) {
  authorizeSuperadmin(actor);
  const input = tunnelObject(value, ['expectedVersion']);
  const expectedVersion = tunnelVersion(input.expectedVersion);
  return mutate(actor, async (client, fresh) => {
    authorizeSuperadmin(fresh);
    await lockTopology(client);
    const prior = await client.query('SELECT version,draft_rules FROM transit_policy FOR UPDATE');
    // A retried completed deployment must not create another revision.
    if (!prior.rows[0].draft_rules) return { deployed: false, message: 'No unpublished changes.' };
    if (prior.rows[0].version !== expectedVersion)
      throw new FabricError(409, 'Transit policy changed; reload and review the draft before deploying.');
    const version = expectedVersion + 1;
    await client.query('UPDATE transit_policy SET rules=draft_rules,draft_rules=NULL,version=$1,updated_at=now()', [version]);
    await client.query("INSERT INTO audit_events(actor_id,actor_email,action,resource_id) VALUES($1,$2,'transit.deployed',$3)",
      [fresh.id, fresh.email, '00000000-0000-0000-0000-000000000011']);
    const nodes = await client.query(
      'SELECT l.node_id FROM lan_profiles l JOIN nodes n ON n.id=l.node_id WHERE n.revoked_at IS NULL');
    const nodeIds = nodes.rows.map((row) => row.node_id);
    await publishWireguardPlans(client, nodeIds, fresh.email);
    return { deployed: true, version, affectedDeviceIds: nodeIds };
  });
}
