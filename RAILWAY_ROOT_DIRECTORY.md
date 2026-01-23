# Настройка Root Directory в Railway

## Проблема

Проект находится в подпапке `csv_export_app`, а не в корне репозитория. Railway по умолчанию ищет проект в корне.

## Решение: Указать Root Directory

### Вариант 1: Через Railway Dashboard (Рекомендуется)

1. Откройте [Railway Dashboard](https://railway.app/dashboard)
2. Выберите ваш проект
3. Перейдите в **Settings** → **Service**
4. Найдите раздел **"Root Directory"** или **"Working Directory"**
5. Укажите: `csv_export_app`
6. Сохраните изменения
7. Railway автоматически перезапустит деплой

### Вариант 2: Через Railway CLI

```bash
# Установите Railway CLI
npm install -g @railway/cli

# Войдите в Railway
railway login

# Перейдите в корень репозитория
cd /path/to/UA-IP-parcer

# Подключите проект
railway link

# Установите Root Directory
railway variables set RAILWAY_ROOT_DIR=csv_export_app

# Или через команду
railway service update --root-dir csv_export_app
```

### Вариант 3: Создать railway.json в корне репозитория

Если Root Directory не работает, можно создать `railway.json` в корне репозитория:

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "cd csv_export_app && npm start",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

## Проверка

После настройки Root Directory:

1. Railway будет искать `package.json` в папке `csv_export_app`
2. Команда `npm install` будет выполняться в `csv_export_app`
3. Команда `npm start` будет выполняться в `csv_export_app`

## Альтернативное решение: Переместить проект в корень

Если ничего не помогает, можно переместить файлы проекта в корень репозитория:

```bash
# В корне репозитория
mv csv_export_app/* .
mv csv_export_app/.* . 2>/dev/null || true
rmdir csv_export_app
```

Но это потребует обновления всех путей в коде.

