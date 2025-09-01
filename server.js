// server.js - Teacher-Friendly Upgrade (subjects & rules from UI)
require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { init, all, get, run } = require('./db');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';

function signToken(payload, role) {
  return jwt.sign({ ...payload, role }, JWT_SECRET, { expiresIn: '8h' });
}

/*
  Require JWT auth. If `role` is provided it enforces that role (e.g. 'admin' or 'student').
  Attaches decoded token to req.user.
*/
function requireAuth(role = null) {
  return (req, res, next) => {
    const hdr = req.headers.authorization || '';
    const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing authorization token' });

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (role && decoded.role !== role) return res.status(403).json({ error: 'Insufficient role' });
      req.user = decoded;
      next();
    } catch (e) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  };
}

// ---- Init & Auto-migrate to add teacher-friendly columns if missing
async function autoMigrate() {
  function colExists(columns, name) { return columns.some(c => c.name === name); }
  const qCols = await all('PRAGMA table_info(questions)');
  if (!colExists(qCols, 'type')) await run("ALTER TABLE questions ADD COLUMN type TEXT DEFAULT 'objective'");
  if (!colExists(qCols, 'answer_text')) await run("ALTER TABLE questions ADD COLUMN answer_text TEXT");
  const sCols = await all('PRAGMA table_info(sections)');
  if (!colExists(sCols, 'duration_minutes')) await run("ALTER TABLE sections ADD COLUMN duration_minutes INTEGER");
  if (!colExists(sCols, 'question_mode')) await run("ALTER TABLE sections ADD COLUMN question_mode TEXT DEFAULT 'objective'");
}
init().then(() => autoMigrate().then(() => console.log('DB ready + migrated')).catch(console.error));
async function autoMigrate() {
  // exams.duration_minutes
  const examCols = await all('PRAGMA table_info(exams)');
  if (!examCols.some(c => c.name === 'duration_minutes')) {
    await run("ALTER TABLE exams ADD COLUMN duration_minutes INTEGER");
    await run("UPDATE exams SET duration_minutes = 40 WHERE duration_minutes IS NULL");
    console.log('Migrated: exams.duration_minutes');
  }

  // sections extras (if you use them)
  const sCols = await all('PRAGMA table_info(sections)');
  if (!sCols.some(c => c.name === 'duration_minutes'))
    await run("ALTER TABLE sections ADD COLUMN duration_minutes INTEGER");
  if (!sCols.some(c => c.name === 'question_mode'))
    await run("ALTER TABLE sections ADD COLUMN question_mode TEXT DEFAULT 'objective'");

  // questions extras (if you use them)
  const qCols = await all('PRAGMA table_info(questions)');
  if (!qCols.some(c => c.name === 'type'))
    await run("ALTER TABLE questions ADD COLUMN type TEXT DEFAULT 'objective'");
  if (!qCols.some(c => c.name === 'answer_text'))
    await run("ALTER TABLE questions ADD COLUMN answer_text TEXT");
}

init().then(() => autoMigrate()).catch(console.error);

// ---- Auth
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    const token = signToken({ username }, 'admin');
    return res.json({ token });
  }
  return res.status(401).json({ error: 'Invalid credentials' });
});

app.post('/api/student/login', async (req, res) => {
  try {
    const { name, email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    // try to find existing student
    let user = await get('SELECT * FROM users WHERE email = ?', [email]);
    if (!user) {
      const r = await run('INSERT INTO users (name, email, role) VALUES (?, ?, ?)', [name || null, email, 'student']);
      const id = r.id;
      user = await get('SELECT * FROM users WHERE id = ?', [id]);
    }
    const token = signToken({ user_id: user.id, name: user.name || '', email: user.email }, 'student');
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to login student' });
  }
});

// ---- Admin: view student results
app.get('/api/admin/results', requireAuth('admin'), async (_req, res) => {
  try {
    const rows = await all(
      `SELECT r.*, u.name AS student_name, u.email AS student_email, e.title AS exam_title
       FROM results r
       LEFT JOIN users u ON r.user_id = u.id
       LEFT JOIN exams e ON r.exam_id = e.id
       ORDER BY datetime(r.submitted_at) DESC`
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch results' });
  }
});

app.get('/api/admin/results/:id', requireAuth('admin'), async (req, res) => {
  try {
    const id = req.params.id;
    const row = await get(
      `SELECT r.*, u.name AS student_name, u.email AS student_email, e.title AS exam_title
       FROM results r
       LEFT JOIN users u ON r.user_id = u.id
       LEFT JOIN exams e ON r.exam_id = e.id
       WHERE r.id = ?`, [id]
    );
    if (!row) return res.status(404).json({ error: 'Result not found' });
    res.json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch result' });
  }
});

// ---- Catalog (public)
app.get('/api/exams', async (_req, res) => {
  try { res.json(await all('SELECT * FROM exams ORDER BY id')); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/exams/:examId/sections', async (req, res) => {
  try { res.json(await all('SELECT * FROM sections WHERE exam_id = ? ORDER BY id', [req.params.examId])); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Admin: manage exams & sections (subjects)
app.get('/api/admin/exams', requireAuth('admin'), async (_req, res) => {
  try { res.json(await all('SELECT * FROM exams ORDER BY id')); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/admin/exams', requireAuth('admin'), async (req, res) => {
  try {
    const { title, duration_minutes = 40 } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });
    const ins = await run('INSERT INTO exams (title, duration_minutes) VALUES (?,?)', [title, duration_minutes]);
    res.json(await get('SELECT * FROM exams WHERE id = ?', [ins.id]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/admin/exams/:id', requireAuth('admin'), async (req, res) => {
  try {
    const { title, duration_minutes } = req.body;
    const cur = await get('SELECT * FROM exams WHERE id = ?', [req.params.id]);
    if (!cur) return res.status(404).json({ error: 'Not found' });
    await run('UPDATE exams SET title = ?, duration_minutes = ? WHERE id = ?',
      [title ?? cur.title, (duration_minutes ?? cur.duration_minutes), req.params.id]);
    res.json(await get('SELECT * FROM exams WHERE id = ?', [req.params.id]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/admin/exams/:id', requireAuth('admin'), async (req, res) => {
  try { await run('DELETE FROM exams WHERE id = ?', [req.params.id]); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/sections', requireAuth('admin'), async (req, res) => {
  try {
    const { exam_id, name, question_count = 10, duration_minutes = null, question_mode = 'objective' } = req.body;
    if (!exam_id || !name) return res.status(400).json({ error: 'exam_id and name required' });
    const ins = await run('INSERT INTO sections (exam_id, name, question_count, duration_minutes, question_mode) VALUES (?,?,?,?,?)',
      [exam_id, name, question_count, duration_minutes, question_mode]);
    res.json(await get('SELECT * FROM sections WHERE id = ?', [ins.id]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/admin/sections/:id', requireAuth('admin'), async (req, res) => {
  try {
    const cur = await get('SELECT * FROM sections WHERE id = ?', [req.params.id]);
    if (!cur) return res.status(404).json({ error: 'Not found' });
    const { name, question_count, duration_minutes, question_mode } = req.body;
    await run('UPDATE sections SET name=?, question_count=?, duration_minutes=?, question_mode=? WHERE id=?',
      [name ?? cur.name,
       (question_count ?? cur.question_count),
       (duration_minutes ?? cur.duration_minutes),
       (question_mode ?? cur.question_mode),
       req.params.id]);
    res.json(await get('SELECT * FROM sections WHERE id = ?', [req.params.id]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/admin/sections/:id', requireAuth('admin'), async (req, res) => {
  try { await run('DELETE FROM sections WHERE id = ?', [req.params.id]); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Questions
app.get('/api/admin/sections/:sectionId/questions', requireAuth('admin'), async (req, res) => {
  try {
    const list = await all('SELECT * FROM questions WHERE section_id = ? ORDER BY id', [req.params.sectionId]);
    res.json(list);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/questions', requireAuth('admin'), async (req, res) => {
  try {
    const { section_id, text, options, correct_index = 0, difficulty = 'medium', type = 'objective', answer_text = null } = req.body;
    if (!section_id || !text || !Array.isArray(options)) {
      return res.status(400).json({ error: 'section_id, text and options(array) are required' });
    }
    const options_json = JSON.stringify(options);
    const r = await run(
      `INSERT INTO questions (section_id, text, options_json, correct_index, difficulty, type, answer_text)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [section_id, text, options_json, correct_index, difficulty, type, answer_text]
    );
    res.status(201).json({ id: r.id, message: 'Question created' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create question' });
  }
});

// ---- Admin: delete question
app.delete('/api/admin/questions/:id', requireAuth('admin'), async (req, res) => {
  try {
    const id = req.params.id;
    const r = await run('DELETE FROM questions WHERE id = ?', [id]);
    if (r.changes === 0) return res.status(404).json({ error: 'Question not found' });
    res.json({ message: 'Question deleted' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to delete question' });
  }
});

// ---- Admin: edit question
app.put('/api/admin/questions/:id', requireAuth('admin'), async (req, res) => {
  try {
    const id = req.params.id;
    const { section_id, text, options, correct_index = 0, difficulty = 'medium', type = 'objective', answer_text = null } = req.body;
    if (!section_id || !text || !Array.isArray(options)) {
      return res.status(400).json({ error: 'section_id, text and options(array) are required' });
    }
    const options_json = JSON.stringify(options);
    const r = await run(
      `UPDATE questions SET section_id = ?, text = ?, options_json = ?, correct_index = ?, difficulty = ?, type = ?, answer_text = ? WHERE id = ?`,
      [section_id, text, options_json, correct_index, difficulty, type, answer_text, id]
    );
    if (r.changes === 0) return res.status(404).json({ error: 'Question not found' });
    res.json({ message: 'Question updated' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update question' });
  }
});

// ---- Student fetch questions per section with mode
app.get('/api/sections/:sectionId/questions', async (req, res) => {
  try {
    const sectionId = req.params.sectionId;
    const qs = await all(
      `SELECT id, section_id, text, options_json, correct_index, difficulty
       FROM questions
       WHERE section_id = ?`,
      [sectionId]
    );
    res.json(qs);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load questions' });
  }
});

// ---- Student submit (auto-score objective; theory left for manual review)
app.post('/api/results', requireAuth('student'), async (req, res) => {
  try {
    // Accept either details_json string or already-parsed object
    const { exam_id, attempt_uuid, details_json, score: clientScore, max_score: clientMax, submitted_at } = req.body;
    const details = typeof details_json === 'string' ? JSON.parse(details_json) : details_json || [];

    // Recalculate server-side to avoid trusting client
    let score = 0;
    let max_score = 0;

    for (const item of Array.isArray(details) ? details : []) {
      if (item.type === 'objective') {
        max_score += 1;
        // fetch canonical correct_index from DB
        const q = await get('SELECT correct_index FROM questions WHERE id = ?', [item.id]);
        const correct = Number(q?.correct_index ?? 0);
        const selected = Number(item.selected ?? -1);
        if (selected === correct) score += 1;
      }
      // theory questions are not auto-scored here
    }

    // persist result (store details_json as JSON text)
    await run(
      `INSERT INTO results (user_id, exam_id, attempt_uuid, score, max_score, submitted_at, details_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,

      [req.user.user_id || null, exam_id, attempt_uuid, score, max_score, submitted_at || new Date().toISOString(), JSON.stringify(details)]
    );

    return res.json({ message: 'Submitted', score, max_score });
  } catch (e) {
    console.error('POST /api/results error', e);
    return res.status(500).json({ error: 'Failed to submit results' });
  }
});

// root
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
