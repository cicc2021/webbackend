import { PrismaPg } from '@prisma/adapter-pg';
import { DatabaseConfig } from '../config/configuration';

/** Shared by the Nest service and CLI scripts, so both connect the same way. */
export function createAdapter({ url, ssl }: DatabaseConfig) {
  const sslOption = ssl === 'false' ? undefined : { rejectUnauthorized: ssl === 'verify' };
  // An sslmode in the URL would override the ssl option in node-postgres; Migrate still reads it.
  const connectionString = ssl === 'false' ? url : url.replace(/([?&])sslmode=[^&]*&?/, '$1').replace(/[?&]$/, '');
  return new PrismaPg({ connectionString, ssl: sslOption });
}
