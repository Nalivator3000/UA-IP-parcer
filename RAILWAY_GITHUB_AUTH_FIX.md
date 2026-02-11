# Исправление авторизации Railway в GitHub

## Проблема

Railway не запрашивает авторизацию на GitHub при попытке подключить репозиторий. Это означает, что Railway потерял доступ или токен истек.

## Решение 1: Отозвать и заново авторизовать Railway

### Шаг 1: Отозвать текущую авторизацию

1. **Откройте GitHub:**
   - https://github.com/settings/applications

2. **Перейдите в "Authorized OAuth Apps":**
   - Или напрямую: https://github.com/settings/applications

3. **Найдите "Railway":**
   - Если есть - нажмите на него
   - Нажмите **"Revoke"** (Отозвать)
   - Подтвердите отзыв

### Шаг 2: Заново авторизовать Railway

1. **Откройте Railway Dashboard:**
   - https://railway.app/dashboard

2. **Создайте новый проект:**
   - Нажмите **"New Project"**
   - Выберите **"Deploy from GitHub repo"**

3. **Railway должен запросить авторизацию:**
   - Появится окно авторизации GitHub
   - Нажмите **"Authorize Railway"**
   - Разрешите доступ к репозиториям

4. **Выберите репозиторий:**
   - `Nalivator3000/UA-IP-parcer`

## Решение 2: Проверить настройки GitHub App

### Если используется GitHub App (не OAuth)

1. **GitHub** → **Settings** → **Applications** → **Installed GitHub Apps**
2. Найдите **"Railway"**
3. Проверьте:
   - Доступ к репозиторию `UA-IP-parcer`
   - Права доступа (Repository permissions)
   - Статус установки

4. Если нужно - **Uninstall** и установите заново

## Решение 3: Использовать Personal Access Token

Если OAuth не работает, можно использовать токен напрямую:

### Шаг 1: Создайте Personal Access Token

1. **GitHub** → **Settings** → **Developer settings** → **Personal access tokens** → **Tokens (classic)**
2. Нажмите **"Generate new token"** → **"Generate new token (classic)"**
3. Настройки:
   - **Note:** `Railway Deploy Token`
   - **Expiration:** `No expiration` (или выберите срок)
   - **Scopes:** отметьте `repo` (полный доступ к репозиториям)
4. Нажмите **"Generate token"**
5. **Скопируйте токен** (показывается только один раз!)

### Шаг 2: Использовать токен в Railway (если поддерживается)

Railway обычно использует OAuth, но можно попробовать:

1. **Railway Dashboard** → проект → **Settings** → **Variables**
2. Добавьте переменную (если Railway поддерживает):
   - `GITHUB_TOKEN` = ваш токен

**Примечание:** Railway обычно не поддерживает прямую установку токена, использует только OAuth.

## Решение 4: Проверить настройки репозитория

### Убедитесь, что репозиторий доступен:

1. **Откройте:** https://github.com/Nalivator3000/UA-IP-parcer
2. **Проверьте:**
   - Репозиторий не приватный (или Railway имеет доступ)
   - Репозиторий существует и доступен
   - Ветка `main` существует

### Если репозиторий приватный:

1. **GitHub** → репозиторий → **Settings** → **Collaborators & teams**
2. Убедитесь, что Railway имеет доступ (если используется GitHub App)

## Решение 5: Переустановить Railway GitHub App

1. **GitHub** → **Settings** → **Applications** → **Installed GitHub Apps**
2. Найдите **"Railway"**
3. Нажмите **"Configure"**
4. Проверьте доступ к репозиторию `UA-IP-parcer`
5. Если нужно - **Uninstall** и установите заново через Railway

## Решение 6: Использовать Railway CLI

Если веб-интерфейс не работает, используйте CLI:

```bash
# Установите Railway CLI
npm install -g @railway/cli

# Войдите в Railway
railway login

# Создайте новый проект
railway init

# Подключите репозиторий
railway link

# Или создайте проект напрямую из GitHub
railway init --template github
```

## Проверка после исправления

1. **Попробуйте подключить репозиторий:**
   - Railway Dashboard → New Project → Deploy from GitHub repo
   - Должно появиться окно авторизации GitHub

2. **Проверьте авторизацию:**
   - GitHub → Settings → Applications → Authorized OAuth Apps
   - Должен появиться "Railway" после авторизации

3. **Проверьте доступ:**
   - Railway должен видеть репозиторий `Nalivator3000/UA-IP-parcer`
   - Ошибка "GitHub Repo not found" должна исчезнуть

## Если ничего не помогает

1. **Создайте новый аккаунт Railway** (если возможно)
2. **Или используйте другой сервис деплоя** (Vercel, Render, Fly.io)
3. **Или деплойте вручную** через Railway CLI или Docker

## Текущий статус

- ✅ Репозиторий существует: `Nalivator3000/UA-IP-parcer`
- ✅ Последний коммит отправлен успешно
- ❌ Railway не может подключиться к репозиторию
- ❌ Railway не запрашивает авторизацию GitHub

**Следующий шаг:** Отозвать и заново авторизовать Railway в GitHub.

