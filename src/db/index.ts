/**
 * Database client setup with Drizzle ORM and PostgreSQL
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20, // Connection pool size for concurrent sessions (SC-009)
});

export const db = drizzle(pool, { schema });
export type Database = typeof db;
