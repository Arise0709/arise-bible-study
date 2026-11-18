import { getDriver } from '../src/lib/db-driver';
import { migrate } from '../src/lib/migrate';

async function main() {
  const driver = await getDriver();
  // PGlite migrates on open; this call is then a no-op that reports status.
  await migrate(driver);
  await driver.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
