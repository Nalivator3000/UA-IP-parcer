# Создание индексов для оптимизации запросов

## Проблема

Запросы к `/api/event-types` зависают из-за отсутствия индексов на большой таблице `user_events`.

## Решение

Выполните SQL скрипт `create_indexes.sql` в вашей базе данных PostgreSQL.

### Вариант 1: Через psql

```bash
psql "postgresql://postgres:SriKJuzBhROvpXTloDLNQieJgAedbaAq@yamabiko.proxy.rlwy.net:47136/railway" -f create_indexes.sql
```

### Вариант 2: Через Python скрипт

```bash
cd csv_export_app
python create_indexes.py
```

**ВНИМАНИЕ:** Создание индексов на большой таблице может занять несколько минут!

### Вариант 3: Через Superset SQL Lab

1. Откройте Superset → SQL Lab
2. Скопируйте содержимое `create_indexes.sql`
3. Выполните запросы по одному

## Что делают индексы

1. `idx_user_events_event_type` - ускоряет запрос типов событий
2. `idx_user_events_advertiser` - ускоряет запрос категорий
3. `idx_user_events_external_user_id` - ускоряет поиск пользователей
4. `idx_user_events_ua_ip` - ускоряет запрос пар UA+IP
5. `idx_user_events_event_date` - ускоряет фильтрацию по датам

## После создания индексов

1. Перезапустите приложение (если нужно)
2. Проверьте работу `/api/event-types` - должно работать быстро
3. Проверьте интерфейс - события должны загружаться без таймаутов

## Временное решение (уже реализовано)

В коде уже добавлено:
- ✅ Кэширование результатов на 5 минут
- ✅ Оптимизированные запросы с LIMIT
- ✅ Fallback на кэш при ошибках

Но для полного решения нужно создать индексы в БД!

