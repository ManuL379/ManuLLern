# Формат пакета уроков ManuLLern v1

JSON-файл:

```json
{
  "formatVersion": 1,
  "packageId": "manullern.lessons.011-020",
  "packageVersion": "1.0.0",
  "title": "Уроки 11–20",
  "course": "Deutsch 5000",
  "lessons": [ ... ]
}
```

Урок содержит:
- `id`
- `title`
- `anki: [start, end]`
- `words`
- `micro`
- `text`
- `questions`
- `dialogue`
- `phrases`

Импорт происходит локально через Настройки → «Импортировать пакет уроков».

Новые уроки после №500 используют тот же формат. Ядро приложения менять не обязательно.
