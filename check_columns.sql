-- Проверка всех колонок в таблице user_events
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default,
    character_maximum_length
FROM information_schema.columns 
WHERE table_schema = 'public' 
  AND table_name = 'user_events'
ORDER BY ordinal_position;

