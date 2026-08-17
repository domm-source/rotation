'use strict';

/* =================================================================
   Rotation — state & storage
================================================================= */

const STORAGE_KEY = 'rotation.v1';

const FEELINGS = [
  { id: 'strong',  emoji: '💪', label: 'Strong'  },
  { id: 'good',    emoji: '🙂', label: 'Good'    },
  { id: 'okay',    emoji: '😐', label: 'Okay'    },
  { id: 'hard',    emoji: '😣', label: 'Hard'    },
  { id: 'caution', emoji: '⚠️', label: 'Caution' },
];
const feelingById = id => FEELINGS.find(f => f.id === id);

function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { console.error('Failed to load state', e); }
  return { exercises: [], sessions: [], settings: { unit: 'kg' } };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

let state = loadState();

/* =================================================================
   Date helpers
================================================================= */

function todayISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function daysBetween(isoA, isoB) {
  const a = new Date(isoA + 'T00:00:00');
  const b = new Date(isoB + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}

function formatRelative(daysSince) {
  if (daysSince === null) return 'Never done';
  if (daysSince === 0) return 'Today';
  if (daysSince === 1) return 'Yesterday';
  return `${daysSince} days ago`;
}

function formatDateLong(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatDateFull(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/* =================================================================
   Rotation logic
================================================================= */

function sessionsDesc() {
  return [...state.sessions].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
}

function lastEntryFor(exerciseId) {
  for (const session of sessionsDesc()) {
    const entry = session.entries.find(e => e.exerciseId === exerciseId);
    if (entry) return { session, entry };
  }
  return null;
}

function overdueInfo(exerciseId) {
  const found = lastEntryFor(exerciseId);
  if (!found) return { daysSince: null, lastDate: null, entry: null };
  const daysSince = daysBetween(found.session.date, todayISO());
  return { daysSince, lastDate: found.session.date, entry: found.entry };
}

function rankedExercises(activeOnly = true) {
  const list = state.exercises.filter(e => !activeOnly || e.active);
  return list
    .map(ex => ({ exercise: ex, ...overdueInfo(ex.id) }))
    .sort((a, b) => {
      if (a.daysSince === null && b.daysSince === null) return a.exercise.name.localeCompare(b.exercise.name);
      if (a.daysSince === null) return -1;
      if (b.daysSince === null) return 1;
      return b.daysSince - a.daysSince;
    });
}

function setsSummary(sets) {
  if (!sets || sets.length === 0) return null;
  return sets.map(s => {
    const reps = s.reps !== '' && s.reps != null ? s.reps : '—';
    const weight = s.weight !== '' && s.weight != null ? `${s.weight}${state.settings.unit}` : '';
    return weight ? `${reps}×${weight}` : `${reps} reps`;
  }).join(', ');
}

/* =================================================================
   Export / import
================================================================= */

function buildJSONExport() {
  const payload = {
    app: 'rotation',
    version: 1,
    exportedAt: new Date().toISOString(),
    data: state,
  };
  return JSON.stringify(payload, null, 2);
}

function buildTextExport() {
  const lines = [];
  lines.push('ROTATION — WORKOUT LOG');
  lines.push(`Exported ${formatDateFull(todayISO())}`);
  lines.push('');

  const sessions = [...state.sessions].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);

  if (sessions.length === 0) {
    lines.push('No sessions logged yet.');
    return lines.join('\n');
  }

  for (const session of sessions) {
    const header = formatDateFull(session.date);
    lines.push('='.repeat(header.length));
    lines.push(header);
    lines.push('='.repeat(header.length));
    lines.push('');
    for (const entry of session.entries) {
      const ex = state.exercises.find(x => x.id === entry.exerciseId);
      lines.push(ex ? ex.name : '(removed exercise)');
      if (entry.sets && entry.sets.length) {
        entry.sets.forEach(s => {
          const reps = s.reps != null ? `${s.reps} reps` : 'reps not logged';
          const weight = s.weight != null ? ` @ ${s.weight}${state.settings.unit}` : '';
          lines.push(`  ${reps}${weight}`);
        });
      } else {
        lines.push('  (no sets logged)');
      }
      if (entry.feeling) {
        const f = feelingById(entry.feeling);
        lines.push(`  Feeling: ${f.label} ${f.emoji}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n').trim() + '\n';
}

function exportFile(filename, mimeType, content) {
  const blob = new Blob([content], { type: mimeType });
  if (navigator.canShare) {
    try {
      const file = new File([blob], filename, { type: mimeType });
      if (navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file] }).catch(() => {});
        return;
      }
    } catch (e) { /* fall through to direct download */ }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function importBackup(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let parsed;
    try {
      parsed = JSON.parse(reader.result);
    } catch (e) {
      alert("That file isn't valid JSON — couldn't read it as a Rotation backup.");
      return;
    }
    const data = parsed && parsed.app === 'rotation' ? parsed.data : null;
    if (!data || !Array.isArray(data.exercises) || !Array.isArray(data.sessions)) {
      alert("That doesn't look like a Rotation backup file.");
      return;
    }
    const current = `${state.exercises.length} exercises, ${state.sessions.length} sessions`;
    const incoming = `${data.exercises.length} exercises, ${data.sessions.length} sessions`;
    if (!confirm(`Replace your current data (${current}) with this backup (${incoming})? This can't be undone.`)) return;
    state = { exercises: data.exercises, sessions: data.sessions, settings: data.settings || { unit: 'kg' } };
    saveState();
    goTo('settings');
  };
  reader.readAsText(file);
}

/* =================================================================
   Navigation / view state
================================================================= */

const nav = {
  view: state.exercises.length === 0 ? 'settings' : 'home',
  params: {},
};

function goTo(view, params = {}) {
  nav.view = view;
  nav.params = params;
  render();
  const root = document.getElementById('viewRoot');
  if (root) root.scrollTop = 0;
}

/* transient draft session (not persisted until Finish) */
let draft = null;

function newDraft() {
  return { selected: new Set(), logs: {} };
}

function startOrResumeSession() {
  if (!draft) {
    draft = newDraft();
    const ranked = rankedExercises(true);
    const suggestCount = Math.min(5, ranked.length);
    ranked.slice(0, suggestCount).forEach(r => draft.selected.add(r.exercise.id));
  }
  goTo('session');
}

/* =================================================================
   Rendering
================================================================= */

const viewRoot = document.getElementById('viewRoot');
const topbarTitle = document.getElementById('topbarTitle');
const topbarBack = document.getElementById('topbarBack');
const tabbar = document.getElementById('tabbar');

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str == null ? '' : String(str);
  return d.innerHTML;
}

function render() {
  const view = nav.view;
  const isSub = ['exerciseDetail', 'session', 'sessionAdd', 'historyDetail'].includes(view);
  topbarBack.hidden = !isSub;

  tabbar.querySelectorAll('.tab').forEach(btn => {
    const tabView = btn.dataset.view;
    const active = tabView === view || (tabView === 'session' && view === 'sessionAdd');
    btn.classList.toggle('active', active);
  });

  let html = '';
  let title = 'Rotation';

  switch (view) {
    case 'home': title = 'Rotation'; html = renderHome(); break;
    case 'session': title = 'Log Session'; html = renderSession(); break;
    case 'sessionAdd': title = 'Add Exercise'; html = renderSessionAdd(); break;
    case 'history': title = 'History'; html = renderHistory(); break;
    case 'historyDetail': title = formatDateLong(nav.params.date); html = renderHistoryDetail(); break;
    case 'settings': title = 'Settings'; html = renderSettings(); break;
    case 'exerciseDetail': title = nav.params.name; html = renderExerciseDetail(); break;
    default: html = '<div class="empty-state">Not found.</div>';
  }

  topbarTitle.textContent = title;
  viewRoot.innerHTML = `<div class="view-enter">${html}</div>`;
  attachViewHandlers(view);
}

/* ---------------- Home ---------------- */

function renderHome() {
  const ranked = rankedExercises(true);
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  if (state.exercises.length === 0) {
    return `
      <div class="empty-state">
        No exercises yet.<br>Add the ones you rotate through to get started.
        <button class="btn btn-primary" id="goSettingsBtn" style="margin-top:16px;width:auto;padding:12px 20px;">Add exercises</button>
      </div>`;
  }

  const maxDays = Math.max(1, ...ranked.filter(r => r.daysSince !== null).map(r => r.daysSince));
  const cap = Math.max(maxDays, 14);

  const rows = ranked.map(r => {
    const pct = r.daysSince === null ? 100 : Math.min(100, Math.round((r.daysSince / cap) * 100));
    const due = r.daysSince === null || r.daysSince >= 7;
    return `
      <button class="exercise-row" data-exdetail="${r.exercise.id}">
        <div class="exercise-row-top">
          <span class="exercise-name">${esc(r.exercise.name)}</span>
          <span class="exercise-meta ${due ? 'due' : ''}">${formatRelative(r.daysSince)}</span>
        </div>
        <div class="overdue-bar"><i style="width:${pct}%"></i></div>
      </button>`;
  }).join('');

  return `
    <div class="date-sub">${today}</div>
    <button class="btn btn-primary" id="startSessionBtn">Start Session</button>
    <h2 class="section-label">Rotation — most overdue first</h2>
    <div class="list">${rows}</div>
  `;
}

/* ---------------- Session: add exercise picker ---------------- */

function renderSessionAdd() {
  if (!draft) draft = newDraft();
  const ranked = rankedExercises(true).filter(r => !draft.selected.has(r.exercise.id));

  const footer = `
    <div class="sticky-footer">
      <button class="btn btn-primary" id="sessionAddDoneBtn">Back to Session</button>
    </div>`;

  if (ranked.length === 0) {
    return `<div class="empty-state">All your exercises are already in this session.</div>${footer}`;
  }

  const rows = ranked.map(r => `
    <button class="check-row" data-quickadd="${r.exercise.id}">
      <span class="add-icon"><svg viewBox="0 0 24 24" fill="none" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></span>
      <span class="check-row-body">
        <div class="check-row-name">${esc(r.exercise.name)}</div>
        <div class="check-row-meta">${formatRelative(r.daysSince)}</div>
      </span>
    </button>`).join('');

  return `
    <div class="list">${rows}</div>
    ${footer}
  `;
}

/* ---------------- Session: log sets ---------------- */

function renderSession() {
  if (!draft) draft = newDraft();

  if (state.exercises.filter(e => e.active).length === 0) {
    return `<div class="empty-state">No exercises yet. Add some in Settings first.</div>`;
  }

  const ids = [...draft.selected];
  const empty = ids.length === 0;

  const cards = ids.map(id => {
    const ex = state.exercises.find(e => e.id === id);
    if (!ex) return '';
    if (!draft.logs[id]) {
      const last = lastEntryFor(id);
      const lastWeight = last && last.entry.sets && last.entry.sets.length
        ? last.entry.sets[last.entry.sets.length - 1].weight : '';
      draft.logs[id] = { sets: [{ reps: '', weight: lastWeight ?? '' }], feeling: null };
    }
    const log = draft.logs[id];
    const last = lastEntryFor(id);
    const lastLine = last
      ? `Last: ${formatRelative(daysBetween(last.session.date, todayISO()))} · ${setsSummary(last.entry.sets) || 'no sets logged'}${last.entry.feeling ? ' · ' + feelingById(last.entry.feeling).emoji : ''}`
      : 'First time logging this one';

    const setRows = log.sets.map((s, i) => `
      <div class="set-row" data-set-row="${id}:${i}">
        <span class="set-index">${i + 1}</span>
        <span class="set-input-wrap">
          <input type="number" inputmode="numeric" placeholder="reps" min="0" value="${s.reps}" data-set-field="${id}:${i}:reps">
          <span>reps</span>
        </span>
        <span class="set-input-wrap">
          <input type="number" inputmode="decimal" placeholder="0" min="0" step="0.5" value="${s.weight}" data-set-field="${id}:${i}:weight">
          <span>${state.settings.unit}</span>
        </span>
        ${log.sets.length > 1 ? `<button class="set-remove" data-remove-set="${id}:${i}" aria-label="Remove set"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>` : '<span style="width:28px;flex-shrink:0;"></span>'}
      </div>`).join('');

    const feelingRow = FEELINGS.map(f => `
      <button class="feeling-btn ${log.feeling === f.id ? 'active' : ''}" data-feeling="${id}:${f.id}">
        <span class="e">${f.emoji}</span>
        <span class="l">${f.label}</span>
      </button>`).join('');

    return `
      <div class="log-card">
        <div class="log-card-header">
          <div class="log-card-header-top">
            <div class="log-card-name">${esc(ex.name)}</div>
            <button class="row-btn remove" data-remove-exercise-session="${id}" aria-label="Remove ${esc(ex.name)} from session"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-8 0v12a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V7"/></svg></button>
          </div>
          <div class="log-card-last">${esc(lastLine)}</div>
        </div>
        ${setRows}
        <button class="add-set-btn" data-add-set="${id}">+ Add set</button>
        <div class="feeling-row">${feelingRow}</div>
      </div>`;
  }).join('');

  return `
    ${empty ? `<div class="empty-state">No exercises added yet.<br>Tap below to add one.</div>` : cards}
    <button class="btn btn-secondary" id="addExerciseSessionBtn" style="margin-bottom:8px;">+ Add exercise</button>
    <div class="sticky-footer">
      <button class="btn btn-primary" id="finishSessionBtn" ${empty ? 'disabled' : ''}>Finish Session</button>
    </div>
  `;
}

/* ---------------- History ---------------- */

function renderHistory() {
  const sessions = sessionsDesc();
  if (sessions.length === 0) {
    return `<div class="empty-state">No sessions logged yet.<br>Your finished sessions will show up here.</div>`;
  }
  const rows = sessions.map(s => {
    const names = s.entries.map(e => {
      const ex = state.exercises.find(x => x.id === e.exerciseId);
      return ex ? ex.name : '(removed)';
    }).join(' · ');
    return `
      <button class="session-row" data-history-detail="${s.id}">
        <span class="session-row-date">${formatDateLong(s.date)}</span>
        <span class="session-row-tags">${esc(names)}</span>
      </button>`;
  }).join('');
  return `<div class="list">${rows}</div>`;
}

function renderHistoryDetail() {
  const session = state.sessions.find(s => s.id === nav.params.id);
  if (!session) return `<div class="empty-state">Session not found.</div>`;

  const blocks = session.entries.map(e => {
    const ex = state.exercises.find(x => x.id === e.exerciseId);
    const feeling = e.feeling ? feelingById(e.feeling) : null;
    return `
      <div class="detail-block">
        <div class="detail-block-title">${esc(ex ? ex.name : '(removed exercise)')}</div>
        <div class="detail-block-sets">${esc(setsSummary(e.sets) || 'No sets logged')}</div>
        ${feeling ? `<div class="detail-feeling">${feeling.emoji} ${feeling.label}</div>` : ''}
      </div>`;
  }).join('');

  return `
    ${blocks}
    <button class="btn btn-danger" id="deleteSessionBtn" style="margin-top:8px;">Delete this session</button>
  `;
}

/* ---------------- Exercise detail ---------------- */

function renderExerciseDetail() {
  const ex = state.exercises.find(e => e.id === nav.params.id);
  if (!ex) return `<div class="empty-state">Exercise not found.</div>`;

  const history = [];
  for (const session of sessionsDesc()) {
    const entry = session.entries.find(e => e.exerciseId === ex.id);
    if (entry) history.push({ session, entry });
  }

  const info = overdueInfo(ex.id);
  const summaryCard = `
    <div class="card" style="margin-bottom:20px;">
      <div class="exercise-meta ${info.daysSince === null || info.daysSince >= 7 ? 'due' : ''}" style="font-size:13px;">${formatRelative(info.daysSince)}</div>
    </div>`;

  if (history.length === 0) {
    return summaryCard + `<div class="empty-state">No history yet for this exercise.</div>`;
  }

  const rows = history.map(({ session, entry }) => {
    const feeling = entry.feeling ? feelingById(entry.feeling) : null;
    return `
      <div class="detail-block">
        <div class="detail-block-title" style="font-size:13.5px;color:var(--text-secondary);font-weight:600;">${formatDateLong(session.date)}</div>
        <div class="detail-block-sets">${esc(setsSummary(entry.sets) || 'No sets logged')} ${feeling ? feeling.emoji : ''}</div>
      </div>`;
  }).join('');

  return summaryCard + `<h2 class="section-label">History</h2>` + rows;
}

/* ---------------- Settings ---------------- */

function renderSettings() {
  const unit = state.settings.unit;
  const activeExercises = state.exercises.filter(e => e.active);

  const rows = activeExercises.map(ex => `
    <div class="edit-row">
      <input type="text" value="${esc(ex.name)}" data-rename="${ex.id}">
      <button class="row-btn remove" data-remove-exercise="${ex.id}" aria-label="Remove"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-8 0v12a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V7"/></svg></button>
    </div>`).join('');

  const onboarding = state.exercises.length === 0
    ? `<p class="onboarding-note">Add the exercises you rotate through — around 15 is typical. You can edit this list any time.</p>`
    : '';

  const counts = `${activeExercises.length} active exercise${activeExercises.length === 1 ? '' : 's'} · ${state.sessions.length} session${state.sessions.length === 1 ? '' : 's'} logged`;

  return `
    <h2 class="section-label">Units</h2>
    <div class="segmented">
      <button data-unit="kg" class="${unit === 'kg' ? 'active' : ''}">kg</button>
      <button data-unit="lb" class="${unit === 'lb' ? 'active' : ''}">lb</button>
    </div>

    <h2 class="section-label">Exercises</h2>
    ${onboarding}
    <div class="list">${rows || '<div class="empty-state" style="padding:24px;">No exercises yet.</div>'}</div>
    <form class="add-exercise-form" id="addExerciseForm">
      <input type="text" id="newExerciseInput" placeholder="Add exercise…" autocomplete="off">
      <button class="btn btn-primary btn-small" type="submit">Add</button>
    </form>

    <h2 class="section-label">Data</h2>
    <p class="onboarding-note">${esc(counts)}. Everything is stored only on this device — export a backup to keep it safe, or a text log to share with a coach.</p>
    <div class="btn-stack">
      <button class="btn btn-secondary" id="exportJsonBtn">Export backup (.json)</button>
      <button class="btn btn-secondary" id="exportTextBtn">Export for coach (.txt)</button>
      <button class="btn btn-secondary" id="importBtn">Restore from backup…</button>
    </div>
    <input type="file" id="importFileInput" accept="application/json,.json" hidden>
  `;
}

/* =================================================================
   Event handlers
================================================================= */

function attachViewHandlers(view) {
  if (view === 'home') {
    const startBtn = document.getElementById('startSessionBtn');
    if (startBtn) startBtn.onclick = () => startOrResumeSession();
    const goSettingsBtn = document.getElementById('goSettingsBtn');
    if (goSettingsBtn) goSettingsBtn.onclick = () => goTo('settings');
    viewRoot.querySelectorAll('[data-exdetail]').forEach(btn => {
      btn.onclick = () => {
        const ex = state.exercises.find(e => e.id === btn.dataset.exdetail);
        goTo('exerciseDetail', { id: ex.id, name: ex.name });
      };
    });
  }

  if (view === 'sessionAdd') {
    viewRoot.querySelectorAll('[data-quickadd]').forEach(btn => {
      btn.onclick = () => {
        draft.selected.add(btn.dataset.quickadd);
        render();
      };
    });
    const doneBtn = document.getElementById('sessionAddDoneBtn');
    if (doneBtn) doneBtn.onclick = () => goTo('session');
  }

  if (view === 'session') {
    viewRoot.querySelectorAll('[data-set-field]').forEach(input => {
      input.oninput = () => {
        const [id, idx, field] = input.dataset.setField.split(':');
        draft.logs[id].sets[+idx][field] = input.value;
      };
    });
    viewRoot.querySelectorAll('[data-add-set]').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.addSet;
        const sets = draft.logs[id].sets;
        const prev = sets[sets.length - 1];
        sets.push({ reps: prev ? prev.reps : '', weight: prev ? prev.weight : '' });
        render();
      };
    });
    viewRoot.querySelectorAll('[data-remove-set]').forEach(btn => {
      btn.onclick = () => {
        const [id, idx] = btn.dataset.removeSet.split(':');
        draft.logs[id].sets.splice(+idx, 1);
        render();
      };
    });
    viewRoot.querySelectorAll('[data-feeling]').forEach(btn => {
      btn.onclick = () => {
        const [id, feelingId] = btn.dataset.feeling.split(':');
        draft.logs[id].feeling = draft.logs[id].feeling === feelingId ? null : feelingId;
        render();
      };
    });
    viewRoot.querySelectorAll('[data-remove-exercise-session]').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.removeExerciseSession;
        const log = draft.logs[id];
        const hasData = log && (log.feeling || (log.sets || []).some(s => s.reps !== '' || s.weight !== ''));
        if (hasData) {
          const ex = state.exercises.find(e => e.id === id);
          if (!confirm(`Remove "${ex ? ex.name : 'this exercise'}" from today's session? Any sets you've logged for it will be discarded.`)) return;
        }
        draft.selected.delete(id);
        delete draft.logs[id];
        render();
      };
    });
    const addExerciseSessionBtn = document.getElementById('addExerciseSessionBtn');
    if (addExerciseSessionBtn) addExerciseSessionBtn.onclick = () => goTo('sessionAdd');
    const finishBtn = document.getElementById('finishSessionBtn');
    if (finishBtn) finishBtn.onclick = finishSession;
  }

  if (view === 'history') {
    viewRoot.querySelectorAll('[data-history-detail]').forEach(btn => {
      btn.onclick = () => goTo('historyDetail', { id: btn.dataset.historyDetail, date: state.sessions.find(s => s.id === btn.dataset.historyDetail).date });
    });
  }

  if (view === 'historyDetail') {
    const delBtn = document.getElementById('deleteSessionBtn');
    if (delBtn) delBtn.onclick = () => {
      if (!confirm('Delete this session? This cannot be undone.')) return;
      state.sessions = state.sessions.filter(s => s.id !== nav.params.id);
      saveState();
      goTo('history');
    };
  }

  if (view === 'settings') {
    viewRoot.querySelectorAll('[data-unit]').forEach(btn => {
      btn.onclick = () => {
        state.settings.unit = btn.dataset.unit;
        saveState();
        render();
      };
    });
    viewRoot.querySelectorAll('[data-rename]').forEach(input => {
      input.onchange = () => {
        const ex = state.exercises.find(e => e.id === input.dataset.rename);
        const val = input.value.trim();
        if (val) { ex.name = val; saveState(); } else { input.value = ex.name; }
      };
    });
    viewRoot.querySelectorAll('[data-remove-exercise]').forEach(btn => {
      btn.onclick = () => {
        const ex = state.exercises.find(e => e.id === btn.dataset.removeExercise);
        if (!confirm(`Remove "${ex.name}" from your rotation? Past history is kept.`)) return;
        ex.active = false;
        saveState();
        render();
      };
    });
    const form = document.getElementById('addExerciseForm');
    if (form) form.onsubmit = (e) => {
      e.preventDefault();
      const input = document.getElementById('newExerciseInput');
      const name = input.value.trim();
      if (!name) return;
      state.exercises.push({ id: uid(), name, active: true, createdAt: Date.now() });
      saveState();
      input.value = '';
      render();
      document.getElementById('newExerciseInput').focus();
    };

    const exportJsonBtn = document.getElementById('exportJsonBtn');
    if (exportJsonBtn) exportJsonBtn.onclick = () => {
      exportFile(`rotation-backup-${todayISO()}.json`, 'application/json', buildJSONExport());
    };
    const exportTextBtn = document.getElementById('exportTextBtn');
    if (exportTextBtn) exportTextBtn.onclick = () => {
      exportFile(`rotation-log-${todayISO()}.txt`, 'text/plain', buildTextExport());
    };
    const importBtn = document.getElementById('importBtn');
    const importFileInput = document.getElementById('importFileInput');
    if (importBtn && importFileInput) {
      importBtn.onclick = () => importFileInput.click();
      importFileInput.onchange = () => {
        const file = importFileInput.files[0];
        if (file) importBackup(file);
        importFileInput.value = '';
      };
    }
  }
}

function finishSession() {
  if (!draft || draft.selected.size === 0) return;
  const entries = [];
  for (const id of draft.selected) {
    const log = draft.logs[id];
    if (!log) { entries.push({ exerciseId: id, sets: [], feeling: null }); continue; }
    const sets = log.sets
      .filter(s => (s.reps !== '' && s.reps != null) || (s.weight !== '' && s.weight != null))
      .map(s => ({
        reps: s.reps === '' ? null : Number(s.reps),
        weight: s.weight === '' ? null : Number(s.weight),
      }));
    entries.push({ exerciseId: id, sets, feeling: log.feeling });
  }

  state.sessions.push({
    id: uid(),
    date: todayISO(),
    createdAt: Date.now(),
    entries,
  });
  saveState();
  draft = null;
  goTo('home');
}

/* =================================================================
   Global nav wiring
================================================================= */

document.getElementById('topbarBack').onclick = () => {
  if (nav.view === 'sessionAdd') goTo('session');
  else if (nav.view === 'exerciseDetail') goTo('home');
  else if (nav.view === 'historyDetail') goTo('history');
  else goTo('home');
};

tabbar.querySelectorAll('.tab').forEach(btn => {
  btn.onclick = () => {
    const view = btn.dataset.view;
    if (view === 'session') { startOrResumeSession(); return; }
    goTo(view);
  };
});

render();

/* =================================================================
   PWA: service worker registration
================================================================= */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.error('SW registration failed', err));
  });
  let refreshedOnce = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshedOnce) return;
    refreshedOnce = true;
    window.location.reload();
  });
}
