import { Hono } from 'hono'
import { Bindings } from '../index'
import { adminAuth } from '../middleware/auth'

export const adminRouter = new Hono<{ Bindings: Bindings }>()

// All admin routes require auth
adminRouter.use('*', adminAuth)

// ── Schedule Management ──────────────────────────────────────────

// POST: Add a new available timeslot
adminRouter.post('/schedule', async (c) => {
  try {
    const body = await c.req.json()
    const { date, start_time, end_time } = body

    const errors = []
    if (!date) errors.push({ field: 'date', message: 'Date is required (YYYY-MM-DD).', code: 'REQUIRED_FIELD' })
    if (!start_time) errors.push({ field: 'start_time', message: 'Start time is required (HH:MM).', code: 'REQUIRED_FIELD' })
    if (!end_time) errors.push({ field: 'end_time', message: 'End time is required (HH:MM).', code: 'REQUIRED_FIELD' })

    if (errors.length > 0) {
      return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Could not create slot.', details: errors } }, 400)
    }

    await c.env.DB.prepare(
      'INSERT INTO Schedule_Slots (date, start_time, end_time) VALUES (?, ?, ?)'
    ).bind(date, start_time, end_time).run()

    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not create schedule slot.', details: [] } }, 500)
  }
})

// DELETE: Remove a timeslot (only if not booked)
adminRouter.delete('/schedule/:id', async (c) => {
  try {
    const id = c.req.param('id')
    const result = await c.env.DB.prepare(
      'DELETE FROM Schedule_Slots WHERE id = ? AND is_booked = 0'
    ).bind(id).run()

    if (result.meta.changes === 0) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Slot not found or already booked.', details: [] } }, 404)
    }

    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not delete slot.', details: [] } }, 500)
  }
})

// ── Bookings ─────────────────────────────────────────────────────

// GET: View all bookings
adminRouter.get('/bookings', async (c) => {
  try {
    const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 100)
    const offset = parseInt(c.req.query('offset') || '0', 10)

    const { results } = await c.env.DB.prepare(
      `SELECT b.id, b.client_name, b.client_email, b.price_at_booking, b.square_payment_id, b.status, b.created_at,
              s.name as service_name, sl.date, sl.start_time, sl.end_time
       FROM Bookings b
       LEFT JOIN Services s ON b.service_id = s.id
       LEFT JOIN Schedule_Slots sl ON b.slot_id = sl.id
       ORDER BY b.created_at DESC
       LIMIT ? OFFSET ?`
    ).bind(limit, offset).all()

    return c.json({ bookings: results, limit, offset })
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not fetch bookings.', details: [] } }, 500)
  }
})

// ── Leads ────────────────────────────────────────────────────────

// GET: View all contact submissions
adminRouter.get('/leads', async (c) => {
  try {
    const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 100)
    const offset = parseInt(c.req.query('offset') || '0', 10)

    const { results } = await c.env.DB.prepare(
      'SELECT id, name, email, phone, session_type, message, created_at FROM Leads ORDER BY created_at DESC LIMIT ? OFFSET ?'
    ).bind(limit, offset).all()

    return c.json({ leads: results, limit, offset })
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not fetch leads.', details: [] } }, 500)
  }
})
