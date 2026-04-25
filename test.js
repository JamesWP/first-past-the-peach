import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initSync, Database } from './vendor/database/database.js';
import { SEED_NAMES } from './names.js';
import { createSchema, seedNames, nextId, pickPair, recordVote, computeElo, addName } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
initSync(readFileSync(join(__dirname, 'vendor/database/database_bg.wasm')));

function makeDB() {
  const db = new Database();
  createSchema(db);
  return db;
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
