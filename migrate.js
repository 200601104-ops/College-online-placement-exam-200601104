// migrate.js
const { init, all, run } = require('./db');
(async () => {
  try {
    await init(); // <--- ensure DB is initialized before using all/run
    const cols = await all("PRAGMA table_info(exams)");
    const has = cols.some(c => c.name === 'duration_minutes');
    if (!has) {
      await run("ALTER TABLE exams ADD COLUMN duration_minutes INTEGER");
      await run("UPDATE exams SET duration_minutes = 40 WHERE duration_minutes IS NULL");
      console.log("Added exams.duration_minutes and backfilled 40.");
    } else {
      console.log("exams.duration_minutes already exists.");
    }
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
