# Production Readiness Report — Job Hunter

> Роль: Senior Tech Lead / Architecture Review  
> Дата: 2026-06-29  
> Версия кода: ветка `main`, последний коммит: `618cf30`

---

## Оценка по направлениям

| Направление | Оценка | Статус |
|---|---|---|
| Архитектура и код | 7/10 | 🟡 Хорошо, есть точки роста |
| Безопасность | 3/10 | 🔴 Критично |
| Тестирование | 1/10 | 🔴 Критично |
| Наблюдаемость (observability) | 2/10 | 🔴 Критично |
| База данных и данные | 6/10 | 🟡 Есть риски |
| DevOps / CI/CD | 4/10 | 🔴 Нет автоматизации |
| Документация | 4/10 | 🟡 Базовая |
| **Итог** | **4/10** | 🔴 **Не готово к продакшену** |

---

## ✅ Хорошо — что уже сделано правильно

### Архитектура
- Monorepo на pnpm workspace с чётким разделением backend / frontend
- Сервисная архитектура на бэкенде: каждая область — отдельный сервис (auth, jobs, email, prompt-learning, etc.)
- Express 5 + TypeScript strict mode — ошибки типизации ловятся на этапе сборки
- Prisma ORM с 28 миграциями, нормальная схема с каскадными удалениями и индексами на горячих запросах
- Graceful shutdown: приложение корректно закрывает HTTP-сервер и разрывает Prisma-соединение по SIGINT/SIGTERM
- Docker-based деплой с `docker-compose.aws.yml` для продакшена без БД (под RDS)
- Zod-валидация на всех входных точках API — схемы охватывают auth, jobs, resume, user profile
- Path traversal protection в `/storage` роутере (нормализация + проверка `startsWith`)
- User-scoped access control: пользователь не может получить данные другого пользователя
- Refresh token rotation реализован
- Timing-safe compare при верификации JWT-подписи (`crypto.timingSafeEqual`)
- Health-check endpoint `/health` + Docker healthcheck для postgres/backend/frontend
- Подписка (FREE/PRO) с лимитами на уровне приложения
- Runtime-конфиг фронта через envsubst в nginx (конфиг не вшит в бандл)
- SPA-routing в nginx через `try_files $uri /index.html`

### Качество кода
- TypeScript проверка (`tsc --noEmit`) встроена в build-скрипт фронта
- Разделение схем валидации в отдельный файл `api.schemas.ts`
- Нормализация URL вакансий и дедупликация перед сохранением (`job-deduplication.service.ts`)
- Логика PromptLearning — адаптивное улучшение качества подбора через отклонения пользователя

---

## 🔴 Критично — без этого в продакшен нельзя

### 1. Жёстко прописанный fallback-секрет JWT
**Файл:** `backend/src/services/auth.service.ts`  
Если переменная `AUTH_TOKEN_SECRET` не задана, используется строка `"job-hunter-local-dev-secret"`.  
Любой желающий может подписать произвольный токен и войти под любым пользователем.  
**Риск:** полная компрометация всех аккаунтов.  
**Fix:** при старте проверять наличие переменной и завершать процесс с ошибкой если она не задана.

### 2. CORS открыт для всех по умолчанию
**Файл:** `backend/src/app.ts`  
`cors({ origin: corsOrigin ? [...] : true })` — если `CORS_ORIGIN` не задан, разрешаются запросы с любого домена.  
**Риск:** CSRF-атаки, кража credentials через сторонний сайт.  
**Fix:** сделать `CORS_ORIGIN` обязательным, падать при старте если не задан.

### 3. Нет rate limiting
`express-rate-limit` установлен в зависимостях, но не подключён нигде.  
**Риск:** brute-force на `/auth/login`, `/auth/register`, DoS на дорогих эндпоинтах (запуск анализа вакансий).  
**Fix:** ограничить auth-роуты до 10 req/min per IP, API-роуты до 60 req/min.

### 4. Нет security headers
`helmet` установлен в зависимостях, но не подключён.  
Nginx не отдаёт `X-Frame-Options`, `X-Content-Type-Options`, `Content-Security-Policy`, `Strict-Transport-Security`.  
**Риск:** clickjacking, XSS, MIME-sniffing.  
**Fix:** подключить `helmet()` в `app.ts`, добавить CSP в nginx.

### 5. Миграции запускаются при старте контейнера
**Файл:** `backend/Dockerfile`, строка CMD  
`prisma migrate deploy && pnpm start` — миграция и сервис в одном процессе.  
**Риск:** при горизонтальном масштабировании несколько инстансов запустят миграцию одновременно → race condition / блокировки.  
**Fix:** вынести миграцию в отдельный init-контейнер или pre-deploy job.

### 6. Файловое хранилище — ephemeral
Сгенерированные резюме и PDF лежат в `/app/storage` внутри контейнера (или в volume на той же машине).  
**Риск:** при пересоздании контейнера или переезде на другой сервер все файлы теряются.  
**Fix:** S3-совместимое хранилище (AWS S3, MinIO) с пре-signed URL для доступа.

### 7. Нет структурированного логирования и error tracking
`winston`, `morgan`, `@aws-sdk/client-cloudwatch-logs` установлены, но не используются.  
В продакшене — только `console.log` в stdout.  
**Риск:** невозможно найти причину сбоя, нет алертов при ошибках.  
**Fix:** подключить winston со структурированным JSON-выводом, Sentry для error tracking, CloudWatch / Datadog для агрегации.

### 8. Нет ни одного теста
В проекте нет файлов `*.test.ts` или `*.spec.ts`. Jest и @testing-library установлены, но не используются.  
**Риск:** любой рефакторинг или деплой может сломать бизнес-логику без обнаружения.  
**Fix:** минимум — unit-тесты для auth, job-deduplication, search-preferences, prompt-learning. Integration-тест на ключевые API-эндпоинты.

### 9. Нет CI/CD
Нет ни одного GitHub Actions workflow.  
**Риск:** деплой вручную = человеческие ошибки, нет автоматических проверок перед мержем.  
**Fix:** pipeline: lint → typecheck → tests → build → push image → deploy.

### 10. Секреты хранятся в `.env` без шифрования
LinkedIn-пароль, Gmail refresh token, OpenAI API key — всё лежит в `.env` на сервере.  
**Риск:** при компрометации сервера утекают все ключи.  
**Fix:** AWS Secrets Manager / HashiCorp Vault / Railway Variables с шифрованием at-rest.

---

## 🟡 Неплохо бы иметь — улучшения второго приоритета

### Безопасность
- Заменить PBKDF2 (1000 итераций) на argon2id — зависимость уже установлена
- Валидация MIME-типа при загрузке файлов (сейчас проверяется только имя файла)
- Validate OAuth `state` параметр в `/email/oauth/callback` против CSRF
- Request ID middleware для корреляции логов (один ID на весь цикл запроса)
- Ограничение размера загружаемых файлов (сейчас только 2MB на JSON)
- Шифрование чувствительных полей в БД (email, описания профиля)

### Надёжность
- Healthcheck с глубокой проверкой (доступность DB, внешних API)
- Readiness probe отдельно от liveness probe
- Настройка Prisma connection pool (`connection_limit` в `DATABASE_URL`)
- Резервное копирование БД — автоматически раз в сутки, retention 30 дней
- Distributed scheduler вместо node-cron для горизонтального масштабирования (Bull + Redis)
- Retry logic с exponential backoff для внешних API (OpenAI, Gmail, LinkedIn)

### Код и качество
- API versioning (`/v1/...`) — сейчас при breaking change все клиенты ломаются сразу
- Zod-валидация query-параметров (сейчас `limit` и подобные не валидируются)
- Общие TypeScript-типы между backend и frontend (сейчас дублирование)
- Убрать дублирование Redux + Zustand на фронте (выбрать один state manager)
- OpenAPI/Swagger документация на основе Zod-схем (`zod-to-openapi`)
- Pre-commit hooks: eslint + typecheck (Husky + lint-staged)

### Производительность
- Gzip в nginx (сейчас статика отдаётся без сжатия)
- Content-hashing в именах бандлов для надёжной инвалидации кэша
- CDN для статики фронта (CloudFront, BunnyCDN)
- Pagination на эндпоинтах, возвращающих списки вакансий/документов
- Database query caching для горячих запросов

### Операции
- Автоматический алерт в Telegram/Slack при ошибках 5xx
- Runbook: что делать при падении сервиса
- Deployment checklist в виде GitHub PR template
- Автоматическое создание backup перед каждым деплоем

---

## 🗺️ План доведения до продакшена

### Фаза 1 — Блокеры безопасности (1–2 недели)

```
1. Обязательные ENV-переменные
   - Падение при старте если AUTH_TOKEN_SECRET / CORS_ORIGIN не заданы
   - Перенести все секреты в AWS Secrets Manager / Railway Variables

2. Security middleware
   - app.use(helmet()) с настройками CSP
   - express-rate-limit на /auth/* (10/min) и /jobs/automation/* (5/min)
   - Nginx: добавить security headers, gzip

3. Файловое хранилище
   - Интеграция с AWS S3 / MinIO
   - Пре-signed URL вместо прямой отдачи файлов

4. Логирование и мониторинг
   - Подключить winston → структурированный JSON
   - Sentry для error tracking (5 строк кода)
   - Request ID middleware
```

### Фаза 2 — Стабильность и тестирование (2–3 недели)

```
5. Тесты
   - Unit: auth.service, job-deduplication, search-preferences, prompt-learning
   - Integration: POST /auth/register, /auth/login, /jobs/automation/run
   - Цель: 50% coverage на бизнес-логике

6. CI/CD (GitHub Actions)
   - На PR: lint → typecheck → tests
   - На merge в main: build → push Docker Hub → deploy

7. Миграции
   - Вынести migrate deploy из Dockerfile в отдельный job
   - Добавить pre-deploy проверку совместимости миграции

8. Резервное копирование
   - pg_dump по cron каждые 24ч → S3
   - Тест восстановления из backup
```

### Фаза 3 — Надёжность и масштабирование (1–2 недели)

```
9. Database connection pool (Prisma + pgBouncer или connection_limit)
10. Распределённый scheduler (Bull + Redis вместо node-cron)
11. Deep health checks (/health/ready, /health/live)
12. Distributed tracing (OpenTelemetry)
13. CDN для фронта
14. Load testing (k6) перед запуском
```

---

## 🚀 Платформа для запуска

### Сравнение вариантов

| Критерий | Railway | Render | AWS (EC2 + RDS) | Fly.io |
|---|---|---|---|---|
| Сложность старта | ⭐ Минимальная | ⭐ Минимальная | 🔴 Высокая | 🟡 Средняя |
| Docker-support | ✅ Нативный | ✅ Нативный | ✅ ECS/EC2 | ✅ Нативный |
| Managed PostgreSQL | ✅ Built-in | ✅ Built-in | ✅ RDS | ✅ Built-in |
| Файловое хранилище | ❌ Нет S3 | ❌ Нет S3 | ✅ S3 нативно | ❌ Нет S3 |
| Стоимость (старт) | ~$20/мес | ~$25/мес | ~$50–100/мес | ~$15/мес |
| Масштабируемость | 🟡 Ограниченная | 🟡 Ограниченная | ✅ Безлимитная | 🟡 Средняя |
| Playwright поддержка | ⚠️ Нужен dockerfile | ⚠️ Нужен dockerfile | ✅ Полная | ✅ Полная |
| Среда для Cron | ✅ Built-in | ✅ Built-in | ✅ ECS Scheduled | ✅ Built-in |
| Secrets management | ✅ Variables | ✅ Environment | ✅ Secrets Manager | ✅ Secrets |
| Geo-регионы | 🟡 Ограничены | 🟡 Ограничены | ✅ Global | ✅ Global |

### Рекомендация

**Для быстрого старта (сейчас, MVP): Railway**

Причины:
- Деплой из docker-compose.yml практически без изменений
- Managed PostgreSQL с автобекапами из коробки
- Variables для секретов с шифрованием
- Cron jobs в том же интерфейсе
- Playwright работает через кастомный Dockerfile (уже есть)
- $20–30/мес на начальном трафике

Единственная доработка: файловое хранилище подключить к S3 (R2 от Cloudflare — бесплатный egress, совместим с S3 API).

**Для роста (50+ активных пользователей): AWS**

- EC2 (t3.medium) для бэкенда
- RDS PostgreSQL (db.t3.micro → db.t3.small по мере роста)
- S3 для файлов
- CloudFront для фронта
- ECS Fargate для изоляции Playwright-задач
- Secrets Manager для ключей
- CloudWatch для логов и алертов

Стоимость: $60–120/мес. Полная гибкость, нет vendor lock-in.

### Итоговая рекомендация по запуску

```
Прямо сейчас: Railway (при закрытых критических багах безопасности из Фазы 1)
├── Backend container (существующий Dockerfile)
├── PostgreSQL (Railway managed)
├── Frontend container (существующий Dockerfile)
└── Cloudflare R2 (S3-совместимый, бесплатный) для файлов

При масштабировании: мигрировать на AWS
├── ECS Fargate (backend + scheduled jobs)
├── RDS PostgreSQL (Multi-AZ для надёжности)
├── S3 + CloudFront (файлы + фронт)
└── Secrets Manager (все ключи)
```

---

## Чеклист перед первым деплоем

```
Безопасность
[ ] AUTH_TOKEN_SECRET задан (32+ символа случайных)
[ ] CORS_ORIGIN явно указан (домен продакшена)
[ ] Все секреты перенесены из .env в vault / platform variables
[ ] Helmet подключён (или заменить когда будет возможность)
[ ] Rate limiting на auth-роутах (или заменить когда будет возможность)
[ ] SSL/TLS настроен (Railway/Render дают автоматически)

Данные
[ ] DATABASE_URL указывает на managed PostgreSQL
[ ] Миграции запущены до старта сервиса
[ ] Автоматический backup БД настроен
[ ] Файловое хранилище подключено к S3 / R2
[ ] STORAGE_DIR указывает на S3-mounted путь или переменную

Операции
[ ] Sentry DSN задан (SENTRY_DSN)
[ ] Telegram алерты настроены
[ ] Health check эндпоинты работают
[ ] Логи агрегируются (Railway logs / CloudWatch)

Тестирование
[ ] Smoke-тест: регистрация → вход → запуск поиска → генерация резюме
[ ] Проверка Gmail OAuth flow
[ ] Проверка загрузки/скачивания файлов
[ ] Проверка лимитов плана FREE
```

---

*Документ создан по результатам аудита кода. Не требует изменений в основном коде — только отражает текущее состояние и план действий.*
