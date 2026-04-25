import init, { Database } from './vendor/database/database.js';
import { SEED_NAMES } from './names.js';
import { createSchema, seedNames, pickPair, recordVote, computeElo, addName } from './db.js';
import { loadS3Config, saveS3Config, testS3Connection } from './s3.js';

let db;
let activeGender = 'all';

async function initDB() {
  await init();
  db = new Database();
  createSchema(db);
  seedNames(db, SEED_NAMES);
}

function castVote(winnerId, loserId) {
  document.activeElement?.blur();
  recordVote(db, winnerId, loserId);
  renderVoteScreen();
}

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (document.activeElement?.matches('input, textarea, select')) return;
    if (!document.getElementById('vote').classList.contains('active')) return;

    const btns = document.querySelectorAll('#vote-pair .vote-btn');
    if (btns.length !== 2) return;

    let idx = -1;
    if (e.key === 'ArrowLeft' || e.key === 'j') idx = 0;
    if (e.key === 'ArrowRight' || e.key === 'k') idx = 1;
    if (idx === -1) return;

    e.preventDefault();
    btns[idx].classList.add('key-active');
    setTimeout(() => btns[idx].click(), 80);
  });
}

const KEY_HINTS = [['←', 'ArrowLeft'], ['→', 'ArrowRight']];

function renderVoteScreen() {
  const [a, b] = pickPair(db);
  const [[total]] = db.query('SELECT COUNT(*) FROM votes');

  const pairEl = document.getElementById('vote-pair');
  pairEl.innerHTML = '';
  for (const [[candidate, opponent], [label]] of [[[a, b], KEY_HINTS[0]], [[b, a], KEY_HINTS[1]]]) {
    const btn = document.createElement('button');
    const colorKey = candidate.gender !== 'n' ? candidate.gender
      : opponent.gender !== 'n' ? opponent.gender : 'y';
    btn.className = `vote-btn vote-btn--${colorKey}`;
    btn.textContent = candidate.name;
    btn.onclick = () => castVote(candidate.id, opponent.id);
    const hint = document.createElement('span');
    hint.className = 'key-hint';
    hint.textContent = label;
    btn.appendChild(hint);
    pairEl.appendChild(btn);
  }
  document.getElementById('vote-count').textContent =
    `${total} vote${total === 1 ? '' : 's'} cast`;
}

function renderRankScreen() {
  const scores = computeElo(db);
  const genderClause = activeGender === 'all' ? '' : ` WHERE gender = '${activeGender}' OR gender = 'n'`;
  const rows = db.query(`SELECT id, name, gender FROM names${genderClause}`);
  rows.sort((a, b) => (scores.get(b[0]) ?? 1000) - (scores.get(a[0]) ?? 1000));

  const tabs = document.getElementById('filter-tabs');
  tabs.innerHTML = '';
  for (const [label, value] of [['All', 'all'], ['F', 'f'], ['M', 'm']]) {
    const btn = document.createElement('button');
    const colorClass = value !== 'all' ? ` filter-tab--${value}` : '';
    btn.className = 'filter-tab' + colorClass + (activeGender === value ? ' active' : '');
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

function setupSettingsForm() {
  const cfg = loadS3Config();
  document.getElementById('s3-endpoint').value   = cfg.endpoint   ?? '';
  document.getElementById('s3-bucket').value     = cfg.bucket     ?? '';
  document.getElementById('s3-access-key').value = cfg.accessKey  ?? '';
  document.getElementById('s3-secret-key').value = cfg.secretKey  ?? '';

  document.getElementById('settings-form').onsubmit = (e) => {
    e.preventDefault();
    saveS3Config(readSettingsFields());
    setSettingsStatus('Saved.', 'ok');
  };

  document.getElementById('btn-test-s3').onclick = async () => {
    const btn = document.getElementById('btn-test-s3');
    btn.disabled = true;
    setSettingsStatus('Testing…', '');
    const result = await testS3Connection(readSettingsFields());
    setSettingsStatus(result.message, result.ok ? 'ok' : 'err');
    btn.disabled = false;
  };
}

function readSettingsFields() {
  return {
    endpoint:  document.getElementById('s3-endpoint').value.trim(),
    bucket:    document.getElementById('s3-bucket').value.trim(),
    accessKey: document.getElementById('s3-access-key').value.trim(),
    secretKey: document.getElementById('s3-secret-key').value.trim(),
  };
}

function setSettingsStatus(msg, cls) {
  const el = document.getElementById('settings-status');
  el.textContent = msg;
  el.className = 'settings-status' + (cls ? ' ' + cls : '');
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
setupSettingsForm();
setupKeyboardShortcuts();
