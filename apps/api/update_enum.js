const { pool, q } = require('./src/db');
(async () => {
  try {
    const companies = await q('SELECT schema_name FROM companies');
    for (const c of companies) {
      const schema = c.schema_name;
      const res = await pool.query(`
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = '${schema}.attendance'::regclass
          AND contype = 'c'
      `);
      for (const row of res.rows) {
        if (row.conname.includes('status') || row.conname.includes('attendance')) {
          await pool.query(`ALTER TABLE ${schema}.attendance DROP CONSTRAINT IF EXISTS ${row.conname}`);
        }
      }
      await pool.query(`
        ALTER TABLE ${schema}.attendance 
        ADD CHECK (status IN ('Present','Absent','Half Day','WFH','Leave','Holiday','Weekend','LOP','SL','EL'))
      `);
      console.log(`Updated schema: ${schema}`);
    }
    console.log("Done");
  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
})();
