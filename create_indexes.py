#!/usr/bin/env python3
"""
Создание индексов для оптимизации запросов в таблице user_events
Выполните этот скрипт для ускорения работы приложения
"""
import sys
import io
from sqlalchemy import create_engine, text
import os

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

railway_url = "postgresql://postgres:SriKJuzBhROvpXTloDLNQieJgAedbaAq@yamabiko.proxy.rlwy.net:47136/railway"
pg_uri = os.environ.get("DATABASE_URL", railway_url)
engine = create_engine(pg_uri)

print("=" * 80)
print("СОЗДАНИЕ ИНДЕКСОВ ДЛЯ ОПТИМИЗАЦИИ ЗАПРОСОВ")
print("=" * 80)
print()

indexes = [
    {
        'name': 'idx_user_events_event_type',
        'sql': '''
            CREATE INDEX IF NOT EXISTS idx_user_events_event_type 
            ON public.user_events(event_type) 
            WHERE event_type IS NOT NULL AND event_type != ''
        ''',
        'description': 'Индекс для event_type (для запроса типов событий)'
    },
    {
        'name': 'idx_user_events_advertiser',
        'sql': '''
            CREATE INDEX IF NOT EXISTS idx_user_events_advertiser 
            ON public.user_events(advertiser) 
            WHERE advertiser IS NOT NULL AND advertiser != ''
        ''',
        'description': 'Индекс для advertiser (для запроса категорий)'
    },
    {
        'name': 'idx_user_events_external_user_id',
        'sql': '''
            CREATE INDEX IF NOT EXISTS idx_user_events_external_user_id 
            ON public.user_events(external_user_id) 
            WHERE external_user_id IS NOT NULL
        ''',
        'description': 'Индекс для external_user_id (для основного запроса экспорта)'
    },
    {
        'name': 'idx_user_events_ua_ip',
        'sql': '''
            CREATE INDEX IF NOT EXISTS idx_user_events_ua_ip 
            ON public.user_events(user_agent, ip_address) 
            WHERE user_agent IS NOT NULL 
              AND user_agent != '' 
              AND ip_address IS NOT NULL 
              AND ip_address != ''
        ''',
        'description': 'Композитный индекс для user_agent и ip_address'
    },
    {
        'name': 'idx_user_events_event_date',
        'sql': '''
            CREATE INDEX IF NOT EXISTS idx_user_events_event_date 
            ON public.user_events(event_date)
        ''',
        'description': 'Индекс для event_date (для фильтрации по датам)'
    }
]

with engine.connect() as conn:
    print("Проверка существующих индексов...")
    result = conn.execute(text("""
        SELECT indexname
        FROM pg_indexes
        WHERE tablename = 'user_events'
          AND schemaname = 'public'
    """))
    existing_indexes = {row[0] for row in result}
    print(f"Найдено существующих индексов: {len(existing_indexes)}")
    print()
    
    created = 0
    skipped = 0
    
    for idx in indexes:
        if idx['name'] in existing_indexes:
            print(f"⏭️  {idx['name']} - уже существует, пропускаем")
            skipped += 1
        else:
            try:
                print(f"📊 Создание индекса: {idx['name']}")
                print(f"   {idx['description']}")
                conn.execute(text(idx['sql']))
                conn.commit()
                print(f"   ✅ Индекс создан успешно")
                created += 1
            except Exception as e:
                print(f"   ❌ Ошибка: {e}")
        print()
    
    print("=" * 80)
    print(f"Создано индексов: {created}")
    print(f"Пропущено (уже существуют): {skipped}")
    print()
    
    # Проверка всех индексов
    print("Текущие индексы на таблице user_events:")
    result = conn.execute(text("""
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE tablename = 'user_events'
          AND schemaname = 'public'
        ORDER BY indexname
    """))
    
    for row in result:
        print(f"  - {row[0]}")

print()
print("=" * 80)
print("ГОТОВО!")
print("=" * 80)

