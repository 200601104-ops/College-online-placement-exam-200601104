import { api, setToken, getToken } from '/api.js';

// If on student-login page
const loginForm = document.getElementById('student-login-form');
if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(loginForm);
    try {
      const { token } = await api('/api/student/login', {
        method: 'POST',
        body: JSON.stringify({ name: fd.get('name'), email: fd.get('email') })
      });
      setToken(token);
      window.location.href = '/exam.html';
    } catch (err) { alert(err.message); }
  });
}

// Exam page logic
const examSel = document.getElementById('exam-select');
const sectionSel = document.getElementById('section-select');
const btnStart = document.getElementById('btn-start');
const list = document.getElementById('q-list');
const wrap = document.getElementById('qs');
const btnSubmit = document.getElementById('btn-submit');
const result = document.getElementById('result');

async function loadCatalog() {
  const exams = await api('/api/exams');
  examSel.innerHTML = exams.map(e => `<option value="${e.id}">${e.title}</option>`).join('');

  // ensure we use numeric IDs and bind change properly
  examSel.removeEventListener?.('change', () => {});
  examSel.addEventListener('change', () => {
    const id = Number(examSel.value);
    console.log('exam changed ->', id);
    loadSections(id).catch(err => console.error('loadSections on change failed', err));
  });

  const selectedId = Number(examSel.value) || Number(exams[0]?.id);
  if (selectedId) {
    examSel.value = selectedId;
    console.log('loadCatalog selected examId ->', selectedId);
    await loadSections(selectedId);
  } else {
    sectionSel.innerHTML = '';
  }
}

async function loadSections(examId) {
  try {
    if (!examId) {
      sectionSel.innerHTML = '';
      return;
    }
    // fetch sections for the selected exam
    const sections = await api(`/api/exams/${examId}/sections`);
    sectionSel.innerHTML = sections.map(s => `<option value="${s.id}">${s.title || s.name || 'Section ' + s.id}</option>`).join('');
    // set first section if none selected
    if (!sectionSel.value && sections.length) sectionSel.value = sections[0].id;
  } catch (err) {
    console.error('loadSections error', err);
    sectionSel.innerHTML = '<option value="">Failed to load sections</option>';
  }
}

if (examSel && sectionSel) {
  if (!getToken()) window.location.href = '/student-login.html';
  loadCatalog();
}

btnStart?.addEventListener('click', async () => {
  const sid = sectionSel.value;
  const qs = await api(`/api/sections/${sid}/questions`);
  list.innerHTML = qs.map((q, i) => {
    if (q.type === 'theory') {
      return `<li class="p-4 rounded-lg border border-slate-200">
        <p class="font-medium">${i+1}. ${q.text}</p>
        <textarea class="input mt-2" rows="3" name="q_${q.id}" placeholder="Type your answer here..."></textarea>
      </li>`;
    } else {
      const opts = q.options_json ? JSON.parse(q.options_json) : [];
      return `<li class="p-4 rounded-lg border border-slate-200">
        <p class="font-medium">${i+1}. ${q.text}</p>
        <div class="mt-2 grid gap-2">
          ${opts.map((o, j) => `
            <label class="flex items-center gap-2">
              <input type="radio" name="q_${q.id}" value="${j}">
              <span>${o}</span>
            </label>`).join('')}
        </div>
      </li>`;
    }
  }).join('');
  wrap.classList.remove('hidden');
});

btnSubmit?.addEventListener('click', async () => {
  try {
    const sectionId = Number(sectionSel.value);
    const exam_id = Number(examSel.value);
    // re-fetch questions to get authoritative correct_index/type
    const qs = await api(`/api/sections/${sectionId}/questions`);

    let score = 0;
    let max_score = 0;
    const details = qs.map(q => {
      if (q.type === 'theory') {
        const ta = document.querySelector(`textarea[name="q_${q.id}"]`);
        return { id: q.id, type: 'theory', text: ta ? ta.value : '' };
      } else {
        const checked = document.querySelector(`input[name="q_${q.id}"]:checked`);
        const selected = checked ? Number(checked.value) : null;
        // normalize correct_index to Number to avoid string/number mismatch
        const correct_index = Number(q.correct_index ?? 0);
        // count only objective questions for auto-score
        max_score += 1;
        if (selected !== null && selected === correct_index) score += 1;
        return { id: q.id, type: 'objective', selected, correct_index };
      }
    });

    const attempt_uuid = Math.random().toString(36).slice(2) + Date.now().toString(36);

    // ensure we send valid JSON string to the server (avoid "[object Object]" body)
    const payload = {
      exam_id,
      attempt_uuid,
      details_json: JSON.stringify(details),
      score,
      max_score,
      submitted_at: new Date().toISOString()
    };

    const saved = await api('/api/results', {
      method: 'POST',
      body: JSON.stringify(payload) // <- stringify here
    });

    result.textContent = `Submitted. Auto-score: ${score}/${max_score}. (Theory questions require manual grading.)`;
  } catch (err) {
    console.error(err);
    alert('Submission failed: ' + (err?.body?.error || err.message || 'network error'));
  }
});

// Before (problem)
// const toRender = questions.slice(0,2);

// After (show all)
const toRender = questions;
