# APAtlas

> Which Archipelago games can you play with what you already own?

APAtlas compares your game libraries (Steam, GOG, manual import…) with the catalog of games that have an [Archipelago](https://archipelago.gg) implementation, then helps you and your friends pick what to play together.

> APAtlas is a community project. It is not affiliated with the Archipelago project or its maintainers.

## Installing / Getting started

```shell
bun install
cp .env.example .env
docker compose up -d db
bun run db:migrate
bun run scrape
```

This installs the dependencies, starts PostgreSQL in Docker, creates the tables, then fills the catalog from the [Archipelago community wiki](https://archipelago.miraheze.org). The first scrape processes about 1,050 pages and takes a couple of minutes; later runs only process the pages changed since.

## Developing

### Built With

- [Bun](https://bun.sh) 1.3+
- [React Router](https://reactrouter.com) 8, framework mode
- [Hono](https://hono.dev), hosting React Router through [react-router-hono-server](https://github.com/rphlmr/react-router-hono-server) 3
- [better-auth](https://better-auth.com)
- [Drizzle ORM](https://orm.drizzle.team) with PostgreSQL 18

### Prerequisites

- [Bun](https://bun.sh/docs/installation)
- [Docker](https://docs.docker.com/get-docker/) with Docker Compose

### Setting up Dev

```shell
git clone https://github.com/cailloubleu/APAtlas.git
cd atlas/
bun install
```

The repository is a Bun workspace:

| Package | Role |
| --- | --- |
| `apps/web` | React Router app, mounted inside the Hono server |
| `apps/worker` | Wiki scraper |
| `packages/api` | Hono API (`@atlas/api`), database schema (`@atlas/api/db`) and business rules (`@atlas/api/domain`) |

Then start the database and the app:

```shell
docker compose up -d db
bun run db:migrate
bun run dev
```

### Building

```shell
bun run build
bun run start
```

`build` produces the React Router client and server bundles in `apps/web/build`, `start` serves them with Hono.

## Versioning

We use [SemVer](http://semver.org/) for versioning. For the versions available, see the tags on this repository.

## Configuration

All settings are read from the `.env` file at the root of the repository (see `.env.example`).

| Variable | Description |
| --- | --- |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Database credentials, used by Docker Compose |
| `DATABASE_URL` | Connection string for commands run from the host, using the port published by Docker Compose |
| `SCRAPER_USER_AGENT` | Identifies the scraper to the wiki; must include a way to contact you |
| `STEAM_API_KEY` | [Steam Web API key](https://steamcommunity.com/dev/apikey), used for library matching |
| `PORT` | Web server port, defaults to 3000 |

## Tests

No automated tests yet.

## Style guide

TypeScript in strict mode, checked with:

```shell
bun run typecheck
```

## Api Reference

Coming soon.

## Database

PostgreSQL 18, managed with [Drizzle ORM](https://orm.drizzle.team). The schema lives in `packages/api/src/db/schema.ts`.

| Table | Content |
| --- | --- |
| `game` | An Archipelago implementation: name, status, stability, image, flags (broken, free, 18+), moderation status |
| `game_source` | Where a game comes from (wiki, sheet, GitHub) |
| `game_link` | Info page, setup guide, options page, download, repository… |
| `tag` / `game_tag` | Search filters: genre, platform, developer, publisher, series, maintainer, feature |
| `game_store_mapping` | Game ↔ store product, used for library matching |

| Command | Description |
| --- | --- |
| `bun run db:generate` | Create a migration from changes in `schema.ts` |
| `bun run db:migrate` | Apply pending migrations |
| `bun run db:studio` | Browse the database in Drizzle Studio |
| `bun run scrape` | Sync the catalog from the wiki |
| `bun run scrape:full` | Re-process every wiki page |

## Licensing

To be defined.

Game data and box art come from the [Archipelago community wiki](https://archipelago.miraheze.org) and its contributors. Box art remains the property of its respective owners.
