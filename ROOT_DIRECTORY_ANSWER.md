# Ответ: Что указать в Root Directory для UA-IP-parcer

## ✅ Правильный ответ:

**Root Directory: оставьте ПУСТЫМ** (не указывайте ничего)

или

**Root Directory: `.`** (точка)

## Почему?

Все файлы проекта находятся **в корне репозитория**:

```
UA-IP-parcer/          ← корень репозитория
├── server.js          ← главный файл
├── package.json       ← зависимости
├── public/            ← статические файлы
│   └── index.html
├── railway.json       ← конфигурация Railway
└── ...
```

**Нет подпапок** типа `csv_export_app` или других - все в корне!

## Настройка в Railway

1. **Railway Dashboard** → проект "UA-IP-parcer" → **Settings**
2. Найдите секцию **"Source"** → **"Add Root Directory"**
3. **Оставьте поле ПУСТЫМ** или укажите `.` (точка)
4. Сохраните

## Проверка проектов

✅ **superset-railway** и **UA-IP-parcer** - это **разные репозитории**:
- `superset-railway` → репозиторий для Superset
- `UA-IP-parcer` → репозиторий для экспорта UA+IP

✅ **Локально они в разных директориях**:
- `/Users/aleksandrkovmir/superset-railway/`
- `/Users/aleksandrkovmir/UA-IP-parcer/`

✅ **Файлы НЕ перемешиваются** - каждый проект в своем репозитории

## Если Root Directory указан неправильно

Если там указано что-то вроде `csv_export_app` или другая подпапка:

1. **Удалите** это значение (оставьте пустым)
2. Сохраните
3. Railway пересоберет проект из корня репозитория

## После настройки

Railway должен:
- ✅ Найти `package.json` в корне
- ✅ Выполнить `npm install`
- ✅ Запустить `npm start` (который запускает `node server.js`)
- ✅ Найти `public/index.html` для статических файлов

