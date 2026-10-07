import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// Primary Database Pool (Port 5432 default)
const primaryConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host: process.env.DB_HOST || (process.platform === 'darwin' ? '/tmp' : 'localhost'),
      port: parseInt(process.env.DB_PORT || process.env.PGPORT || '5432', 10),
      user: process.env.DB_USER || process.env.PGUSER || process.env.USER || 'postgres',
      database: process.env.DB_NAME || process.env.PGDATABASE || 'ecom',
      max: 30,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    };

if (process.env.DB_PASSWORD) {
  primaryConfig.password = process.env.DB_PASSWORD;
}

export const pool = new Pool(primaryConfig);

pool.on('error', (err) => {
  console.error('Unexpected error on primary PostgreSQL client (port ' + primaryConfig.port + '):', err.message);
});

export const db = {
  pool,
  query: (text, params) => pool.query(text, params),
};

export default db;
