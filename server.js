const express = require('express');
const { Pool } = require('pg');
const { stringify } = require('csv-stringify/sync');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// PostgreSQL connection pool with timeout settings
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:SriKJuzBhROvpXTloDLNQieJgAedbaAq@yamabiko.proxy.rlwy.net:47136/railway',
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
  // Timeout settings
  connectionTimeoutMillis: 10000, // 10 seconds to connect
  query_timeout: 300000, // 5 minutes for queries (300 seconds)
  statement_timeout: 300000, // 5 minutes for statements
  idle_in_transaction_session_timeout: 300000, // 5 minutes
  // Pool settings
  max: 10, // Maximum number of clients in the pool
  min: 2, // Minimum number of clients in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Request logging middleware
app.use((req, res, next) => {
  req.requestId = Date.now();
  console.log(`[${req.requestId}] ${req.method} ${req.path}`);
  next();
});

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
  const requestId = Date.now();
  console.log(`[${requestId}] ====== NEW EXPORT REQUEST ======`);
  console.log(`[${requestId}] Request params:`, JSON.stringify(req.body, null, 2));
  
  // Set overall request timeout (10 minutes)
  const REQUEST_TIMEOUT = 600000; // 10 minutes
  const timeoutId = setTimeout(() => {
    if (!res.headersSent) {
      console.error(`[${requestId}] Request timeout after ${REQUEST_TIMEOUT}ms`);
      res.status(504).json({ error: 'Request timeout. The export is taking too long. Try reducing the date range or number of users.' });
    }
  }, REQUEST_TIMEOUT);
  
  // Cleanup timeout on response end
  res.on('finish', () => clearTimeout(timeoutId));
  res.on('close', () => clearTimeout(timeoutId));
  
  try {
    const params = req.body;

    // Step 1: Find matching user IDs based on criteria (20% progress)
    let userQuery = `
      SELECT DISTINCT ue.external_user_id
      FROM public.user_events ue
      WHERE ue.external_user_id IS NOT NULL
    `;

    const whereData = buildWhereConditions(params);
    console.log(`[${requestId}] WHERE conditions:`, whereData.conditions);
    console.log(`[${requestId}] WHERE values count:`, whereData.values.length);
    
    if (whereData.conditions.length > 0) {
      userQuery += ` AND ${whereData.conditions.join(' AND ')}`;
    }
    
    console.log(`[${requestId}] User query (first 500 chars):`, userQuery.substring(0, 500));

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

    // Set CSV headers - we'll send progress as JSON lines that client will filter
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ubidex_export_${Date.now()}.csv"`);
    res.setHeader('Transfer-Encoding', 'chunked');
    
    // Send initial progress as JSON (client will filter these lines)
    res.write(JSON.stringify({ progress: 0, message: 'Начало обработки...' }) + '\n');

    // Execute query to get user IDs
    console.log(`[${requestId}] Executing user query...`);
    const queryStartTime = Date.now();
    
    // Add query timeout wrapper
    const userQueryPromise = pool.query(userQuery, whereData.values);
    const userQueryTimeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`User query timeout after 60 seconds`)), 60000);
    });
    
    const userResult = await Promise.race([userQueryPromise, userQueryTimeoutPromise]);
    const queryTime = Date.now() - queryStartTime;
    console.log(`[${requestId}] User query executed in ${queryTime}ms`);
    console.log(`[${requestId}] User query returned ${userResult.rows.length} rows`);
    
    const userIds = userResult.rows.map(row => row.external_user_id);
    console.log(`[${requestId}] Extracted ${userIds.length} unique user IDs`);
    console.log(`[${requestId}] Sample user IDs:`, userIds.slice(0, 5));

    if (userIds.length === 0) {
      console.log(`[${requestId}] ERROR: No users found matching criteria`);
      res.write(JSON.stringify({ progress: 0, error: 'No users found matching the criteria' }) + '\n');
      return res.end();
    }

    console.log(`[Server] Found ${userIds.length} users, starting batch processing...`);
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
    
    console.log(`[Server] Checking if columns exist...`);
    
    // Add query timeout wrapper
    const columnsQueryPromise = pool.query(checkColumnsQuery);
    const columnsQueryTimeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Columns check timeout after 30 seconds`)), 30000);
    });
    
    const columnsResult = await Promise.race([columnsQueryPromise, columnsQueryTimeoutPromise]);
    const existingColumns = columnsResult.rows.map(row => row.column_name);
    const hasUserAgent = existingColumns.includes('user_agent');
    const hasIpAddress = existingColumns.includes('ip_address');
    
    console.log(`[Server] Columns check: hasUserAgent=${hasUserAgent}, hasIpAddress=${hasIpAddress}`);
    console.log(`[Server] Existing columns:`, existingColumns);
    
    if (!hasUserAgent || !hasIpAddress) {
      console.error(`[Server] ERROR: Columns missing! hasUserAgent=${hasUserAgent}, hasIpAddress=${hasIpAddress}`);
      res.write(JSON.stringify({ progress: 0, error: `Колонки не найдены: user_agent=${hasUserAgent}, ip_address=${hasIpAddress}` }) + '\n');
      return res.end();
    }
    
    // Process in batches to avoid PostgreSQL parameter limit (max ~65535 params)
    // Use batches of 5000 users at a time
    const BATCH_SIZE = 5000;
    const allRows = [];
    const totalBatches = Math.ceil(userIds.length / BATCH_SIZE);
    
    console.log(`[Server] Processing ${userIds.length} users in ${totalBatches} batches of ${BATCH_SIZE}`);
    
    if (hasUserAgent && hasIpAddress) {
      console.log(`[Server] Both columns exist, starting batch processing...`);
      // Process users in batches
      for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
        const batch = userIds.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        console.log(`[Server] Processing batch ${batchNum}/${totalBatches} (${batch.length} users)`);
        
        try {
          const placeholders = batch.map((_, idx) => `$${idx + 1}`).join(', ');
          console.log(`[Server] Batch ${batchNum}: Created ${batch.length} placeholders`);
          
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
          
          console.log(`[Server] Batch ${batchNum}: Executing query with ${batch.length} parameters`);
          console.log(`[Server] Batch ${batchNum}: Sample user IDs:`, batch.slice(0, 3));
          
          const batchQueryStartTime = Date.now();
          
          // Add query timeout wrapper
          const queryPromise = pool.query(batchQuery, batch);
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`Query timeout after 60 seconds`)), 60000);
          });
          
          const batchResult = await Promise.race([queryPromise, timeoutPromise]);
          const batchQueryTime = Date.now() - batchQueryStartTime;
          console.log(`[${requestId}] Batch ${batchNum}: Query executed in ${batchQueryTime}ms, got ${batchResult.rows.length} rows`);
          
          if (batchResult.rows.length > 0) {
            console.log(`[${requestId}] Batch ${batchNum}: Sample rows:`, JSON.stringify(batchResult.rows.slice(0, 2), null, 2));
            // Проверяем наличие данных в полях
            const sampleRow = batchResult.rows[0];
            console.log(`[${requestId}] Batch ${batchNum}: Sample row check - user_agent length: ${sampleRow.user_agent?.length || 0}, ip_address length: ${sampleRow.ip_address?.length || 0}`);
          } else {
            console.log(`[${requestId}] Batch ${batchNum}: WARNING - No rows returned, checking if users have UA/IP data...`);
            // Проверяем, есть ли вообще данные для этих пользователей
            const checkQuery = `
              SELECT 
                COUNT(*) as total_events,
                COUNT(CASE WHEN user_agent IS NOT NULL AND user_agent != '' THEN 1 END) as events_with_ua,
                COUNT(CASE WHEN ip_address IS NOT NULL AND ip_address != '' THEN 1 END) as events_with_ip,
                COUNT(CASE WHEN user_agent IS NOT NULL AND user_agent != '' AND ip_address IS NOT NULL AND ip_address != '' THEN 1 END) as events_with_both
              FROM public.user_events ue
              WHERE ue.external_user_id IN (${placeholders})
            `;
            const checkResult = await pool.query(checkQuery, batch);
            console.log(`[${requestId}] Batch ${batchNum}: Data check for batch users:`, checkResult.rows[0]);
          }
          
          allRows.push(...batchResult.rows);
          
          // Send progress update
          const progress = 20 + Math.floor((i + batch.length) / userIds.length * 60);
          res.write(JSON.stringify({ 
            progress: progress, 
            message: `Обработка батча ${batchNum}/${totalBatches} (${allRows.length} записей получено)...` 
          }) + '\n');
        } catch (batchError) {
          console.error(`[Server] Error in batch ${batchNum}:`, batchError);
          console.error(`[Server] Error stack:`, batchError.stack);
          throw batchError;
        }
      }
      
      console.log(`[Server] All batches processed. Total rows before deduplication: ${allRows.length}`);
      
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
      console.log(`[Server] Columns missing: hasUserAgent=${hasUserAgent}, hasIpAddress=${hasIpAddress}`);
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

    // Send CSV data
    res.write(csvData);
    res.end();
    
    // Clear timeout on successful completion
    clearTimeout(timeoutId);

  } catch (error) {
    const requestId = req.requestId || Date.now();
    console.error(`[${requestId}] ====== EXPORT ERROR ======`);
    console.error(`[${requestId}] Error type:`, error.constructor.name);
    console.error(`[${requestId}] Error message:`, error.message);
    console.error(`[${requestId}] Error stack:`, error.stack);
    if (error.code) {
      console.error(`[${requestId}] PostgreSQL error code:`, error.code);
    }
    if (error.detail) {
      console.error(`[${requestId}] PostgreSQL error detail:`, error.detail);
    }
    if (error.hint) {
      console.error(`[${requestId}] PostgreSQL error hint:`, error.hint);
    }
    
    // Clear timeout on error
    clearTimeout(timeoutId);
    
    // Try to send error to client if response is still writable
    try {
      if (!res.headersSent) {
        res.setHeader('Content-Type', 'application/json');
      }
      res.write(JSON.stringify({ progress: 0, error: error.message }) + '\n');
      res.end();
    } catch (writeError) {
      console.error('[Server] Failed to write error to response:', writeError);
      // Response might already be closed, just end it
      try {
        res.end();
      } catch (e) {
        // Ignore
      }
    }
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

// Test database connection on startup
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('❌ Database connection failed:', err.message);
  } else {
    console.log('✅ Database connection successful');
    console.log('   Server time:', res.rows[0].now);
  }
});

// Check if columns exist on startup
pool.query(`
  SELECT column_name 
  FROM information_schema.columns 
  WHERE table_schema = 'public' 
    AND table_name = 'user_events' 
    AND column_name IN ('user_agent', 'ip_address')
`, (err, res) => {
  if (err) {
    console.error('❌ Failed to check columns:', err.message);
  } else {
    const columns = res.rows.map(row => row.column_name);
    console.log('📊 Available columns in user_events:', columns);
    if (columns.includes('user_agent') && columns.includes('ip_address')) {
      console.log('✅ Required columns (user_agent, ip_address) are present');
    } else {
      console.log('⚠️  WARNING: Missing columns!');
      console.log('   user_agent:', columns.includes('user_agent') ? '✅' : '❌');
      console.log('   ip_address:', columns.includes('ip_address') ? '✅' : '❌');
    }
  }
});

app.listen(PORT, () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`📱 Open http://localhost:${PORT} in your browser\n`);
});

