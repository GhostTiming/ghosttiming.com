import { Client } from "pg";
import { resetOperationsAndSyncCatalogRaces } from "../src/lib/crm/race-operations.ts";

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("BEGIN");
  const result = await resetOperationsAndSyncCatalogRaces(client);
  await client.query("COMMIT");
  console.log(JSON.stringify(result));
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
