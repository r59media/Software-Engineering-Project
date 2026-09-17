import { Hono } from 'hono'
import { cors } from 'hono/cors'

// Import routes
import { contactRouter } from './routes/contact'
import { scheduleRouter } from './routes/schedule'
import { uploadRouter } from './routes/upload'
import { checkoutRouter } from './routes/checkout'
import { portfolioRouter } from './routes/portfolio'
import { servicesRouter } from './routes/services'

export type Bindings = {
  DB: D1Database
  BUCKET: R2Bucket
  SQUARE_ACCESS_TOKEN?: string
  SQUARE_ENVIRONMENT?: string
  SQUARE_LOCATION_ID?: string
  R2_ACCESS_KEY_ID?: string
  R2_SECRET_ACCESS_KEY?: string
  CLOUDFLARE_ACCOUNT_ID?: string
}

const app = new Hono<{ Bindings: Bindings }>()

// Enable CORS for the frontend
app.use('*', cors())

app.get('/', (c) => {
  return c.text('R59 Media API is running!')
})

// Quick healthcheck for the database
app.get('/api/health', async (c) => {
  try {
    const { results } = await c.env.DB.prepare('SELECT * FROM Admin_Settings').all()
    return c.json({ status: 'ok', settings: results })
  } catch (e: any) {
    return c.json({ 
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred while checking health.',
        details: []
      }
    }, 500)
  }
})

// Mount routes
app.route('/api/contact', contactRouter)
app.route('/api/schedule', scheduleRouter)
app.route('/api/upload-url', uploadRouter)
app.route('/api/checkout', checkoutRouter)
app.route('/api/portfolio', portfolioRouter)
app.route('/api/services', servicesRouter)

export default app
