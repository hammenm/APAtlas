import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL manquant : vérifie le fichier .env ou l'environnement du conteneur");
}

const client = postgres(url);

export const db = drizzle({ client });

/** À appeler en fin de script (scrapeur) pour libérer les connexions. */
export async function closeDb(): Promise<void> {
  await client.end();
}
