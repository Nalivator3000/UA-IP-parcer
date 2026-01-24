# Проверка автодеплоя Railway

## ⚠️ ВАЖНО: Репозиторий UA-IP-parcer

Репозиторий `UA-IP-parcer` должен быть настроен в Railway следующим образом:

### 1. Проверка подключения репозитория

1. Откройте [Railway Dashboard](https://railway.app/dashboard)
2. Выберите проект для `UA-IP-parcer`
3. Перейдите в **Settings** → **Service** → **Source**
4. Убедитесь, что:
   - **Repository:** `Nalivator3000/UA-IP-parcer`
   - **Branch:** `main`
   - **Auto Deploy:** ✅ Включен

### 2. Проверка Root Directory

**ВАЖНО:** Если проект находится в корне репозитория `UA-IP-parcer`, то Root Directory НЕ нужен (оставьте пустым).

Если проект в подпапке, укажите Root Directory:
1. **Settings** → **Service**
2. Найдите **"Root Directory"**
3. Если проект в корне - оставьте пустым
4. Если проект в подпапке - укажите путь (например, `csv_export_app`)

### 3. Проверка переменных окружения

В **Settings** → **Variables** должны быть:
- `DATABASE_URL` - строка подключения к PostgreSQL
- `PORT` - Railway установит автоматически
- `NODE_ENV` - `production` (опционально)

### 4. Проверка последнего деплоя

1. Перейдите в **Deployments**
2. Проверьте последний деплой
3. Если деплой не запустился автоматически после push:
   - Проверьте логи деплоя на наличие ошибок
   - Убедитесь, что webhook от GitHub работает
   - Попробуйте сделать ручной **Redeploy**

### 5. Ручной запуск деплоя (для проверки)

Если автодеплой не работает:
1. В Railway Dashboard → **Deployments**
2. Нажмите **"Deploy"** или **"Redeploy"**
3. Это проверит, работает ли деплой вообще

### 6. Проверка webhook на GitHub

1. Откройте репозиторий `UA-IP-parcer` на GitHub
2. Перейдите в **Settings** → **Webhooks**
3. Должен быть webhook от Railway
4. Проверьте последние доставки (Recent Deliveries)
5. Если webhook не работает - переподключите репозиторий в Railway

### 7. Проверка структуры репозитория

Убедитесь, что в корне репозитория `UA-IP-parcer` есть:
- `package.json`
- `server.js`
- `public/index.html`
- `railway.json`

Если файлы в подпапке `csv_export_app`, то в Railway нужно указать Root Directory: `csv_export_app`


