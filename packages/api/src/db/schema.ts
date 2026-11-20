import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const apStatus = pgEnum("ap_status", ["core_verified", "stable", "unstable"]);
export const moderationStatus = pgEnum("moderation_status", ["pending", "published", "hidden"]);
export const catalogSource = pgEnum("catalog_source", ["wiki", "sheet", "github", "manual"]);
export const linkKind = pgEnum("link_kind", [
  "info",
  "setup_guide",
  "options",
  "download",
  "repository",
  "community",
  "other",
]);

export const store = pgEnum("store", ["steam", "gog", "epic"]);

/* ------------------------------------------------------------------ */
/* Common columns                                                     */
/* ------------------------------------------------------------------ */

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const game = pgTable(
  "game",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),

    apStatus: apStatus("ap_status"),
    imageUrl: text("image_url"),

    moderationStatus: moderationStatus("moderation_status").notNull().default("pending"),

    ...timestamps,
  },
  (t) => [
    uniqueIndex("game_slug_idx").on(t.slug),
    index("game_moderation_idx").on(t.moderationStatus),
  ],
);

/* ------------------------------------------------------------------ */
/* Game source                                                        */
/* ------------------------------------------------------------------ */

export const gameSource = pgTable(
  "game_source",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),

    gameId: integer("game_id")
      .notNull()
      .references(() => game.id, { onDelete: "cascade" }),

    source: catalogSource("source").notNull(),
    externalId: text("external_id").notNull(),
    url: text("url"),
    revisionAt: timestamp("revision_at", { withTimezone: true }),

    ...timestamps,
  },
  (t) => [
    uniqueIndex("game_source_external_idx").on(t.source, t.externalId),
    index("game_source_game_idx").on(t.gameId),
  ],
);

/* ------------------------------------------------------------------ */
/* Links                                                              */
/* ------------------------------------------------------------------ */

export const gameLink = pgTable(
  "game_link",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),

    gameId: integer("game_id")
      .notNull()
      .references(() => game.id, { onDelete: "cascade" }),

    kind: linkKind("kind").notNull(),
    url: text("url").notNull(),

    ...timestamps,
  },
  (t) => [
    uniqueIndex("game_link_unique_idx").on(t.gameId, t.kind, t.url),
    index("game_link_game_idx").on(t.gameId),
  ],
);

/* ------------------------------------------------------------------ */
/* Store links                                                        */
/* ------------------------------------------------------------------ */

export const gameStoreMapping = pgTable(
  "game_store_mapping",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),

    gameId: integer("game_id")
      .notNull()
      .references(() => game.id, { onDelete: "cascade" }),

    store: store("store").notNull(),
    storeId: text("store_id").notNull(),

    validated: boolean("validated").notNull().default(false),

    ...timestamps,
  },
  (t) => [
    uniqueIndex("mapping_game_store_idx").on(t.gameId, t.store, t.storeId),
    index("mapping_store_lookup_idx").on(t.store, t.storeId),
  ],
);

export type Game = typeof game.$inferSelect;
export type NewGame = typeof game.$inferInsert;
export type GameSource = typeof gameSource.$inferSelect;
export type NewGameSource = typeof gameSource.$inferInsert;
export type GameLink = typeof gameLink.$inferSelect;
export type NewGameLink = typeof gameLink.$inferInsert;
export type GameStoreMapping = typeof gameStoreMapping.$inferSelect;
export type NewGameStoreMapping = typeof gameStoreMapping.$inferInsert;
