/** `npm run test:e2e:cleanup`: restore the database after an interrupted run (snapshot if present, else e2e markers only). */
import { closeDb } from "./db";
import { cleanupDatabase } from "./cleanup";

cleanupDatabase()
  .then((r) => { console.log(JSON.stringify(r, null, 2)); if (r.leakedTotal) process.exitCode = 1; })
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => closeDb());
