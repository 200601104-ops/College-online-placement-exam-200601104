// Clean, module-compatible admin UI script — ensures login shows admin UI (or reloads) and supports add/edit/delete questions.

const tokenKey = 'admin_token';

const apiFetch = async (path, opts = {}) => {
  opts = Object.assign({ headers: {} }, opts);
  const token = localStorage.getItem(tokenKey);
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  if (opts.body && typeof opts.body === 'object') {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(path, opts);
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) throw { status: res.status, body: json };
  return json;
};

const el = id => document.getElementById(id);

const showMsg = (target, ok, text) => {
  if (!target) return;
  target.innerHTML = `<div class="msg ${ok ? 'ok' : 'err'}">${text}</div>`;
  setTimeout(() => { target.innerHTML = ''; }, 3500);
};

const showPanelsForAuth = () => {
  const has = !!localStorage.getItem(tokenKey);
  el('loginCard').style.display = has ? 'none' : 'block';
  el('tokenCard').style.display = has ? 'block' : 'none';
  el('resultsCard').style.display = has ? 'block' : 'none';
  el('manageCard').style.display = has ? 'block' : 'none';
  if (has) {
    el('tokenBox').value = localStorage.getItem(tokenKey) || '';
    loadExams().catch(() => {/*ignore*/});
    loadResults().catch(()=>{/*ignore*/});
  } else {
    el('tokenBox').value = '';
  }
};

/* Login / Logout */
el('btnLogin').addEventListener('click', async () => {
  const username = el('adminUser').value.trim();
  const password = el('adminPass').value;
  try {
    const resp = await fetch('/api/admin/login', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ username, password })
    });
    if (!resp.ok) {
      const err = await resp.json().catch(()=>({ error: 'Login failed' }));
      return showMsg(el('loginMsg'), false, err.error || 'Login failed');
    }
    const { token } = await resp.json();
    localStorage.setItem(tokenKey, token);
    // Reload the page so module bootstrapping runs cleanly
    window.location.href = '/admin.html';
  } catch (e) {
    showMsg(el('loginMsg'), false, 'Network error');
  }
});

el('btnLogout').addEventListener('click', () => {
  localStorage.removeItem(tokenKey);
  showPanelsForAuth();
});

/* Exams / Sections / Questions logic */
async function loadExams() {
  try {
    const exams = await fetch('/api/exams').then(r => r.json());
    const sel = el('examSelect');
    sel.innerHTML = exams.map(e => `<option value="${e.id}">${escapeHtml(e.title)}</option>`).join('');
    sel.onchange = () => loadSections(sel.value);
    if (exams.length) await loadSections(exams[0].id);
    else el('sectionSelect').innerHTML = '';
  } catch (e) {
    console.error('loadExams', e);
  }
}

async function loadSections(examId) {
  try {
    const secs = await fetch(`/api/exams/${examId}/sections`).then(r => r.json());
    const sel = el('sectionSelect');
    sel.innerHTML = secs.map(s => `<option value="${s.id}">${escapeHtml(s.title)}</option>`).join('');
    sel.onchange = () => loadQuestions(sel.value);
    if (secs.length) await loadQuestions(secs[0].id);
    else el('questionsList').innerHTML = '<div class="muted">No sections</div>';
  } catch (e) {
    console.error('loadSections', e);
  }
}

async function loadQuestions(sectionId) {
  if (!sectionId) return;
  try {
    const qs = await apiFetch(`/api/admin/sections/${sectionId}/questions`);
    const container = el('questionsList');
    if (!qs || !qs.length) { container.innerHTML = '<div class="muted">No questions</div>'; return; }
    const html = qs.map(q => {
      let opts = '[]';
      try { opts = JSON.parse(q.options_json || '[]'); } catch {}
      return `<table>
        <tr>
          <th style="width:65%">${escapeHtml(q.text)}</th>
          <td style="width:18%"><button data-id="${q.id}" class="editBtn">Edit</button></td>
          <td style="width:17%"><button data-id="${q.id}" class="delBtn danger">Delete</button></td>
        </tr>
        <tr><td colspan="3"><small class="muted">Options: ${escapeHtml((Array.isArray(opts)?opts:[]).join(' | '))}</small></td></tr>
      </table>`;
    }).join('');
    container.innerHTML = html;

    container.querySelectorAll('.delBtn').forEach(b => {
      b.addEventListener('click', async () => {
        if (!confirm('Delete question?')) return;
        try {
          await apiFetch(`/api/admin/questions/${b.dataset.id}`, { method: 'DELETE' });
          showMsg(el('manageMsg'), true, 'Question deleted');
          loadQuestions(sectionId);
        } catch (err) {
          showMsg(el('manageMsg'), false, err.body?.error || 'Delete failed');
          if (err.status === 401) { localStorage.removeItem(tokenKey); showPanelsForAuth(); }
        }
      });
    });

    container.querySelectorAll('.editBtn').forEach(b => {
      b.addEventListener('click', async () => {
        const id = b.dataset.id;
        // find the question object from previously fetched array
        const q = qs.find(x => String(x.id) === String(id));
        if (!q) return showMsg(el('manageMsg'), false, 'Question not found');
        // populate form for edit
        editingId = id;
        el('qText').value = q.text || '';
        try {
          const arr = JSON.parse(q.options_json || '[]');
          el('qOptions').value = arr.join(', ');
        } catch { el('qOptions').value = ''; }
        el('qCorrect').value = q.correct_index ?? 0;
        el('qDiff').value = q.difficulty || 'medium';
        el('btnAddQ').textContent = 'Save changes';
        el('btnCancelEdit').style.display = 'inline-block';
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });

  } catch (err) {
    console.error('loadQuestions', err);
    if (err.status === 401) {
      localStorage.removeItem(tokenKey);
      showPanelsForAuth();
    } else {
      el('questionsList').innerHTML = '<div class="muted">Failed to load questions</div>';
    }
  }
}

/* Add / Edit question */
let editingId = null;
el('btnAddQ').addEventListener('click', async () => {
  const section_id = el('sectionSelect').value;
  const text = el('qText').value.trim();
  const options = el('qOptions').value.split(',').map(s => s.trim()).filter(Boolean);
  const correct_index = parseInt(el('qCorrect').value || '0', 10);
  const difficulty = el('qDiff').value;
  if (!section_id || !text || options.length < 2) return showMsg(el('manageMsg'), false, 'Section, text and 2+ options required');
  try {
    if (!editingId) {
      await apiFetch('/api/admin/questions', {
        method: 'POST',
        body: { section_id, text, options, correct_index, difficulty }
      });
      showMsg(el('manageMsg'), true, 'Question added');
    } else {
      await apiFetch(`/api/admin/questions/${editingId}`, {
        method: 'PUT',
        body: { section_id, text, options, correct_index, difficulty }
      });
      showMsg(el('manageMsg'), true, 'Question updated');
      editingId = null;
      el('btnAddQ').textContent = 'Add question';
      el('btnCancelEdit').style.display = 'none';
    }
    el('qText').value = ''; el('qOptions').value = ''; el('qCorrect').value = '0';
    loadQuestions(section_id);
  } catch (err) {
    showMsg(el('manageMsg'), false, err.body?.error || 'Save failed');
    if (err.status === 401) { localStorage.removeItem(tokenKey); showPanelsForAuth(); }
  }
});

el('btnCancelEdit')?.addEventListener('click', () => {
  editingId = null;
  el('qText').value = ''; el('qOptions').value = ''; el('qCorrect').value = '0';
  el('btnAddQ').textContent = 'Add question';
  el('btnCancelEdit').style.display = 'none';
});

/* Results loader */
el('btnLoadResults')?.addEventListener('click', loadResults);
async function loadResults() {
  try {
    const rows = await apiFetch('/api/admin/results');
    const out = rows.length ? `<table><tr><th>Student</th><th>Exam</th><th>Score</th><th>Submitted</th></tr>` +
      rows.map(r => `<tr><td>${escapeHtml(r.student_name||r.student_email||'')}</td><td>${escapeHtml(r.exam_title||'')}</td><td>${r.score}/${r.max_score}</td><td>${escapeHtml(r.submitted_at||'')}</td></tr>`).join('') + `</table>` :
      '<div class="muted">No results</div>';
    el('resultsList').innerHTML = out;
  } catch (err) {
    showMsg(el('loginMsg'), false, 'Failed to load results');
    if (err.status === 401) { localStorage.removeItem(tokenKey); showPanelsForAuth(); }
  }
}

/* small util */
function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"'`]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;', '`':'&#96;'}[c]));
}

/* refresh button */
el('btnRefresh')?.addEventListener('click', async () => {
  await loadExams();
  const sec = el('sectionSelect').value;
  if (sec) loadQuestions(sec);
});

/* bootstrap on load */
showPanelsForAuth();
