# Phase 1 Implementation Plan — Working Prototype (in-memory)

## Goal

Replace the proof-of-life `index.html` with a working vote/rank/add-name app backed by the WASM DB. No persistence — refresh resets state.

---

## Decisions

- **Single combined identity** — no voter tracking. The `voter` column is omitted from the schema; votes are anonymous. The ranking view has no James/Partner filter.
- **Gender filter** — included in Phase 1 on the ranking screen.
- **Pair selection** — driven by combined vote counts across all votes.
- **Visual tone** — clean and minimal: white background, simple typography, generous whitespace.
- **Vote layout** — two large buttons side by side; vote count below.
- **Navigation** — minimal header with app title left, `Vote · Rank · +` links right.
- **Ranking display** — position, name, gender tag, ELO score (integer).

---

## Deliverables

| File | What it does |
|---|---|
| `index.html` | Shell: layout, three screen divs, nav links |
| `app.js` | All logic: DB init, seed, ELO, pair selection, vote handler, ranking view, add-name |
| `names.js` | Exported array of seed names `[{ name, gender }]` |

No build step. ES modules, imported via `<script type="module">`.

---

## Layout

```
┌──────────────────────────────┐
│ First Past the Peach         │
│              Vote · Rank · + │
├──────────────────────────────┤
│                              │
│     ... screen content ...   │
│                              │
└──────────────────────────────┘
```

Header is fixed; nav links call `show(id)` to swap the active section.

## Screens

Three mutually exclusive `<section>` divs toggled by `show(id)`:

### `#vote`
```
┌───────────────────────────────┐
│                               │
│   ┌──────────┐  ┌──────────┐  │
│   │          │  │          │  │
│   │  Alice   │  │  Robin   │  │
│   │          │  │          │  │
│   └──────────┘  └──────────┘  │
│                               │
│        12 votes cast          │
└───────────────────────────────┘
```

### `#rank`
Gender filter tabs: **All · F · M · N**

```
  1   Alice        [f]  1087
  2   Robin        [n]  1043
  3   Sophia       [f]  1021
  4   Bob          [m]   965
```

### `#add`
Text input, gender radio (F / M / N), Submit button. Redirects to `#vote` on success.

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
    voted_at  INTEGER  -- unix timestamp
);
```

No `voter` column — votes are anonymous.

---

## DB initialisation (`app.js`)

```js
await init();
const db = new Database();

db.execute(`CREATE TABLE names (...)`);
db.execute(`CREATE TABLE votes (...)`);

for (const { name, gender } of SEED_NAMES) {
    db.execute(`INSERT INTO names (name, gender, source)
                VALUES ('${esc(name)}', '${gender}', 'seed')`);
}
```

---

## Pair selection

Pick the two names with the fewest total votes (wins + losses combined). Ties broken randomly.

```
function pickPair():
    all names → Map<id, count>  (initialised to 0)
    db.query(`SELECT winner_id, loser_id FROM votes`)
        → for each row: increment counts[winner_id] and counts[loser_id]
    sort names by count ASC, shuffle equal-count names
    return [names[0], names[1]]
```

---

## Vote handler

```
function castVote(winnerId, loserId):
    db.execute(`INSERT INTO votes (winner_id, loser_id, voted_at)
                VALUES (${winnerId}, ${loserId}, ${Date.now()})`)
    renderVoteScreen()
```

---

## ELO engine

Pure JS, computed on demand from the full votes log. K=32, starting score=1000.

```
function computeElo():
    scores = Map<id, float>  initialised to 1000 for all names
    votes = db.query(`SELECT winner_id, loser_id FROM votes ORDER BY voted_at`)
    for each [winner, loser]:
        ew = 1 / (1 + 10^((scores[loser] - scores[winner]) / 400))
        scores[winner] += 32 * (1 - ew)
        scores[loser]  += 32 * (0 - (1 - ew))
    return scores
```

---

## Ranking view

1. `computeElo()` → `scores`
2. `db.query('SELECT id, name, gender FROM names')` → rows
3. Filter rows by active gender tab (`all` / `f` / `m` / `n`)
4. Sort by `scores[id]` descending
5. Render as `<table>`: #, Name, Gender, Score (integer)
6. Gender tab click re-renders in place

---

## Add-name screen

```
function addName(name, gender):
    db.execute(`INSERT INTO names (name, gender, source)
                VALUES ('${esc(name)}', '${gender}', 'wildcard')`)
    show('vote')
```

Validation: non-empty name, one of `f / m / n` selected.

---

## SQL injection guard

```js
function esc(s) { return s.replace(/'/g, "''"); }
```

Applied to all user-supplied strings before interpolation.

---

## Task checklist

- [ ] Write `names.js` — ~50 seed names covering f/m/n
- [ ] Scaffold `index.html` — three sections, nav, import `app.js`
- [ ] DB init + schema + seed in `app.js`
- [ ] `pickPair()` — least-compared heuristic
- [ ] Vote screen render + `castVote()`
- [ ] `computeElo()` function
- [ ] Ranking view render + gender filter tabs
- [ ] Add-name screen + `addName()`
- [ ] Manual smoke test: vote several times, check ranking updates, add a wildcard name, check it appears in rotation

---

## Out of scope for Phase 1

- Persistence (`S3PageStorage`) — Phase 2
- Mobile-optimised styling — Phase 3
- Stats view, export, smarter pair selection — Phase 3
- `Database.withStorage` — not yet implemented upstream
