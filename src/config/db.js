import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// Helper to identify mutating / write SQL queries
const isWriteQuery = (text) => {
  if (typeof text !== 'string') return false;
  const trimmed = text.trim().toUpperCase();
  return (
    trimmed.startsWith('INSERT') ||
    trimmed.startsWith('UPDATE') ||
    trimmed.startsWith('DELETE') ||
    trimmed.startsWith('CREATE') ||
    trimmed.startsWith('ALTER') ||
    trimmed.startsWith('DROP') ||
    trimmed.startsWith('TRUNCATE') ||
    trimmed.startsWith('BEGIN') ||
    trimmed.startsWith('COMMIT') ||
    trimmed.startsWith('ROLLBACK')
  );
};

// 1. Primary Database Pool (Port 5432 default)
const primaryConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host: process.env.DB_HOST || (process.platform === 'darwin' ? '/tmp' : 'localhost'),
      port: parseInt(process.env.DB_PORT || process.env.PGPORT || '5432', 10),
      user: process.env.DB_USER || process.env.PGUSER || process.env.USER || 'postgres',
      database: process.env.DB_NAME || process.env.PGDATABASE || 'ecom',
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    };

if (process.env.DB_PASSWORD) {
  primaryConfig.password = process.env.DB_PASSWORD;
}

export const pool = new Pool(primaryConfig);

pool.on('error', (err) => {
  console.error('Unexpected error on primary PostgreSQL client (port ' + primaryConfig.port + '):', err);
});

// 2. Secondary / Mirror Database Pool (Port 5434 default)
const isSecondaryEnabled =
  process.env.SECONDARY_DB_ENABLED === 'true' ||
  process.env.SECONDARY_DB_PORT !== undefined;

let secondaryPool = null;

if (isSecondaryEnabled) {
  const secondaryConfig = {
    host: process.env.SECONDARY_DB_HOST || 'localhost',
    port: parseInt(process.env.SECONDARY_DB_PORT || '5434', 10),
    user: process.env.SECONDARY_DB_USER || 'postgres',
    database: process.env.SECONDARY_DB_NAME || 'ecom',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  };

  if (process.env.SECONDARY_DB_PASSWORD) {
    secondaryConfig.password = process.env.SECONDARY_DB_PASSWORD;
  }

  secondaryPool = new Pool(secondaryConfig);

  secondaryPool.on('error', (err) => {
    console.error('Unexpected error on secondary PostgreSQL client (port ' + secondaryConfig.port + '):', err.message);
  });

  console.log(`[DB Mirroring] Initialized secondary database mirror on port ${secondaryConfig.port} (database: ${secondaryConfig.database})`);
}

// Wrap pool.connect to mirror transactional queries in controllers
const originalConnect = pool.connect.bind(pool);

pool.connect = async () => {
  const primaryClient = await originalConnect();
  if (!secondaryPool) return primaryClient;

  let secondaryClient = null;
  try {
    secondaryClient = await secondaryPool.connect();
  } catch (err) {
    console.warn('[DB Mirroring Warning] Could not connect to secondary DB client (port 5434):', err.message);
  }

  const origQuery = primaryClient.query.bind(primaryClient);
  const origRelease = primaryClient.release.bind(primaryClient);

  primaryClient.query = async (text, params) => {
    const isWrite = isWriteQuery(text);
    const primaryResultPromise = origQuery(text, params);

    if (secondaryClient && isWrite) {
      try {
        await secondaryClient.query(text, params);
      } catch (secErr) {
        console.warn('[DB Mirroring Warning] Failed transaction query on secondary DB:', secErr.message);
      }
    }

    return await primaryResultPromise;
  };

  primaryClient.release = (destroy) => {
    if (secondaryClient) {
      try {
        secondaryClient.release(destroy);
      } catch (_) {}
    }
    return origRelease(destroy);
  };

  return primaryClient;
};

// 3. Central DB query interface (Mirrors all mutating queries to secondary database)
export const db = {
  pool,
  secondaryPool,
  query: async (text, params) => {
    const isWrite = isWriteQuery(text);
    const primaryPromise = pool.query(text, params);

    if (secondaryPool && isWrite) {
      try {
        await secondaryPool.query(text, params);
      } catch (secErr) {
        console.warn('[DB Mirroring Warning] Failed to mirror query to secondary DB (port 5434):', secErr.message);
      }
    }

    return await primaryPromise;
  },
};

export default db;
