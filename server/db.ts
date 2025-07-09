import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "../shared/schema.js";

neonConfig.webSocketConstructor = ws;

if (!process.env.DATABASE_URL) {
  console.warn("DATABASE_URL not set. Application will fall back to memory storage.");
}

export const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/toko_dev' 
});
export const db = drizzle({ client: pool, schema });