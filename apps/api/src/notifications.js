const { tq } = require('./db');

async function addNotification(schema, employeeId, title, body, link) {
  try {
    await tq(schema, `
      INSERT INTO {s}.notifications (employee_id, title, body, link)
      VALUES ($1, $2, $3, $4)`,
      [employeeId || null, title, body, link || null]);
  } catch (err) {
    console.error('[notifications] failed to insert notification:', err.message);
  }
}

module.exports = { addNotification };