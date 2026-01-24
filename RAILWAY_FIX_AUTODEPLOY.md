# Инструкция по настройке автодеплоя Railway

## ⚠️ Проблема: Автодеплой не работает

### Шаг 1: Проверка подключения репозитория

1. Откройте [Railway Dashboard](https://railway.app/dashboard)
2. Найдите проект для `UA-IP-parcer`
3. Перейдите в **Settings** → **Service** → **Source**
4. Убедитесь, что:
   - **Repository:** `Nalivator3000/UA-IP-parcer` ✅
   - **Branch:** `main` ✅
   - Если репозиторий не подключен → нажмите **"Connect Repo"**

### Шаг 2: Включение автодеплоя

1. В **Settings** → **Service** → **Deploy**
2. Включите переключатель **"Auto Deploy"** (должен быть активен)
3. Убедитесь, что выбрана ветка **`main`**

### Шаг 3: Проверка Root Directory

**ВАЖНО:** Репозиторий `UA-IP-parcer` содержит проект в корне, поэтому:
- Root Directory должен быть **ПУСТЫМ** (не указывать `csv_export_app`)
- Railway должен видеть `package.json` в корне репозитория

Если Railway не видит проект:
1. Проверьте структуру репозитория на GitHub
2. Убедитесь, что `package.json`, `server.js` находятся в корне `UA-IP-parcer`
3. Если файлы в подпапке - укажите Root Directory в Railway

### Шаг 4: Проверка переменных окружения

В **Settings** → **Variables** должны быть:
- `DATABASE_URL` - строка подключения к PostgreSQL
- `PORT` - Railway установит автоматически (не обязательно указывать)

### Шаг 5: Проверка webhook на GitHub

1. Откройте репозиторий `UA-IP-parcer` на GitHub
2. Перейдите в **Settings** → **Webhooks**
3. Должен быть webhook от Railway
4. Проверьте последние доставки (Recent Deliveries)
5. Если webhook не работает или отсутствует:
   - Переподключите репозиторий в Railway
   - Или создайте webhook вручную

### Шаг 6: Ручной запуск деплоя

Для проверки, что деплой вообще работает:
1. В Railway Dashboard → **Deployments**
2. Нажмите **"Deploy"** или **"Redeploy"**
3. Проверьте логи деплоя на наличие ошибок

### Шаг 7: Проверка последних коммитов

Убедитесь, что последние коммиты запушены:
```bash
cd csv_export_app
git log --oneline -5
git push origin main
```

Последние коммиты должны быть:
- `3bb4be3 Remove categories section and fix event types selection`
- `435b935 Add detailed logging for debugging IP+UA export`

### Шаг 8: Если ничего не помогает

1. Удалите проект в Railway
2. Создайте новый проект → **"New"** → **"GitHub Repo"**
3. Выберите `Nalivator3000/UA-IP-parcer`
4. Настройте переменные окружения
5. Включите Auto Deploy для ветки `main`


