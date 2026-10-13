import 'server-only';
import { Pool } from 'pg';

const globalDatabase = globalThis as typeof globalThis & {
  sdwanDatabase?: Pool;
};

// Create lazily so builds and liveness checks require no database connection.
export function getDatabase(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL must be configured for the controller');
  }

  if (!globalDatabase.sdwanDatabase) {
    globalDatabase.sdwanDatabase = new Pool({
      connectionString,
      max: 10,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
    });
  }

  return globalDatabase.sdwanDatabase;
}
