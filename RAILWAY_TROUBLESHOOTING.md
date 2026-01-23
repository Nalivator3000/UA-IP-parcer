# Диагностика автодеплоя Railway

## Быстрая проверка

### 1. Проверка подключения репозитория

1. Откройте [Railway Dashboard](https://railway.app/dashboard)
2. Выберите ваш проект
3. Перейдите в **Settings** → **Service**
4. В разделе **"Source"** должно быть:
   - **Repository:** `Nalivator3000/UA-IP-parcer`
   - **Branch:** `main`
   - **Auto Deploy:** ✅ Включен

### 2. Если репозиторий не подключен:

1. В **Settings** → **Service** → **Source**
2. Нажмите **"Connect Repo"** или **"Change Source"**
3. Выберите репозиторий `Nalivator3000/UA-IP-parcer`
4. Выберите ветку `main`
5. Railway автоматически подключит репозиторий

### 3. Если Auto Deploy выключен:

1. В **Settings** → **Service** → **Deploy**
2. Включите переключатель **"Auto Deploy"**
3. Убедитесь, что выбрана ветка **`main`**

### 4. Проверка GitHub интеграции:

1. Перейдите на [GitHub Settings](https://github.com/settings/applications)
2. Выберите **Authorized OAuth Apps** или **Installed GitHub Apps**
3. Найдите **Railway**
4. Убедитесь, что Railway имеет доступ к репозиторию `UA-IP-parcer`
5. Если нет, переподключите репозиторий в Railway

### 5. Ручной тест деплоя:

1. В Railway Dashboard → **Deployments**
2. Нажмите кнопку **"Deploy"** или **"Redeploy"**
3. Если ручной деплой работает, проблема в автодеплое
4. Если ручной деплой не работает, проблема в конфигурации проекта

### 6. Проверка webhook'ов GitHub:

1. Откройте репозиторий на GitHub: `https://github.com/Nalivator3000/UA-IP-parcer`
2. Перейдите в **Settings** → **Webhooks**
3. Должен быть webhook от Railway (URL вида `https://railway.app/api/webhooks/...`)
4. Проверьте последние доставки (Recent Deliveries)
5. Если webhook не работает, переподключите репозиторий в Railway

### 7. Альтернативное решение - Railway CLI:

Если автодеплой через GitHub не работает, можно использовать Railway CLI:

```bash
# Установите Railway CLI
npm install -g @railway/cli

# Войдите в Railway
railway login

# Перейдите в директорию проекта
cd csv_export_app

# Подключите проект
railway link

# Деплой
railway up
```

## Частые проблемы

### Проблема: Репозиторий не найден
**Решение:** Убедитесь, что репозиторий публичный или Railway имеет к нему доступ

### Проблема: Webhook не доставляется
**Решение:** Переподключите репозиторий в Railway Dashboard

### Проблема: Auto Deploy включен, но не работает
**Решение:** 
1. Выключите и включите Auto Deploy снова
2. Проверьте, что вы пушите в правильную ветку (`main`)
3. Проверьте логи последнего коммита на GitHub

### Проблема: Деплой запускается, но падает
**Решение:** Проверьте логи в Railway Dashboard → Deployments → выберите деплой → View Logs

