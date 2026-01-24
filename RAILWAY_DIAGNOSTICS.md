# Диагностика автодеплоя Railway

## Быстрая проверка

Выполните команды ниже и проверьте результаты:

```bash
# 1. Проверка репозитория
cd csv_export_app
git remote -v
# Должно быть: origin https://github.com/Nalivator3000/UA-IP-parcer.git

# 2. Проверка ветки
git branch
# Должно быть: * main

# 3. Проверка последних коммитов
git log --oneline -5
# Должны быть последние коммиты

# 4. Проверка, что все запушено
git status
# Должно быть: "Your branch is up to date with 'origin/main'"

# 5. Проверка структуры (файлы должны быть в корне)
ls -la
# Должны быть: package.json, server.js, railway.json
```

## Основные причины, почему автодеплой не работает

### 1. Репозиторий не подключен в Railway
**Решение:** Railway Dashboard → Settings → Service → Source → Connect Repo

### 2. Auto Deploy выключен
**Решение:** Railway Dashboard → Settings → Service → Deploy → включить Auto Deploy

### 3. Неправильный Root Directory
**Решение:** Railway Dashboard → Settings → Service → Root Directory → оставить ПУСТЫМ

### 4. Webhook не работает
**Решение:** GitHub → Settings → Webhooks → проверить/переподключить

### 5. Неправильная ветка
**Решение:** Убедиться, что пушите в `main` и Railway следит за `main`

## Проверка через Railway CLI (опционально)

```bash
# Установка Railway CLI
npm install -g @railway/cli

# Вход в Railway
railway login

# Подключение к проекту
cd csv_export_app
railway link

# Проверка статуса
railway status

# Ручной деплой
railway up
```

