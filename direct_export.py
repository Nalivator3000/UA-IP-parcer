#!/usr/bin/env python3
"""
Прямой экспорт уникальных UA/IP пар из БД
Фильтры: FTD, Крора (advertiser=2), период 2026-01-09 до 2026-02-09
"""
import os
import csv
import psycopg2
from psycopg2.extras import RealDictCursor

# Строка подключения к БД
DATABASE_URL = os.environ.get(
    'DATABASE_URL',
    'postgresql://postgres:SriKJuzBhROvpXTloDLNQieJgAedbaAq@yamabiko.proxy.rlwy.net:47136/railway'
)

# Параметры запроса
START_DATE = '2026-01-09'
END_DATE = '2026-02-09'
EVENT_TYPE = 'ftd'
ADVERTISER = '2'  # Крора

OUTPUT_FILE = '/Users/aleksandrkovmir/Downloads/direct_db_export_ftd_crore.csv'

def export_ua_ip_pairs():
    """Экспорт уникальных UA/IP пар напрямую из БД"""
    
    print(f"Подключение к БД...")
    conn = psycopg2.connect(DATABASE_URL, sslmode='require')
    
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # SQL запрос для получения уникальных UA/IP пар
            query = """
            SELECT DISTINCT
                ue.user_agent,
                ue.ip_address
            FROM public.user_events ue
            WHERE ue.external_user_id IS NOT NULL
              AND ue.event_date >= %s::date
              AND ue.event_date < (%s::date + INTERVAL '1 day')
              AND ue.event_type = %s
              AND ue.advertiser = %s
              AND ue.user_agent IS NOT NULL
              AND ue.user_agent != ''
              AND ue.ip_address IS NOT NULL
              AND ue.ip_address != ''
            ORDER BY ue.user_agent, ue.ip_address
            """
            
            print(f"Выполнение запроса...")
            print(f"  Период: {START_DATE} до {END_DATE}")
            print(f"  Тип события: {EVENT_TYPE}")
            print(f"  Advertiser: {ADVERTISER} (Крора)")
            
            cur.execute(query, (START_DATE, END_DATE, EVENT_TYPE, ADVERTISER))
            
            rows = cur.fetchall()
            print(f"Найдено уникальных пар: {len(rows):,}")
            
            # Сохранение в CSV
            print(f"Сохранение в {OUTPUT_FILE}...")
            with open(OUTPUT_FILE, 'w', encoding='utf-8', newline='') as f:
                writer = csv.writer(f)
                writer.writerow(['user_agent', 'ip_address'])
                
                for row in rows:
                    writer.writerow([row['user_agent'], row['ip_address']])
            
            print(f"Готово! Экспортировано {len(rows):,} уникальных пар")
            print(f"Файл сохранен: {OUTPUT_FILE}")
            
            # Дополнительная статистика
            stats_query = """
            SELECT 
                COUNT(*) as total_events,
                COUNT(DISTINCT external_user_id) as unique_users,
                COUNT(DISTINCT user_agent || '|' || ip_address) as unique_pairs
            FROM public.user_events ue
            WHERE ue.external_user_id IS NOT NULL
              AND ue.event_date >= %s::date
              AND ue.event_date < (%s::date + INTERVAL '1 day')
              AND ue.event_type = %s
              AND ue.advertiser = %s
              AND ue.user_agent IS NOT NULL
              AND ue.user_agent != ''
              AND ue.ip_address IS NOT NULL
              AND ue.ip_address != ''
            """
            
            cur.execute(stats_query, (START_DATE, END_DATE, EVENT_TYPE, ADVERTISER))
            stats = cur.fetchone()
            
            print(f"\nСтатистика:")
            print(f"  Всего событий: {stats['total_events']:,}")
            print(f"  Уникальных пользователей: {stats['unique_users']:,}")
            print(f"  Уникальных UA/IP пар: {stats['unique_pairs']:,}")
            
    finally:
        conn.close()
        print("\nСоединение с БД закрыто")

if __name__ == '__main__':
    export_ua_ip_pairs()

