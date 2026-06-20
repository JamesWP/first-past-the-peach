import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initSync, Database } from './vendor/database/database.js';
import { SEED_NAMES } from './names.js';
import { createSchema, ensureExcludedTable, seedNames, nextId, pickPair, recordVote, computeElo, addName, getExcludedIds, excludeName, includeName } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
initSync(readFileSync(join(__dirname, 'vendor/database/database_bg.wasm')));

const PAGE_SIZE = 4096;

class PageStorageProvider {
  constructor(blob) {
    if (blob && blob.length > 0) {
      const count = Math.floor(blob.length / PAGE_SIZE);
      this._pages = Array.from({ length: count }, (_, i) =>
        blob.slice(i * PAGE_SIZE, (i + 1) * PAGE_SIZE)
      );
    } else {
      this._pages = [];
    }
  }
  pageCount() { return this._pages.length; }
  setPageCount(n) {
    while (this._pages.length < n) this._pages.push(new Uint8Array(PAGE_SIZE));
    this._pages.length = n;
  }
  readPage(n) { return this._pages[n]; }
  writePage(n, data) { this._pages[n] = data.slice(); }
  flush() {}
  toBlob() {
    const buf = new Uint8Array(this._pages.length * PAGE_SIZE);
    this._pages.forEach((p, i) => buf.set(p, i * PAGE_SIZE));
    return buf;
  }
}

function makeDB() {
  const db = new Database();
  createSchema(db);
  return db;
}

function makeStoredDB() {
  const provider = new PageStorageProvider(null);
  const db = Database.withStorage(provider);
  createSchema(db);
  return { db, provider };
}

test('schema and sequences create without error', () => {
  const db = makeDB();
  db.free();
});

test('seed names insert without error', () => {
  const db = makeDB();
  seedNames(db, SEED_NAMES);
  const [[count]] = db.query('SELECT COUNT(*) FROM names');
  assert.equal(Number(count), SEED_NAMES.length);
  db.free();
});

test('nextId increments correctly', () => {
  const db = makeDB();
  const a = Number(nextId(db, 'names'));
  const b = Number(nextId(db, 'names'));
  const c = Number(nextId(db, 'names'));
  assert.equal(b, a + 1);
  assert.equal(c, a + 2);
  db.free();
});

test('pickPair returns two distinct named entries', () => {
  const db = makeDB();
  seedNames(db, SEED_NAMES);
  const [a, b] = pickPair(db);
  assert.ok(a.name, `a.name should be defined, got: ${a.name}`);
  assert.ok(b.name, `b.name should be defined, got: ${b.name}`);
  assert.notEqual(a.id, b.id);
  db.free();
});

test('pickPair never pairs m with f', () => {
  const db = makeDB();
  seedNames(db, SEED_NAMES);
  for (let i = 0; i < 100; i++) {
    const [a, b] = pickPair(db);
    const genders = new Set([
      db.query(`SELECT gender FROM names WHERE id = ${a.id}`)[0][0],
      db.query(`SELECT gender FROM names WHERE id = ${b.id}`)[0][0],
    ]);
    assert.ok(
      !(genders.has('m') && genders.has('f')),
      `Paired m with f: ${a.name} vs ${b.name}`
    );
  }
  db.free();
});

test('recordVote inserts and pickPair still works', () => {
  const db = makeDB();
  seedNames(db, SEED_NAMES);
  const [a, b] = pickPair(db);
  recordVote(db, a.id, b.id);
  const [[total]] = db.query('SELECT COUNT(*) FROM votes');
  assert.equal(Number(total), 1);
  const [c, d] = pickPair(db);
  assert.ok(c.name);
  assert.ok(d.name);
  db.free();
});

test('computeElo returns scores for all names', () => {
  const db = makeDB();
  seedNames(db, SEED_NAMES);
  const [a, b] = pickPair(db);
  recordVote(db, a.id, b.id);
  const scores = computeElo(db);
  assert.equal(scores.size, SEED_NAMES.length);
  assert.ok(scores.get(a.id) > 1000, 'winner score should increase');
  assert.ok(scores.get(b.id) < 1000, 'loser score should decrease');
  db.free();
});

test('addName inserts a wildcard name', () => {
  const db = makeDB();
  seedNames(db, SEED_NAMES);
  addName(db, 'Zephyr', 'n');
  const [[count]] = db.query(`SELECT COUNT(*) FROM names WHERE name = 'Zephyr'`);
  assert.equal(Number(count), 1);
  db.free();
});

test('excludeName removes name from pickPair candidates', () => {
  const db = makeDB();
  addName(db, 'Alpha', 'n');
  addName(db, 'Beta', 'n');
  addName(db, 'Gamma', 'n');
  const [[excludedId]] = db.query(`SELECT id FROM names WHERE name = 'Alpha'`);
  excludeName(db, excludedId);
  for (let i = 0; i < 20; i++) {
    const [a, b] = pickPair(db);
    assert.notEqual(a.id, excludedId, 'excluded name should not appear in pair');
    assert.notEqual(b.id, excludedId, 'excluded name should not appear in pair');
  }
  db.free();
});

test('includeName restores name to pickPair candidates', () => {
  const db = makeDB();
  addName(db, 'Alpha', 'n');
  addName(db, 'Beta', 'n');
  addName(db, 'Gamma', 'n');
  const [[targetId]] = db.query(`SELECT id FROM names WHERE name = 'Alpha'`);
  excludeName(db, targetId);
  includeName(db, targetId);
  const seen = new Set();
  for (let i = 0; i < 30; i++) {
    const [a, b] = pickPair(db);
    seen.add(a.id);
    seen.add(b.id);
  }
  assert.ok(seen.has(targetId), 're-included name should appear in pairs');
  db.free();
});

test('getExcludedIds returns current exclusion set', () => {
  const db = makeDB();
  addName(db, 'Alpha', 'n');
  addName(db, 'Beta', 'n');
  const [[idA]] = db.query(`SELECT id FROM names WHERE name = 'Alpha'`);
  const [[idB]] = db.query(`SELECT id FROM names WHERE name = 'Beta'`);
  assert.equal(getExcludedIds(db).size, 0);
  excludeName(db, idA);
  assert.ok(getExcludedIds(db).has(idA));
  assert.ok(!getExcludedIds(db).has(idB));
  includeName(db, idA);
  assert.equal(getExcludedIds(db).size, 0);
  db.free();
});

test('pickPair returns null when fewer than 2 active names', () => {
  const db = makeDB();
  addName(db, 'Alpha', 'n');
  addName(db, 'Beta', 'n');
  const [[idA]] = db.query(`SELECT id FROM names WHERE name = 'Alpha'`);
  const [[idB]] = db.query(`SELECT id FROM names WHERE name = 'Beta'`);
  excludeName(db, idA);
  excludeName(db, idB);
  assert.equal(pickPair(db), null);
  db.free();
});

test('ensureExcludedTable is idempotent on a fresh db', () => {
  const db = makeDB();
  ensureExcludedTable(db);
  const [[count]] = db.query(`SELECT COUNT(*) FROM db_schema WHERE type = 'table' AND name = 'excluded'`);
  assert.equal(Number(count), 1);
  db.free();
});

test('ensureExcludedTable creates excluded table when missing', () => {
  const db = new Database();
  db.execute(`CREATE TABLE sequences (name TEXT PRIMARY KEY, next_val INTEGER)`);
  db.execute(`CREATE TABLE names (id INTEGER PRIMARY KEY, name TEXT NOT NULL, gender TEXT, source TEXT)`);
  db.execute(`CREATE TABLE votes (id INTEGER PRIMARY KEY, winner_id INTEGER, loser_id INTEGER, voted_at INTEGER)`);
  ensureExcludedTable(db);
  const [[count]] = db.query(`SELECT COUNT(*) FROM db_schema WHERE type = 'table' AND name = 'excluded'`);
  assert.equal(Number(count), 1);
  db.free();
});

test('exclusion survives flush → blob → reload round-trip', () => {
  const { db, provider } = makeStoredDB();
  addName(db, 'Alpha', 'n');
  addName(db, 'Beta', 'n');
  const [[idA]] = db.query(`SELECT id FROM names WHERE name = 'Alpha'`);
  excludeName(db, idA);
  db.flush();
  const blob = provider.toBlob();

  // reload from blob
  const provider2 = new PageStorageProvider(blob);
  const db2 = Database.withStorage(provider2);
  const excluded = getExcludedIds(db2);
  assert.ok(excluded.has(idA), `excluded table should contain id ${idA} after reload`);
  db.free();
  db2.free();
});

test('exclusion survives flush → blob → reload round-trip with migration', () => {
  // Simulate an existing DB that predates the excluded table
  const { db: oldDb, provider: oldProvider } = makeStoredDB();
  addName(oldDb, 'Alpha', 'n');
  addName(oldDb, 'Beta', 'n');
  // Remove excluded table to simulate pre-feature DB
  oldDb.execute(`DROP TABLE excluded`);
  oldDb.flush();
  const oldBlob = oldProvider.toBlob();
  oldDb.free();

  // Load "old" DB and migrate
  const provider2 = new PageStorageProvider(oldBlob);
  const db2 = Database.withStorage(provider2);
  ensureExcludedTable(db2);
  const [[idA]] = db2.query(`SELECT id FROM names WHERE name = 'Alpha'`);
  excludeName(db2, idA);
  db2.flush();
  const blob2 = provider2.toBlob();
  db2.free();

  // Reload again and check
  const provider3 = new PageStorageProvider(blob2);
  const db3 = Database.withStorage(provider3);
  ensureExcludedTable(db3);
  const excluded = getExcludedIds(db3);
  assert.ok(excluded.has(idA), `exclusion should survive migration + reload`);
  db3.free();
});
