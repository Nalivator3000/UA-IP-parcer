const express = require('express');
const { Pool } = require('pg');
const { stringify } = require('csv-stringify/sync');
const path = require('path');
const packageJson = require('./package.json');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const APP_VERSION = packageJson.version;

// Cache for event types (initialize with default values) - MUST be declared before routes
let eventTypesCache = null;
let eventTypesCacheTime = 0;
const EVENT_TYPES_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// PostgreSQL connection pool with timeout settings
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:SriKJuzBhROvpXTloDLNQieJgAedbaAq@yamabiko.proxy.rlwy.net:47136/railway',
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
  // Timeout settings (increased to 10 minutes)
  connectionTimeoutMillis: 30000, // 30 seconds to connect
  // Note: query_timeout is not a valid PostgreSQL parameter, only statement_timeout is supported
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
    console.log(`[buildWhereConditions] Filtering by advertiser:`, params.categories);
    // Map old values to new values for backward compatibility
    const mappedCategories = params.categories.map(cat => {
      if (cat === '1') return '4rabet';
      if (cat === '2') return 'Crorebet';
      return cat;
    });
    console.log(`[buildWhereConditions] Mapped advertiser values:`, mappedCategories);
    const placeholders = mappedCategories.map((_, i) => `$${paramIndex + i}`).join(', ');
    conditions.push(`ue.advertiser IN (${placeholders})`);
    values.push(...mappedCategories);
    paramIndex += mappedCategories.length;
  } else {
    console.log(`[buildWhereConditions] No advertiser filter applied`);
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
    console.log(`[${requestId}] ====== EXPORT REQUEST DETAILS ======`);
    console.log(`[${requestId}] Event types:`, params.eventTypes);
    console.log(`[${requestId}] Without events:`, params.withoutEvents);
    console.log(`[${requestId}] Categories (advertiser):`, params.categories);
    console.log(`[${requestId}] Date range:`, params.startDate, 'to', params.endDate);
    console.log(`[${requestId}] Deposit range:`, params.minDeposit, 'to', params.maxDeposit);

    // Step 1: Find matching user IDs based on criteria (20% progress)
    let userQuery = `
      SELECT DISTINCT ue.external_user_id
      FROM public.user_events ue
      WHERE ue.external_user_id IS NOT NULL
    `;

    const whereData = buildWhereConditions(params);
    console.log(`[${requestId}] WHERE conditions:`, whereData.conditions);
    console.log(`[${requestId}] WHERE values:`, whereData.values);
    console.log(`[${requestId}] WHERE values count:`, whereData.values.length);
    
    if (whereData.conditions.length > 0) {
      userQuery += ` AND ${whereData.conditions.join(' AND ')}`;
    }
    
    console.log(`[${requestId}] User query (first 500 chars):`, userQuery.substring(0, 500));

    // Handle "without events" condition with funnel logic (reg->ftd->dep)
    if (params.withoutEvents && params.withoutEvents.length > 0) {
      // Check if any withoutEvents overlap with eventTypes - if so, filter them out
      const eventTypesSet = new Set(params.eventTypes || []);
      const filteredWithoutEvents = params.withoutEvents.filter(event => !eventTypesSet.has(event));
      
      if (filteredWithoutEvents.length === 0) {
        console.log(`[${requestId}] WARNING: All withoutEvents overlap with eventTypes, ignoring withoutEvents filter`);
        // Don't apply withoutEvents logic if all excluded events are also in eventTypes
      } else if (filteredWithoutEvents.length < params.withoutEvents.length) {
        console.log(`[${requestId}] INFO: Filtered out ${params.withoutEvents.length - filteredWithoutEvents.length} withoutEvents that overlap with eventTypes`);
        console.log(`[${requestId}] Original withoutEvents:`, params.withoutEvents);
        console.log(`[${requestId}] Filtered withoutEvents:`, filteredWithoutEvents);
        // Use filtered list
        params.withoutEvents = filteredWithoutEvents;
      }
      
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
        // Map old values to new values for backward compatibility
        const mappedCategories = params.categories.map(cat => {
          if (cat === '1') return '4rabet';
          if (cat === '2') return 'Crorebet';
          return cat;
        });
        const placeholders = mappedCategories.map((_, i) => `$${periodIndex + i}`).join(', ');
        periodConditions.push(`ue.advertiser IN (${placeholders})`);
        periodValues.push(...mappedCategories);
        periodIndex += mappedCategories.length;
      }
      
      // Only apply withoutEvents logic if we have events to exclude
      if (params.withoutEvents.length > 0) {
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
    
    // Declare userIds outside try block so it's accessible after
    let userIds = [];
    
    // Use a client with increased timeout settings
    const client = await pool.connect();
    try {
      // Set timeout for this specific connection
      // Note: query_timeout is not a valid PostgreSQL parameter, only statement_timeout is supported
      await client.query('SET statement_timeout = 600000'); // 10 minutes
      await client.query('SET idle_in_transaction_session_timeout = 600000'); // 10 minutes
      
      console.log(`[${requestId}] Timeout settings applied: 10 minutes (600 seconds)`);
      
      // Execute query with timeout wrapper
      const userQueryPromise = client.query(userQuery, whereData.values);
      const userQueryTimeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`User query timeout after 600 seconds`)), 600000);
      });
      
      const userResult = await Promise.race([userQueryPromise, userQueryTimeoutPromise]);
      const queryTime = Date.now() - queryStartTime;
      console.log(`[${requestId}] User query executed in ${queryTime}ms`);
      console.log(`[${requestId}] User query returned ${userResult.rows.length} rows`);
      
      userIds = userResult.rows.map(row => row.external_user_id);
      console.log(`[${requestId}] Extracted ${userIds.length} unique user IDs`);
      console.log(`[${requestId}] Sample user IDs:`, userIds.slice(0, 5));
    } finally {
      // Release the client back to the pool
      client.release();
    }

    if (userIds.length === 0) {
      console.log(`[${requestId}] ERROR: No users found matching criteria`);
      console.log(`[${requestId}] Query was:`, userQuery);
      console.log(`[${requestId}] Query values were:`, whereData.values);
      res.write(JSON.stringify({ progress: 0, error: 'No users found matching the criteria. Try adjusting filters (dates, event types, advertiser).' }) + '\n');
      return res.end();
    }

    console.log(`[${requestId}] Found ${userIds.length} users, starting batch processing...`);
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
    
    console.log(`[${requestId}] Checking if columns exist...`);
    
    // Add query timeout wrapper
    const columnsQueryPromise = pool.query(checkColumnsQuery);
    const columnsQueryTimeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Columns check timeout after 30 seconds`)), 30000);
    });
    
    const columnsResult = await Promise.race([columnsQueryPromise, columnsQueryTimeoutPromise]);
    const existingColumns = columnsResult.rows.map(row => row.column_name);
    const hasUserAgent = existingColumns.includes('user_agent');
    const hasIpAddress = existingColumns.includes('ip_address');
    
    console.log(`[${requestId}] Columns check: hasUserAgent=${hasUserAgent}, hasIpAddress=${hasIpAddress}`);
    console.log(`[${requestId}] Existing columns:`, existingColumns);
    
    if (!hasUserAgent || !hasIpAddress) {
      console.error(`[${requestId}] ERROR: Columns missing! hasUserAgent=${hasUserAgent}, hasIpAddress=${hasIpAddress}`);
      res.write(JSON.stringify({ progress: 0, error: `Колонки не найдены: user_agent=${hasUserAgent}, ip_address=${hasIpAddress}` }) + '\n');
      return res.end();
    }
    
    // Process in batches to avoid PostgreSQL parameter limit (max ~65535 params)
    // Use batches of 5000 users at a time
    const BATCH_SIZE = 5000;
    const allRows = [];
    const totalBatches = Math.ceil(userIds.length / BATCH_SIZE);
    
    console.log(`[${requestId}] Processing ${userIds.length} users in ${totalBatches} batches of ${BATCH_SIZE}`);
    
    if (hasUserAgent && hasIpAddress) {
      console.log(`[${requestId}] Both columns exist, starting batch processing...`);
      // Process users in batches
      for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
        const batch = userIds.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        console.log(`[${requestId}] Processing batch ${batchNum}/${totalBatches} (${batch.length} users)`);
        
        try {
          const placeholders = batch.map((_, idx) => `$${idx + 1}`).join(', ');
          console.log(`[${requestId}] Batch ${batchNum}: Created ${batch.length} placeholders`);
          
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
          
          console.log(`[${requestId}] Batch ${batchNum}: Executing query with ${batch.length} parameters`);
          console.log(`[${requestId}] Batch ${batchNum}: Sample user IDs:`, batch.slice(0, 3));
          
          const batchQueryStartTime = Date.now();
          
          // Add query timeout wrapper
          const queryPromise = pool.query(batchQuery, batch);
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`Query timeout after 600 seconds`)), 600000);
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
          console.error(`[${requestId}] Error in batch ${batchNum}:`, batchError);
          console.error(`[${requestId}] Error stack:`, batchError.stack);
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
      console.log(`[${requestId}] Columns missing: hasUserAgent=${hasUserAgent}, hasIpAddress=${hasIpAddress}`);
      // If columns don't exist, return empty result
      var exportResult = { rows: [] };
    }

    console.log(`[${requestId}] Preparing CSV export with ${exportResult.rows.length} rows`);
    
    if (exportResult.rows.length === 0) {
      console.error(`[${requestId}] ERROR: No rows to export!`);
      res.write(JSON.stringify({ progress: 0, error: 'No data found matching the criteria. No user_agent/ip_address pairs found for selected users.' }) + '\n');
      return res.end();
    }
    
    res.write(JSON.stringify({ progress: 80, message: `Получено ${exportResult.rows.length} записей. Генерация CSV...` }) + '\n');

    // Generate CSV (100% progress)
    // Only export UA+IP pairs
    const columns = ['user_agent', 'ip_address'];
    
    console.log(`[${requestId}] Generating CSV with ${exportResult.rows.length} rows, columns:`, columns);
    console.log(`[${requestId}] Sample row:`, exportResult.rows[0]);
    
    const csvData = stringify(exportResult.rows, {
      header: true,
      columns: columns
    });

    console.log(`[${requestId}] CSV generated, length: ${csvData.length} characters`);
    console.log(`[${requestId}] CSV preview (first 200 chars):`, csvData.substring(0, 200));

    res.write(JSON.stringify({ progress: 100, message: 'CSV файл успешно сгенерирован!' }) + '\n');

    // Send CSV data
    console.log(`[${requestId}] Sending CSV data to client...`);
    res.write(csvData);
    res.end();
    console.log(`[${requestId}] CSV export completed successfully`);
    
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

// Preload event types on server startup (async, non-blocking)
async function preloadEventTypes() {
  console.log('[Startup] Preloading event types...');
  try {
    // Use a simple query with timeout
    const queryPromise = pool.query(`
      SELECT DISTINCT event_type
      FROM public.user_events
      WHERE event_type IS NOT NULL
        AND event_type != ''
      ORDER BY event_type
      LIMIT 50
    `);
    
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Preload timeout')), 30000);
    });
    
    const result = await Promise.race([queryPromise, timeoutPromise]);
    
    eventTypesCache = result.rows.map(row => ({
      event_type: row.event_type,
      count: 0
    }));
    eventTypesCacheTime = Date.now();
    
    console.log(`[Startup] ✅ Preloaded ${eventTypesCache.length} event types`);
  } catch (error) {
    console.error('[Startup] ⚠️ Failed to preload event types:', error.message);
    console.error('[Startup] Event types will be loaded on first request');
    // Set a default list if query fails
    eventTypesCache = [
      { event_type: 'deposit', count: 0 },
      { event_type: 'ftd', count: 0 },
      { event_type: 'regfinished', count: 0 }
    ];
    eventTypesCacheTime = Date.now();
  }
}

// Get available event types
app.get('/api/event-types', async (req, res) => {
  const requestId = Date.now();
  console.log(`[${requestId}] GET /api/event-types`);
  
  // ALWAYS return cache if available (even if stale) - this prevents timeouts
  if (eventTypesCache && eventTypesCache.length > 0) {
    console.log(`[${requestId}] ✅ Returning cached event types (${eventTypesCache.length} types)`);
    return res.json(eventTypesCache);
  }
  
  // If no cache, return default list immediately (don't wait for DB query)
  console.log(`[${requestId}] ⚠️ No cache, returning default event types`);
  const defaultTypes = [
    { event_type: 'deposit', count: 0 },
    { event_type: 'ftd', count: 0 },
    { event_type: 'regfinished', count: 0 },
    { event_type: 'registration', count: 0 },
    { event_type: 'login', count: 0 }
  ];
  
  // Try to refresh cache in background (non-blocking)
  setTimeout(async () => {
    try {
      const queryPromise = pool.query(`
        SELECT DISTINCT event_type
        FROM public.user_events
        WHERE event_type IS NOT NULL
          AND event_type != ''
        ORDER BY event_type
        LIMIT 50
      `);
      
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Query timeout')), 10000);
      });
      
      const result = await Promise.race([queryPromise, timeoutPromise]);
      
      eventTypesCache = result.rows.map(row => ({
        event_type: row.event_type,
        count: 0
      }));
      eventTypesCacheTime = Date.now();
      
      console.log(`[${requestId}] ✅ Background refresh: loaded ${eventTypesCache.length} event types`);
    } catch (error) {
      console.error(`[${requestId}] ⚠️ Background refresh failed:`, error.message);
    }
  }, 0);
  
  return res.json(defaultTypes);
});

// Cache for categories (refresh every 5 minutes)
let categoriesCache = null;
let categoriesCacheTime = 0;
const CATEGORIES_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Get available categories (advertisers)
app.get('/api/categories', async (req, res) => {
  const requestId = Date.now();
  console.log(`[${requestId}] GET /api/categories`);
  
  // Check cache first
  if (categoriesCache && (Date.now() - categoriesCacheTime) < CATEGORIES_CACHE_TTL) {
    console.log(`[${requestId}] Returning cached categories (${categoriesCache.length} categories)`);
    return res.json(categoriesCache);
  }
  
  // Set timeout for this request (30 seconds)
  const timeoutId = setTimeout(() => {
    if (!res.headersSent) {
      console.error(`[${requestId}] Categories request timeout`);
      res.status(504).json({ error: 'Request timeout' });
    }
  }, 30000);
  
  try {
    // Simplified query - just get distinct advertisers without COUNT (much faster)
    const queryPromise = pool.query(`
      SELECT DISTINCT advertiser
      FROM public.user_events
      WHERE advertiser IS NOT NULL
        AND advertiser != ''
      ORDER BY advertiser
      LIMIT 50
    `);
    
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Query timeout after 10 seconds')), 10000);
    });
    
    const result = await Promise.race([queryPromise, timeoutPromise]);
    clearTimeout(timeoutId);
    
    // Format result with count=0
    const formattedResult = result.rows.map(row => ({
      advertiser: row.advertiser,
      count: 0
    }));
    
    // Update cache
    categoriesCache = formattedResult;
    categoriesCacheTime = Date.now();
    
    console.log(`[${requestId}] Categories query completed, returning ${formattedResult.length} categories`);
    res.json(formattedResult);
  } catch (error) {
    clearTimeout(timeoutId);
    console.error(`[${requestId}] Error fetching categories:`, error);
    
    // If cache exists, return cached data even if query failed
    if (categoriesCache) {
      console.log(`[${requestId}] Query failed, returning stale cache`);
      return res.json(categoriesCache);
    }
    
    res.status(500).json({ error: error.message });
  }
});

// Health check - must work even if DB is down (for Railway health checks)
app.get('/api/health', async (req, res) => {
  res.status(200).json({ 
    status: 'ok',
    version: APP_VERSION,
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Version endpoint
app.get('/api/version', (req, res) => {
  res.json({ 
    version: APP_VERSION,
    name: packageJson.name,
    timestamp: new Date().toISOString()
  });
});

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Test database connection on startup (non-blocking, don't fail if DB is down)
setTimeout(() => {
  pool.query('SELECT NOW()', (err, res) => {
    if (err) {
      console.error('⚠️  Database connection check failed:', err.message);
      console.error('   Server will continue running, but DB queries may fail');
    } else {
      console.log('✅ Database connection successful');
      console.log('   Server time:', res.rows[0].now);
      
      // Check ALL columns in user_events table
      pool.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'user_events'
        ORDER BY ordinal_position
      `, (err, res) => {
        if (err) {
          console.error('⚠️  Failed to check columns:', err.message);
        } else {
          const columns = res.rows.map(row => row.column_name);
          console.log(`📊 All columns in user_events (${columns.length} total):`);
          res.rows.forEach(row => {
            console.log(`   - ${row.column_name} (${row.data_type}, nullable: ${row.is_nullable})`);
          });
          
          // Check specifically for user_agent and ip_address
          if (columns.includes('user_agent') && columns.includes('ip_address')) {
            console.log('✅ Required columns (user_agent, ip_address) are present');
          } else {
            console.log('⚠️  WARNING: Missing columns!');
            console.log('   user_agent:', columns.includes('user_agent') ? '✅' : '❌');
            console.log('   ip_address:', columns.includes('ip_address') ? '❌' : '❌');
          }
        }
      });
    }
  });
}, 1000); // Check DB after 1 second (non-blocking)

// Error handler for uncaught errors
process.on('uncaughtException', (error) => {
  console.error('❌ [FATAL] Uncaught Exception:', error);
  // Don't exit - keep server running
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ [FATAL] Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit - keep server running
});

// Start server with error handling
try {
  app.listen(PORT, () => {
    console.log('\n' + '='.repeat(60));
    console.log(`🚀 UA-IP-parcer Server`);
    console.log(`📦 Version: ${APP_VERSION}`);
    console.log(`🌐 Port: ${PORT}`);
    console.log(`🔗 URL: http://localhost:${PORT}`);
    console.log(`📅 Started: ${new Date().toISOString()}`);
    console.log('='.repeat(60) + '\n');
    
    // Start preloading event types after server starts
    setTimeout(() => {
      preloadEventTypes().catch(err => {
        console.error('[Startup] Preload error:', err);
        // Set default cache if preload fails
        if (!eventTypesCache) {
          eventTypesCache = [
            { event_type: 'deposit', count: 0 },
            { event_type: 'ftd', count: 0 },
            { event_type: 'regfinished', count: 0 },
            { event_type: 'registration', count: 0 },
            { event_type: 'login', count: 0 }
          ];
          eventTypesCacheTime = Date.now();
          console.log('[Startup] ✅ Using default event types cache');
        }
      });
    }, 2000); // Wait 2 seconds after server start
  });
} catch (error) {
  console.error('❌ [FATAL] Failed to start server:', error);
  process.exit(1);
}

