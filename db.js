export function esc(s) { return s.replace(/'/g, "''"); }

export function nextId(db, table) {
  db.execute(`UPDATE sequences SET next_val = next_val + 1 WHERE name = '${table}'`);
  return db.query(`SELECT next_val FROM sequences WHERE name = '${table}'`)[0][0];
}

export function createSchema(db) {
  db.execute(`CREATE TABLE sequences (name TEXT PRIMARY KEY, next_val INTEGER)`);
  db.execute(`INSERT INTO sequences (name, next_val) VALUES ('names', 0)`);
  db.execute(`INSERT INTO sequences (name, next_val) VALUES ('votes', 0)`);
  db.execute(`CREATE TABLE names (
    id      INTEGER PRIMARY KEY,
    name    TEXT NOT NULL,
    gender  TEXT,
    source  TEXT
  )`);
  db.execute(`CREATE TABLE votes (
    id        INTEGER PRIMARY KEY,
    winner_id INTEGER,
    loser_id  INTEGER,
    voted_at  INTEGER
  )`);
  db.execute(`CREATE TABLE excluded (name_id INTEGER PRIMARY KEY)`);
}

export function ensureExcludedTable(db) {
  const rows = db.query(`SELECT name FROM db_schema WHERE type = 'table' AND name = 'excluded'`);
  if (rows.length === 0) {
    db.execute(`CREATE TABLE excluded (name_id INTEGER PRIMARY KEY)`);
    return true;
  }
  return false;
}

export function getExcludedIds(db) {
  return new Set(db.query('SELECT name_id FROM excluded').map(([id]) => id));
}

export function excludeName(db, nameId) {
  db.execute(`INSERT INTO excluded (name_id) VALUES (${nameId})`);
}

export function includeName(db, nameId) {
  db.execute(`DELETE FROM excluded WHERE name_id = ${nameId}`);
}

export function seedNames(db, names) {
  for (const { name, gender } of names) {
    const id = nextId(db, 'names');
    db.execute(`INSERT INTO names (id, name, gender, source) VALUES (${id}, '${esc(name)}', '${esc(gender)}', 'seed')`);
  }
}

export function compatible(gA, gB) {
  return !(gA === 'm' && gB === 'f') && !(gA === 'f' && gB === 'm');
}

export function pickPair(db) {
  const excludedIds = getExcludedIds(db);
  const nameRows = db.query('SELECT id, name, gender FROM names').filter(([id]) => !excludedIds.has(id));
  if (nameRows.length < 2) return null;
  const nameMap = new Map(nameRows.map(([id, name, gender]) => [id, { name, gender }]));
  const counts = new Map(nameRows.map(([id]) => [id, 0]));
  for (const [id, cnt] of db.query('SELECT winner_id, COUNT(*) FROM votes GROUP BY winner_id')) {
    if (counts.has(id)) counts.set(id, counts.get(id) + Number(cnt));
  }
  for (const [id, cnt] of db.query('SELECT loser_id, COUNT(*) FROM votes GROUP BY loser_id')) {
    if (counts.has(id)) counts.set(id, counts.get(id) + Number(cnt));
  }

  // Shuffle then stable-sort so ties are broken randomly
  const entries = [...counts.entries()];
  for (let i = entries.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [entries[i], entries[j]] = [entries[j], entries[i]];
  }
  entries.sort((a, b) => a[1] - b[1]);

  // Pick the least-compared name, then find its least-compared compatible partner
  const [idA] = entries[0];
  const genderA = nameMap.get(idA).gender;
  const [idB] = entries.slice(1).find(([id]) => compatible(genderA, nameMap.get(id).gender));
  return [
    { id: idA, name: nameMap.get(idA).name, gender: nameMap.get(idA).gender },
    { id: idB, name: nameMap.get(idB).name, gender: nameMap.get(idB).gender },
  ];
}

export function recordVote(db, winnerId, loserId) {
  const id = nextId(db, 'votes');
  db.execute(`INSERT INTO votes (id, winner_id, loser_id, voted_at) VALUES (${id}, ${winnerId}, ${loserId}, ${Date.now()})`);
}

export function computeElo(db) {
  const scores = new Map(db.query('SELECT id FROM names').map(([id]) => [id, 1000]));
  for (const [wid, lid] of db.query('SELECT winner_id, loser_id FROM votes ORDER BY voted_at')) {
    const sw = scores.get(wid) ?? 1000;
    const sl = scores.get(lid) ?? 1000;
    const ew = 1 / (1 + Math.pow(10, (sl - sw) / 400));
    scores.set(wid, sw + 32 * (1 - ew));
    scores.set(lid, sl + 32 * (0 - (1 - ew)));
  }
  return scores;
}

export function addName(db, name, gender) {
  const id = nextId(db, 'names');
  db.execute(`INSERT INTO names (id, name, gender, source) VALUES (${id}, '${esc(name)}', '${esc(gender)}', 'wildcard')`);
}
