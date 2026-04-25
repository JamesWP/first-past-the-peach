import init, { Database } from './vendor/database/database.js';
import { SEED_NAMES } from './names.js';
import { createSchema, seedNames, pickPair, recordVote, computeElo, addName } from './db.js';

let db;
let activeGender = 'all';

async function initDB() {
  await init();
  db = new Database();
  createSchema(db);
  seedNames(db, SEED_NAMES);
}

function castVote(winnerId, loserId) {
  recordVote(db, winnerId, loserId);
  renderVoteScreen();
}

function renderVoteScreen() {
  const [a, b] = pickPair(db);
  const [[total]] = db.query('SELECT COUNT(*) FROM votes');

  const pairEl = document.getElementById('vote-pair');
  pairEl.innerHTML = '';
  for (const [candidate, opponent] of [[a, b], [b, a]]) {
    const btn = document.createElement('button');
    btn.className = 'vote-btn';
    btn.textContent = candidate.name;
    btn.onclick = () => castVote(candidate.id, opponent.id);
    pairEl.appendChild(btn);
  }
  document.getElementById('vote-count').textContent =
    `${total} vote${total === 1 ? '' : 's'} cast`;
}

function renderRankScreen() {
  const scores = computeElo(db);
  let rows = db.query('SELECT id, name, gender FROM names');
  if (activeGender !== 'all') rows = rows.filter(([, , g]) => g === activeGender);
  rows.sort((a, b) => (scores.get(b[0]) ?? 1000) - (scores.get(a[0]) ?? 1000));

  const tabs = document.getElementById('filter-tabs');
  tabs.innerHTML = '';
  for (const [label, value] of [['All', 'all'], ['F', 'f'], ['M', 'm'], ['N', 'n']]) {
    const btn = document.createElement('button');
    btn.className = 'filter-tab' + (activeGender === value ? ' active' : '');
    btn.textContent = label;
    btn.onclick = () => { activeGender = value; renderRankScreen(); };
    tabs.appendChild(btn);
  }

  const tbody = document.querySelector('#rank-table tbody');
  tbody.innerHTML = '';
  rows.forEach(([id, name, gender], i) => {
    const tr = document.createElement('tr');
    for (const text of [i + 1, name, `[${gender ?? '?'}]`, Math.round(scores.get(id) ?? 1000)]) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  });
}

function setupAddForm() {
  document.getElementById('add-form').onsubmit = (e) => {
    e.preventDefault();
    const nameVal = document.getElementById('add-name').value.trim();
    const genderVal = e.target.querySelector('input[name="gender"]:checked')?.value;
    const errorEl = document.getElementById('add-error');
    if (!nameVal) { errorEl.textContent = 'Name is required.'; return; }
    if (!genderVal) { errorEl.textContent = 'Please select a gender.'; return; }
    errorEl.textContent = '';
    addName(db, nameVal, genderVal);
    e.target.reset();
    showSection('vote');
  };
}

function showSection(id) {
  document.querySelectorAll('section').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.querySelectorAll('nav a').forEach(a => a.classList.remove('active'));
  document.getElementById('nav-' + id).classList.add('active');
  if (id === 'vote') renderVoteScreen();
  if (id === 'rank') renderRankScreen();
}

window.showSection = showSection;

await initDB();
renderVoteScreen();
setupAddForm();
