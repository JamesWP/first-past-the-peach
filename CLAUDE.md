# First Past the Peach

A web app for two people to collaboratively rank baby names through pairwise comparison. Votes drive an ELO scoring system; the shared state persists as a SQLite blob in S3-compatible cloud storage.

## Architecture

- **Frontend**: Plain HTML/CSS/JS — no build step, no framework
- **DB engine**: WASM SQLite (`/home/james/gits/database`) compiled via wasm-pack, consumed from `vendor/database/`
- **Persistence**: Full DB blob fetched from S3 on load, PUT back after each vote (`S3PageStorage`)
- **Sync model**: Last write wins; both users share one blob

See `doc/plan.md` for the full design, phased delivery plan, and data model.

## Development

```sh
make vendor/database   # clone + compile + extract the WASM DB package
```

The vendor target is a prerequisite for running the app. There is no other build step — open `index.html` directly in a browser (or serve with any static file server).

## Key files (once created)

| Path | Purpose |
|---|---|
| `index.html` | Entry point; all CSS inline in `<style>` |
| `app.js` | Vote loop, ELO engine, S3 storage, keyboard shortcuts |
| `db.js` | SQL helpers: schema, seed, pickPair, recordVote, computeElo, addName |
| `names.js` | Seed name list (`SEED_NAMES`) |
| `vendor/database/` | wasm-pack output (`.wasm`, `.js`, `.d.ts`) |

## UI conventions

- No framework — all DOM manipulation via vanilla JS in `app.js`
- CSS lives entirely in `index.html` `<style>` block; no external stylesheet
- Keyboard shortcuts on vote screen: `←`/`→` arrows (shown as `.key-hint` inside each button) and `j`/`k` vim-style (shown as a `.vim-hint` below vote count in very light gray — intentionally subtle)

## Database CLI

A native CLI for testing SQL against the same SQLite implementation is available at:

```
~/gits/database/target/release/database
```

Use it to verify that a query is supported before using it in `app.js` or `test.js`.

Known unsupported features:
- `INTEGER PRIMARY KEY` autoincrement — use a `sequences` table
- `WHERE id IN (...)` — causes WASM panic
- `LEFT JOIN` — only plain `JOIN` (inner) is implemented
- Subqueries (inline and correlated)
- CTEs (`WITH ...`)
- Multi-table `JOIN` with `GROUP BY`

What works: `SELECT`, `JOIN` (inner), `GROUP BY`, `COUNT(*)`, `ORDER BY`, `UNION ALL` at top level.

## Database package interface

```ts
export class Database {
    constructor();                       // in-memory, ephemeral
    execute(sql: string): string;        // DDL / DML — returns status string
    query(sql: string): any[][];         // SELECT — returns array of row arrays
    free(): void;
}
```

`Database.withStorage(PageStorageProvider)` is planned but not yet implemented upstream.

## Data model

```sql
CREATE TABLE names (
    id      INTEGER PRIMARY KEY,
    name    TEXT NOT NULL,
    gender  TEXT,    -- 'f', 'm', 'n'
    source  TEXT     -- 'seed' | 'wildcard'
);

CREATE TABLE votes (
    id        INTEGER PRIMARY KEY,
    winner_id INTEGER,
    loser_id  INTEGER,
    voter     TEXT,    -- 'james' | 'partner'
    voted_at  INTEGER  -- unix timestamp
);
```

ELO scores are never stored — recomputed from the votes log on demand (K=32, start=1000).
