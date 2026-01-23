# CSV Export App - Railway Deployment

## Описание

Веб-приложение для экспорта CSV файлов с парами User Agent и IP из базы данных Ubidex.

## Локальный запуск

1. Установите зависимости:
```bash
npm install
```

2. Создайте файл `.env` на основе `.env.example`:
```bash
cp .env.example .env
```

3. Запустите приложение:
```bash
npm start
```

Или для разработки с автоперезагрузкой:
```bash
npm run dev
```

4. Откройте браузер: http://localhost:3000

## Деплой на Railway

### Вариант 1: Через Railway CLI

1. Установите Railway CLI:
```bash
npm install -g @railway/cli
```

2. Войдите в Railway:
```bash
railway login
```

3. Создайте новый проект:
```bash
railway init
```

4. Добавьте переменные окружения:
```bash
railway variables set DATABASE_URL=your_database_url
```

5. Деплой:
```bash
railway up
```

### Вариант 2: Через GitHub

1. Создайте репозиторий на GitHub
2. Загрузите код в репозиторий
3. В Railway Dashboard:
   - Создайте новый проект
   - Подключите GitHub репозиторий
   - Railway автоматически определит Node.js проект
   - Добавьте переменную окружения `DATABASE_URL`
   - Railway автоматически задеплоит приложение

### Вариант 3: Через Railway Dashboard

1. Откройте Railway Dashboard
2. Создайте новый проект
3. Выберите "Deploy from GitHub repo" или "Empty Project"
4. Если Empty Project:
   - Подключите репозиторий или загрузите файлы
   - Railway определит Node.js и установит зависимости
5. Добавьте переменные окружения в Settings → Variables:
   - `DATABASE_URL` - строка подключения к PostgreSQL
   - `PORT` - порт (Railway установит автоматически)
6. Railway автоматически задеплоит приложение

## Структура проекта

```
csv_export_app/
├── server.js          # Express сервер
├── package.json       # Зависимости и скрипты
├── .env.example       # Пример переменных окружения
├── public/            # Статические файлы
│   └── index.html     # Веб-интерфейс
└── README.md          # Документация
```

## API Endpoints

- `GET /` - Главная страница с формой
- `POST /api/export` - Экспорт CSV
- `GET /api/event-types` - Список типов событий
- `GET /api/categories` - Список категорий (advertisers)
- `GET /api/health` - Проверка здоровья приложения

## Примечания

- Приложение ожидает наличие колонок `user_agent` и `ip_address` в таблице `user_events`
- Если колонок нет, они будут отображаться как 'N/A' в CSV
- Для добавления этих колонок выполните SQL:
  ```sql
  ALTER TABLE user_events ADD COLUMN IF NOT EXISTS user_agent TEXT;
  ALTER TABLE user_events ADD COLUMN IF NOT EXISTS ip_address TEXT;
  ```

