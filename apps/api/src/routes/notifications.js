const express = require('express');
const { tq, tqOne } = require('../db');
const { authenticate, tenant } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, tenant);

// GET /api/notifications — list of latest 50 notifications of interest to the user
router.get('/', async (req, res, next) => {
  try {
    const empId = req.user.employeeId; // might be null for platform admin, but they don't get notifications
    const rows = await tq(req.s, `
      SELECT id, title, body, link, is_read, created_at
      FROM {s}.notifications
      WHERE employee_id = $1 OR employee_id IS NULL
      ORDER BY id DESC LIMIT 50`, [empId || null]);
    res.json(rows);
  } catch (e) { next(e); }
});

// PUT /api/notifications/:id/read — mark a single notification as read
router.put('/:id/read', async (req, res, next) => {
  try {
    const empId = req.user.employeeId;
    await tq(req.s, `
      UPDATE {s}.notifications
      SET is_read = TRUE
      WHERE id = $1 AND (employee_id = $2 OR employee_id IS NULL)`,
      [req.params.id, empId || null]);
    res.json({ message: 'Notification marked as read' });
  } catch (e) { next(e); }
});

// PUT /api/notifications/read-all — mark all notifications as read
router.put('/read-all', async (req, res, next) => {
  try {
    const empId = req.user.employeeId;
    await tq(req.s, `
      UPDATE {s}.notifications
      SET is_read = TRUE
      WHERE (employee_id = $1 OR employee_id IS NULL) AND is_read = FALSE`,
      [empId || null]);
    res.json({ message: 'All notifications marked as read' });
  } catch (e) { next(e); }
});

module.exports = router;