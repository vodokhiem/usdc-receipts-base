/** npm run db:migrate — apply ./drizzle migrations to DATABASE_URL. Run once per deploy. */
import { migrateDatabase } from "@/db";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
migrateDatabase(url).then(
  () => console.log("migrations applied"),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
