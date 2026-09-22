const { pool } = require('./src/db');
(async () => {
  try {
    const schemas = (await pool.query("SELECT schema_name FROM companies")).rows;
    for (const {schema_name} of schemas) {
      console.log('Schema:', schema_name);
      const res = await pool.query(`SELECT to_email, subject, status, created_at FROM ${schema_name}.email_log ORDER BY id DESC LIMIT 5`);
      console.log(res.rows);
    }
  } catch (e) {
    console.error(e);
  } finally {
    process.exit();
  }
})();
