const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = path.join(__dirname, 'database.db');
let db;

/**
 * Initialize DB and create required tables.
 * Returns a Promise that resolves when ready.
 */
function init() {
  return new Promise((resolve, reject) => {
    db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) return reject(err);
      db.serialize(() => {
        db.run('PRAGMA foreign_keys = ON');
        const schema = `
          CREATE TABLE IF NOT EXISTS exams (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT
          );
          CREATE TABLE IF NOT EXISTS sections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            exam_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            question_count INTEGER DEFAULT 0,
            FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE
          );
          CREATE TABLE IF NOT EXISTS questions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            section_id INTEGER NOT NULL,
            text TEXT NOT NULL,
            options_json TEXT NOT NULL,
            correct_index INTEGER DEFAULT 0,
            difficulty TEXT DEFAULT 'medium',
            FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE CASCADE
          );
          CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            email TEXT UNIQUE,
            password TEXT,
            role TEXT DEFAULT 'student'
          );
          CREATE TABLE IF NOT EXISTS results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            exam_id INTEGER,
            attempt_uuid TEXT,
            score INTEGER,
            max_score INTEGER,
            submitted_at TEXT,
            details_json TEXT,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
            FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE SET NULL
          );
        `;
        db.exec(schema, (err) => {
          if (err) return reject(err);
          resolve();
        });
      });
    });
  });
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

module.exports = { init, run, get, all };