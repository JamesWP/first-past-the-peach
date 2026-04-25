# First Past the Peach — High-Level Project Plan

## What we're building

A web app for two people to collaboratively rank baby names through pairwise comparison. Each session presents two names; you pick the one you prefer. Over many rounds, an ELO scoring system builds a ranked list reflecting your shared taste. Results persist across devices via cloud storage.

---

## Core loop

1. App loads → fetches shared database from cloud storage → initialises WASM SQL engine
2. Select two names using a "least compared" heuristic (so all names get seen fairly)
3. User picks a winner → vote written to in-memory DB
4. DB flushed to cloud storage
5. Repeat. View the running ranking at any time.

---

## Architecture

```
Browser (James)               Browser (Partner)
┌──────────────────┐         ┌──────────────────┐
│  HTML/CSS/JS UI  │         │  HTML/CSS/JS UI  │
│  ELO scoring JS  │         │  ELO scoring JS  │
│  WASM DB engine  │         │  WASM DB engine  │
│  PageStorage[]   │         │  PageStorage[]   │
└────────┬─────────┘         └────────┬─────────┘
     startup │ flush()            startup │ flush()
     (fetch) │ (upload)           (fetch) │ (upload)
             ▼                           ▼
               S3-compatible store
               (single shared DB blob)
```

The WASM database runs entirely in the browser. On startup the full DB blob is fetched from S3 and split into 4096-byte pages; a `PageStorageProvider` serves these from an in-memory array. `flush()` serialises all pages back into one blob and uploads it. S3 is only touched at load and flush time — no page-level remote I/O.

The storage interface the DB expects:

```ts
export interface PageStorageProvider {
    pageCount(): number;
    setPageCount(n: number): void;
    readPage(n: number): Uint8Array;   // exactly 4096 bytes
    writePage(n: number, data: Uint8Array): void;
    flush(): void;
}

export class Database {
    constructor();                             // in-memory, ephemeral
    static withStorage(p: PageStorageProvider): Database;
    execute(sql: string): string;
    query(sql: string): any[][];
    free(): void;
}
```

---

## Key components

| Component | Description |
|---|---|
| **Name dataset** | Initial list seeded into DB on first run; additional names addable via UI text box (`source = 'wildcard'`) |
| **Frontend** | Plain HTML/CSS/JS — vote screen, ranking screen, add-name screen |
| **ELO engine** | Pure JS — K=32, starting score 1000, standard formula, computed on demand from votes |
| **WASM DB** | SQL engine (`/home/james/gits/database`) for storing names and vote history |
| **Persistence** | `S3PageStorage` implementing `PageStorageProvider`; full blob upload on `flush()` after each vote |
| **Cloud storage** | S3-compatible bucket (Cloudflare R2 recommended — free tier, no egress fees) |

---

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

ELO scores are never stored — they are recomputed from the votes log on demand. The ranking view offers three filters: **James only**, **Partner only**, **Combined**. This keeps the DB as a pure event log with no denormalised state to go stale.

---

## Multi-device sync

Both devices share a single DB blob in S3. **Last write wins.** The flow per vote:

1. User picks a winner
2. Vote inserted into in-memory DB
3. `db.flush()` → full blob PUT to S3

For two people voting at low frequency this is acceptable; worst-case data loss is one vote. A future improvement could use an ETag / `If-Match` check to detect concurrent writes.

---

## Phased delivery

### Phase 1 — Working prototype (in-memory only)

- Plain HTML/JS: vote screen, ranking screen, add-name screen
- WASM DB integrated; schema created and names seeded on first load
- ELO computed from votes; filter by James / Partner / Combined
- Names addable via UI text box at any time
- No persistence — refresh resets state

### Phase 2 — Persistence via S3

- Implement `S3PageStorage`:
  - constructor: fetch blob from S3, slice into 4096-byte pages
  - `readPage` / `writePage`: operate on in-memory `Uint8Array[]`
  - `flush()`: concatenate pages, PUT to S3
- Replace `new Database()` with `Database.withStorage(new S3PageStorage(...))`
- App survives refresh; both devices share state
- Optional: ETag check to guard against concurrent writes

### Phase 3 — Polish

- Mobile-first styling
- Stats view: most contested matches, agreement rate between voters
- Smarter pair selection: deprioritise recently seen pairs
- Gender filter on ranking view
- Export shortlist

---

## Open questions (to resolve before Phase 2)

1. **S3 provider** — Cloudflare R2, AWS S3, or something else?
2. **Name seed list** — ONS data, custom curated list, or something else?
3. **Auth / privacy** — public bucket URL or access-controlled with a signing proxy?
4. **`Database.withStorage` / `flush()` status** — are these implemented in the database project yet, or to be built alongside Phase 2?
