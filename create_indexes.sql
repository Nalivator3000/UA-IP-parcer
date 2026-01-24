-- Создание индексов для оптимизации запросов типов событий
-- Выполните эти запросы в PostgreSQL для ускорения работы

-- Индекс для event_type (для запроса типов событий)
CREATE INDEX IF NOT EXISTS idx_user_events_event_type 
ON public.user_events(event_type) 
WHERE event_type IS NOT NULL AND event_type != '';

-- Индекс для advertiser (для запроса категорий)
CREATE INDEX IF NOT EXISTS idx_user_events_advertiser 
ON public.user_events(advertiser) 
WHERE advertiser IS NOT NULL AND advertiser != '';

-- Индекс для external_user_id (для основного запроса экспорта)
CREATE INDEX IF NOT EXISTS idx_user_events_external_user_id 
ON public.user_events(external_user_id) 
WHERE external_user_id IS NOT NULL;

-- Композитный индекс для user_agent и ip_address (для запроса пар UA+IP)
CREATE INDEX IF NOT EXISTS idx_user_events_ua_ip 
ON public.user_events(user_agent, ip_address) 
WHERE user_agent IS NOT NULL 
  AND user_agent != '' 
  AND ip_address IS NOT NULL 
  AND ip_address != '';

-- Индекс для event_date (для фильтрации по датам)
CREATE INDEX IF NOT EXISTS idx_user_events_event_date 
ON public.user_events(event_date);

-- Композитный индекс для основных фильтров
CREATE INDEX IF NOT EXISTS idx_user_events_main_filters 
ON public.user_events(event_date, event_type, external_user_id, advertiser);

-- Проверка индексов
SELECT 
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'user_events'
  AND schemaname = 'public'
ORDER BY indexname;

