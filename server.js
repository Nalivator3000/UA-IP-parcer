const express = require('express');
const { Pool } = require('pg');
const { stringify } = require('csv-stringify/sync');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:SriKJuzBhROvpXTloDLNQieJgAedbaAq@yamabiko.proxy.rlwy.net:47136/railway',
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Helper function to build WHERE conditions
function buildWhereConditions(params) {
  const conditions = [];
  const values = [];
  let paramIndex = 1;

  // Date range - start from beginning of day, end at end of day
  if (params.startDate && params.endDate) {
    // Start: beginning of the day (00:00:00)
    conditions.push(`ue.event_date >= $${paramIndex}::date`);
    values.push(params.startDate);
    paramIndex++;
    // End: end of the day (23:59:59) - use next day with < to include full last day
    conditions.push(`ue.event_date < ($${paramIndex}::date + INTERVAL '1 day')`);
    values.push(params.endDate);
    paramIndex++;
  }

  // Event types
  if (params.eventTypes && params.eventTypes.length > 0) {
    const placeholders = params.eventTypes.map((_, i) => `$${paramIndex + i}`).join(', ');
    conditions.push(`ue.event_type IN (${placeholders})`);
    values.push(...params.eventTypes);
    paramIndex += params.eventTypes.length;
  }

  // Categories (advertiser)
  if (params.categories && params.categories.length > 0) {
    const placeholders = params.categories.map((_, i) => `$${paramIndex + i}`).join(', ');
    conditions.push(`ue.advertiser IN (${placeholders})`);
    values.push(...params.categories);
    paramIndex += params.categories.length;
  }

  // Deposit amount range
  if (params.minDeposit !== undefined && params.minDeposit !== null && params.minDeposit !== '') {
    conditions.push(`ue.converted_amount >= $${paramIndex}::numeric`);
    values.push(parseFloat(params.minDeposit));
    paramIndex++;
  }
  if (params.maxDeposit !== undefined && params.maxDeposit !== null && params.maxDeposit !== '') {
    conditions.push(`ue.converted_amount <= $${paramIndex}::numeric`);
    values.push(parseFloat(params.maxDeposit));
    paramIndex++;
  }

  return { conditions, values, paramIndex };
}

// Main export endpoint with progress tracking
app.post('/api/export', async (req, res) => {
  try {
    const params = req.body;
    
    // Step 1: Find matching user IDs based on criteria (20% progress)
    let userQuery = `
      SELECT DISTINCT ue.external_user_id
      FROM public.user_events ue
      WHERE ue.external_user_id IS NOT NULL
    `;

    const whereData = buildWhereConditions(params);
    if (whereData.conditions.length > 0) {
      userQuery += ` AND ${whereData.conditions.join(' AND ')}`;
    }

    // Handle "without events" condition with funnel logic (reg->ftd->dep)
    if (params.withoutEvents && params.withoutEvents.length > 0) {
      // Map event types to funnel order
      const funnelOrder = { 'regfinished': 1, 'ftd': 2, 'deposit': 3 };
      
      // Get events for period (main filter)
      const periodConditions = [];
      const periodValues = [];
      let periodIndex = 1;
      
      if (params.startDate && params.endDate) {
        // Start: beginning of the day (00:00:00)
        periodConditions.push(`ue.event_date >= $${periodIndex}::date`);
        periodValues.push(params.startDate);
        periodIndex++;
        // End: end of the day (23:59:59) - use next day with < to include full last day
        periodConditions.push(`ue.event_date < ($${periodIndex}::date + INTERVAL '1 day')`);
        periodValues.push(params.endDate);
        periodIndex++;
      }
      
      if (params.eventTypes && params.eventTypes.length > 0) {
        const placeholders = params.eventTypes.map((_, i) => `$${periodIndex + i}`).join(', ');
        periodConditions.push(`ue.event_type IN (${placeholders})`);
        periodValues.push(...params.eventTypes);
        periodIndex += params.eventTypes.length;
      }
      
      if (params.categories && params.categories.length > 0) {
        const placeholders = params.categories.map((_, i) => `$${periodIndex + i}`).join(', ');
        periodConditions.push(`ue.advertiser IN (${placeholders})`);
        periodValues.push(...params.categories);
        periodIndex += params.categories.length;
      }
      
      // Build query: users with events in period, but WITHOUT excluded events EVER (considering funnel)
      const withoutPlaceholders = params.withoutEvents.map((_, i) => `$${periodIndex + i}`).join(', ');
      
      userQuery = `
        WITH users_in_period AS (
          SELECT DISTINCT ue.external_user_id, MIN(ue.event_date) as first_event_date
          FROM public.user_events ue
          WHERE ue.external_user_id IS NOT NULL
            ${periodConditions.length > 0 ? `AND ${periodConditions.join(' AND ')}` : ''}
          GROUP BY ue.external_user_id
        ),
        users_with_excluded_events AS (
          SELECT DISTINCT ue.external_user_id
          FROM public.user_events ue
          INNER JOIN users_in_period uip ON ue.external_user_id = uip.external_user_id
          WHERE ue.event_type IN (${withoutPlaceholders})
            -- Excluded event must happen AFTER or AT the same time as first event in period
            AND ue.event_date >= uip.first_event_date
        )
        SELECT uip.external_user_id
        FROM users_in_period uip
        WHERE uip.external_user_id NOT IN (SELECT external_user_id FROM users_with_excluded_events)
      `;
      
      whereData.values = periodValues;
      whereData.values.push(...params.withoutEvents);
    }

    // Execute query to get user IDs
    const userResult = await pool.query(userQuery, whereData.values);
    const userIds = userResult.rows.map(row => row.external_user_id);

    if (userIds.length === 0) {
      return res.status(404).json({ error: 'No users found matching the criteria' });
    }

    // Step 2: Get all User Agent and IP pairs for these users (80% progress)
    // Only include rows where both user_agent and ip_address are present
    const placeholders = userIds.map((_, i) => `$${i + 1}`).join(', ');
    
    const exportQuery = `
      SELECT DISTINCT
        ue.external_user_id as user_id,
        ue.user_agent,
        ue.ip_address,
        ue.event_type,
        ue.event_date,
        ue.advertiser,
        ue.website,
        ue.country
      FROM public.user_events ue
      WHERE ue.external_user_id IN (${placeholders})
        AND ue.user_agent IS NOT NULL
        AND ue.user_agent != ''
        AND ue.ip_address IS NOT NULL
        AND ue.ip_address != ''
      ORDER BY ue.external_user_id, ue.event_date
    `;

    const exportResult = await pool.query(exportQuery, userIds);

    // Generate CSV (100% progress)
    const csvData = stringify(exportResult.rows, {
      header: true,
      columns: ['user_id', 'user_agent', 'ip_address', 'event_type', 'event_date', 'advertiser', 'website', 'country']
    });

    // Set headers for CSV download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="ubidex_export_${Date.now()}.csv"`);
    res.send(csvData);

  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get available event types
app.get('/api/event-types', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT event_type, COUNT(*) as count
      FROM public.user_events
      GROUP BY event_type
      ORDER BY count DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching event types:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get available categories (advertisers)
app.get('/api/categories', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT advertiser, COUNT(*) as count
      FROM public.user_events
      WHERE advertiser IS NOT NULL
      GROUP BY advertiser
      ORDER BY count DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    res.status(500).json({ status: 'error', error: error.message });
  }
});

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
});

