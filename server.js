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

    // Enable streaming response for progress updates
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');
    
    // Send initial progress
    res.write(JSON.stringify({ progress: 0, message: 'Начало обработки...' }) + '\n');

    // Execute query to get user IDs
    const userResult = await pool.query(userQuery, whereData.values);
    const userIds = userResult.rows.map(row => row.external_user_id);

    if (userIds.length === 0) {
      res.write(JSON.stringify({ progress: 0, error: 'No users found matching the criteria' }) + '\n');
      return res.end();
    }

    res.write(JSON.stringify({ progress: 20, message: `Найдено ${userIds.length} пользователей. Получение UA/IP...` }) + '\n');

    // Step 2: Get all User Agent and IP pairs for these users (80% progress)
    // First check if columns exist in the table
    const checkColumnsQuery = `
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
        AND table_name = 'user_events' 
        AND column_name IN ('user_agent', 'ip_address')
    `;
    
    const columnsResult = await pool.query(checkColumnsQuery);
    const existingColumns = columnsResult.rows.map(row => row.column_name);
    const hasUserAgent = existingColumns.includes('user_agent');
    const hasIpAddress = existingColumns.includes('ip_address');
    
    // Process in batches to avoid PostgreSQL parameter limit (max ~65535 params)
    // Use batches of 5000 users at a time
    const BATCH_SIZE = 5000;
    const allRows = [];
    const totalBatches = Math.ceil(userIds.length / BATCH_SIZE);
    
    console.log(`[Server] Processing ${userIds.length} users in ${totalBatches} batches of ${BATCH_SIZE}`);
    
    if (hasUserAgent && hasIpAddress) {
      // Process users in batches
      for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
        const batch = userIds.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        console.log(`[Server] Processing batch ${batchNum}/${totalBatches} (${batch.length} users)`);
        
        const placeholders = batch.map((_, idx) => `$${idx + 1}`).join(', ');
        const batchQuery = `
          SELECT 
            ue.user_agent,
            ue.ip_address
          FROM public.user_events ue
          WHERE ue.external_user_id IN (${placeholders})
            AND ue.user_agent IS NOT NULL
            AND ue.user_agent != ''
            AND ue.ip_address IS NOT NULL
            AND ue.ip_address != ''
          GROUP BY ue.user_agent, ue.ip_address
        `;
        
        const batchResult = await pool.query(batchQuery, batch);
        allRows.push(...batchResult.rows);
        
        // Send progress update
        const progress = 20 + Math.floor((i + batch.length) / userIds.length * 60);
        res.write(JSON.stringify({ 
          progress: progress, 
          message: `Обработка батча ${batchNum}/${totalBatches} (${allRows.length} записей получено)...` 
        }) + '\n');
      }
      
      // Remove duplicates (in case same UA+IP pair appears in multiple batches)
      const uniqueRows = Array.from(
        new Map(allRows.map(row => [`${row.user_agent}|${row.ip_address}`, row])).values()
      );
      
      console.log(`[Server] Total unique UA+IP pairs: ${uniqueRows.length} (from ${allRows.length} total)`);
      
      // Sort results
      uniqueRows.sort((a, b) => {
        if (a.user_agent !== b.user_agent) {
          return (a.user_agent || '').localeCompare(b.user_agent || '');
        }
        return (a.ip_address || '').localeCompare(b.ip_address || '');
      });
      
      var exportResult = { rows: uniqueRows };
    } else {
      // If columns don't exist, return empty result
      var exportResult = { rows: [] };
    }

    res.write(JSON.stringify({ progress: 80, message: `Получено ${exportResult.rows.length} записей. Генерация CSV...` }) + '\n');

    // Generate CSV (100% progress)
    // Only export UA+IP pairs
    const columns = ['user_agent', 'ip_address'];
    
    const csvData = stringify(exportResult.rows, {
      header: true,
      columns: columns
    });

    res.write(JSON.stringify({ progress: 100, message: 'CSV файл успешно сгенерирован!' }) + '\n');

    // Set headers for CSV download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="ubidex_export_${Date.now()}.csv"`);
    res.write(csvData);
    res.end();

  } catch (error) {
    console.error('Export error:', error);
    res.write(JSON.stringify({ progress: 0, error: error.message }) + '\n');
    res.end();
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

