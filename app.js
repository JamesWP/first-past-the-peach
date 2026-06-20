import init, { Database } from './vendor/database/database.js';
import { SEED_NAMES } from './names.js';
import { createSchema, ensureExcludedTable, pickPair, recordVote, computeElo, addName, getExcludedIds, excludeName, includeName } from './db.js';
import { loadS3Config, saveS3Config, testS3Connection, getObject, putObject } from './s3.js';

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

let db;
let s3Provider = null;
let activeGender = 'all';

function dbFileKey(cfg) {
  return cfg.fileKey?.trim() || 'names.db';
}

function parseNameList(text) {
  const results = [];
  let currentGender = 'n';
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const heading = line.match(/^([fmn]):$/i);
    if (heading) { currentGender = heading[1].toLowerCase(); continue; }
    const parts = line.split(/\s+/);
    const last = parts[parts.length - 1].toLowerCase();
    if (parts.length > 1 && ['f', 'm', 'n'].includes(last)) {
      results.push({ name: parts.slice(0, -1).join(' '), gender: last });
    } else {
      results.push({ name: line, gender: currentGender });
    }
  }
  return results;
}

function dbStatus(db) {
  try {
    const [[count]] = db.query('SELECT COUNT(*) FROM names');
    return count > 0 ? 'vote' : 'setup';
  } catch {
    return 'fresh';
  }
}

async function initDB() {
  await init();
  const cfg = loadS3Config();
  if (cfg.mode === 'local') {
    db = new Database();
    createSchema(db);
    return 'setup';
  }
  const hasS3 = cfg.endpoint && cfg.bucket && cfg.accessKey && cfg.secretKey;
  if (!hasS3) {
    db = new Database();
    return 'settings';
  }
  const blob = await getObject({ ...cfg, key: dbFileKey(cfg) });
  s3Provider = new PageStorageProvider(blob);
  db = Database.withStorage(s3Provider);
  const status = dbStatus(db);
  if (status === 'fresh') createSchema(db);
  else ensureExcludedTable(db);
  return status === 'vote' ? 'vote' : 'setup';
}

let flushTimer = null;

function setSaveIndicator(state) {
  const el = document.getElementById('save-indicator');
  if (!el) return;
  if (state === 'hidden') {
    el.hidden = true;
    el.className = 'save-indicator';
  } else {
    el.hidden = false;
    el.className = 'save-indicator' + (state === 'saving' ? ' save-indicator--saving' : '');
    el.title = state === 'saving' ? 'Saving…' : 'Unsaved changes';
  }
}

async function flushToS3() {
  if (!s3Provider) return;
  const cfg = loadS3Config();
  if (!cfg.endpoint) return;
  setSaveIndicator('saving');
  db.flush();
  await putObject({ ...cfg, key: dbFileKey(cfg), body: s3Provider.toBlob() });
  setSaveIndicator('hidden');
}

function scheduleFlush() {
  clearTimeout(flushTimer);
  setSaveIndicator('pending');
  flushTimer = setTimeout(() => {
    flushToS3().catch(e => console.error('S3 sync failed:', e));
  }, 2000);
}

function castVote(winnerId, loserId) {
  document.activeElement?.blur();
  recordVote(db, winnerId, loserId);
  renderVoteScreen();
  scheduleFlush();
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
  const pair = pickPair(db);
  const [[total]] = db.query('SELECT COUNT(*) FROM votes');
  const pairEl = document.getElementById('vote-pair');
  pairEl.innerHTML = '';

  if (!pair) {
    pairEl.innerHTML = '<p style="color:#aaa;font-size:0.95rem;text-align:center">No names available — re-enable some from the Stats screen.</p>';
    document.getElementById('vote-count').textContent = '';
    return;
  }

  const [a, b] = pair;
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
  const excludedIds = getExcludedIds(db);
  const genderClause = activeGender === 'all' ? '' : ` WHERE gender = '${activeGender}' OR gender = 'n'`;
  const rows = db.query(`SELECT id, name, gender FROM names${genderClause}`);

  const active = rows.filter(([id]) => !excludedIds.has(id));
  const excluded = rows.filter(([id]) => excludedIds.has(id));
  active.sort((a, b) => (scores.get(b[0]) ?? 1000) - (scores.get(a[0]) ?? 1000));
  excluded.sort((a, b) => (scores.get(b[0]) ?? 1000) - (scores.get(a[0]) ?? 1000));

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

  function makeToggleBtn(nameId, isExcluded) {
    const td = document.createElement('td');
    const btn = document.createElement('button');
    btn.className = 'rank-toggle';
    btn.textContent = isExcluded ? '+' : '×';
    btn.title = isExcluded ? 'Re-include in voting' : 'Exclude from voting';
    btn.onclick = () => {
      if (isExcluded) includeName(db, nameId); else excludeName(db, nameId);
      scheduleFlush();
      renderRankScreen();
    };
    td.appendChild(btn);
    return td;
  }

  active.forEach(([id, name, gender], i) => {
    const tr = document.createElement('tr');
    for (const text of [i + 1, name, `[${gender ?? '?'}]`, Math.round(scores.get(id) ?? 1000)]) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    }
    tr.appendChild(makeToggleBtn(id, false));
    tbody.appendChild(tr);
  });

  if (excluded.length > 0) {
    const divider = document.createElement('tr');
    divider.className = 'excluded-divider';
    const td = document.createElement('td');
    td.colSpan = 5;
    td.textContent = 'Excluded';
    divider.appendChild(td);
    tbody.appendChild(divider);

    excluded.forEach(([id, name, gender]) => {
      const tr = document.createElement('tr');
      tr.className = 'rank-excluded';
      for (const text of ['–', name, `[${gender ?? '?'}]`, Math.round(scores.get(id) ?? 1000)]) {
        const td = document.createElement('td');
        td.textContent = text;
        tr.appendChild(td);
      }
      tr.appendChild(makeToggleBtn(id, true));
      tbody.appendChild(tr);
    });
  }
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
    scheduleFlush();
    e.target.reset();
    showSection('vote');
  };
}

function setupSettingsForm() {
  const cfg = loadS3Config();
  const mode = cfg.mode ?? 's3';
  document.querySelector(`input[name="storage-mode"][value="${mode}"]`).checked = true;
  document.getElementById('s3-endpoint').value   = cfg.endpoint   ?? '';
  document.getElementById('s3-bucket').value     = cfg.bucket     ?? '';
  document.getElementById('s3-access-key').value = cfg.accessKey  ?? '';
  document.getElementById('s3-secret-key').value = cfg.secretKey  ?? '';
  document.getElementById('s3-file-key').value   = cfg.fileKey    ?? '';

  let s3Verified = false;

  function currentMode() {
    return document.querySelector('input[name="storage-mode"]:checked')?.value ?? 's3';
  }

  function updateSaveState() {
    const isLocal = currentMode() === 'local';
    document.getElementById('s3-fields').style.display = isLocal ? 'none' : '';
    document.getElementById('btn-save').disabled = !isLocal && !s3Verified;
  }

  function resetVerified() {
    s3Verified = false;
    updateSaveState();
  }

  document.querySelectorAll('input[name="storage-mode"]').forEach(r => {
    r.addEventListener('change', () => { resetVerified(); setSettingsStatus('', ''); });
  });
  document.getElementById('s3-endpoint').addEventListener('input', resetVerified);
  document.getElementById('s3-bucket').addEventListener('input', resetVerified);
  document.getElementById('s3-access-key').addEventListener('input', resetVerified);
  document.getElementById('s3-secret-key').addEventListener('input', resetVerified);

  updateSaveState();

  document.getElementById('btn-test-s3').onclick = async () => {
    const btn = document.getElementById('btn-test-s3');
    btn.disabled = true;
    setSettingsStatus('Testing…', '');
    const result = await testS3Connection(readSettingsFields());
    s3Verified = result.ok;
    setSettingsStatus(result.message, result.ok ? 'ok' : 'err');
    btn.disabled = false;
    updateSaveState();
  };

  document.getElementById('settings-form').onsubmit = (e) => {
    e.preventDefault();
    const prev = loadS3Config();
    const next = readSettingsFields();
    saveS3Config(next);
    const modeChanged = (prev.mode ?? 's3') !== next.mode;
    const locationChanged = prev.endpoint !== next.endpoint
      || prev.bucket !== next.bucket
      || (prev.fileKey || 'names.db') !== (next.fileKey || 'names.db');
    if (modeChanged || locationChanged || !s3Provider) {
      setSettingsStatus('Connecting…', '');
      setTimeout(() => location.reload(), 800);
    } else {
      setSettingsStatus('Saving…', '');
      flushToS3()
        .then(() => setSettingsStatus('Saved and synced.', 'ok'))
        .catch(err => setSettingsStatus(`Sync failed: ${err.message}`, 'err'));
    }
  };
}

function readSettingsFields() {
  return {
    mode:      document.querySelector('input[name="storage-mode"]:checked')?.value ?? 's3',
    endpoint:  document.getElementById('s3-endpoint').value.trim(),
    bucket:    document.getElementById('s3-bucket').value.trim(),
    accessKey: document.getElementById('s3-access-key').value.trim(),
    secretKey: document.getElementById('s3-secret-key').value.trim(),
    fileKey:   document.getElementById('s3-file-key').value.trim(),
  };
}

function sampleNameText() {
  const groups = { f: [], m: [], n: [] };
  for (const { name, gender } of SEED_NAMES) groups[gender].push(name);
  return [
    'f:', ...groups.f,
    '', 'm:', ...groups.m,
    '', 'n:', ...groups.n,
  ].join('\n');
}

function setupInitForm() {
  const textarea = document.getElementById('setup-names');
  const saved = localStorage.getItem('last_name_list');
  if (saved) textarea.value = saved;
  textarea.addEventListener('input', () => localStorage.setItem('last_name_list', textarea.value));

  document.getElementById('btn-sample-names').onclick = () => {
    textarea.value = sampleNameText();
    textarea.dispatchEvent(new Event('input'));
  };

  document.getElementById('setup-form').onsubmit = async (e) => {
    e.preventDefault();
    const text = textarea.value;
    const names = parseNameList(text);
    if (names.length < 2) {
      e.target.querySelector('button').insertAdjacentHTML(
        'beforebegin', '<p class="error-msg" style="margin-bottom:0.5rem">Add at least 2 names to start voting.</p>'
      );
      return;
    }
    e.target.querySelector('.error-msg')?.remove();
    for (const { name, gender } of names) {
      addName(db, name, gender);
    }
    await flushToS3();
    showSection('vote');
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
  document.getElementById('nav-' + id)?.classList.add('active');
  if (id === 'vote') renderVoteScreen();
  if (id === 'rank') renderRankScreen();
}

window.showSection = showSection;

window.addEventListener('beforeunload', (e) => {
  if (flushTimer !== null) {
    e.preventDefault();
    clearTimeout(flushTimer);
    flushTimer = null;
    flushToS3().catch(() => {});
  }
});

const initialSection = await initDB();
setupAddForm();
setupSettingsForm();
setupInitForm();
setupKeyboardShortcuts();
showSection(initialSection);
