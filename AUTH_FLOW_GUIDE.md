# Auth Flow — гайд-подсказка

Личный конспект по фиче "Аутентификация" (ветка `authentication`, коммит `97507dc` + незакоммиченные изменения поверх). Не для коммита в git — справка "что и зачем сделано", по аналогии с `RBAC_FLOW_GUIDE.md`.

## 1. Модель данных

```
AuthConfirmationSetting (action -> required)   — глобальный флаг "нужно ли подтверждение"
LoginAttempt (userId -> codeHash, expiresAt...) — состояние одной попытки входа
```

- `AuthConfirmationSetting` (`auth_confirmation_settings`) — `action` (unique, сейчас только `'login'`), `required` (boolean). Сеется миграцией с `('login', false)`.
- `LoginAttempt` (`login_attempts`) — `userId` (FK на `users`, CASCADE), `codeHash` (bcrypt-хеш OTP, не сырой код), `expiresAt`, `attemptsCount`, `consumedAt` (null → не использована), `lastSentAt` (для resend-cooldown).

Файлы: `src/modules/auth/entities/{auth-confirmation-setting,login-attempt}.entity.ts`.

**Пойманный по пути баг:** `consumedAt: Date | null` без явного `type` в `@Column` валил `migration:generate` (`DataTypeNotSupportedError: Data type "Object"`) — юнион-тип не читается `reflect-metadata`. Фикс: `@Column({ type: 'timestamp', nullable: true })` — тип из декоратора, не из рефлексии.

## 2. Миграции и сидинг

`1788400000000-CreateAuthSettings.migration.ts` — таблица настроек + сид `('login', false)` + новый RBAC-ресурс `auth-settings` → `[manage]` + грант роли `admin` (переиспользует существующие таблицы `permissions`/`role_permissions`, новых не создаёт).

`1788400001-CreateLoginAttempts.migration.ts` — таблица попыток, `FK ON DELETE CASCADE`, индекс на `user_id` (под будущий resend-cooldown запрос).

**Осознанное отступление от исходного плана:** сеяли **только** `('login', false)`, не `('register', false)` — чтобы не создавать в БД/admin-API переключатель, который `AuthService.register()` не читает и который бы ничего не менял при включении (регистрация не входит в объём этой задачи).

Обе миграции написаны вручную поверх DDL от `migration:generate` — сгенерённый файл заодно менял `role_permissions`/`user_roles` (существовавший до задачи дрейф между decorator'ами и ручной `CreateRbac`-миграцией), эти изменения вырезаны.

## 3. Флоу логина — развилка A/B (`AuthService.login`, `auth.service.ts:100-121`)

```ts
if (!this.authConfigService.isConfirmationRequired('login')) {
  return this.issueTokens(user.id);          // вариант A — как было раньше
}
return this.createPendingLoginAttempt(user);  // вариант B — новое
```

`issueTokens(userId)` (`:159-163`) — единственное место, где подписывается JWT (`{ sub: userId }`, без ролей — роли всегда читаются свежими из БД, см. `RBAC_FLOW_GUIDE.md` п.3). Точка расширения под будущую Авторизацию (cookies+refresh) — поменяется только тело этого метода.

`createPendingLoginAttempt` (`:165-224`):
1. Ищет последнюю **неиспользованную** попытку юзера (`consumedAt IS NULL`, `ORDER BY createdAt DESC`).
2. Если есть и `lastSentAt` было < `OTP_RESEND_COOLDOWN_SECONDS` назад → `429 Too many requests` (класса `TooManyRequestsException` в `@nestjs/common` нет — используется `HttpException` напрямую).
3. Иначе — **переиспользует** ту же строку (если была) или создаёт новую: генерирует код (`generateOtpCode`, вынесен в `otp.util.ts` — единственная чистая функция без DI-зависимостей, `crypto.randomInt` + `padStart`), хеширует (`bcrypt`, тот же `SALT_ROUNDS`, что у паролей), считает `expiresAt`.
4. `mailService.send(...)` — отправка (реальная или в лог, см. п.6).
5. Отвечает `{ attemptId, method: 'otp', expiresInSec }`.

## 4. Подтверждение — `confirmLogin` (`auth.service.ts:123-157`)

Единая ошибка `401 Invalid or expired code` на всё "плохое" (не палит, что именно не так), но порядок проверок важен:

```
1. попытка не найдена               → 401, без инкремента
2. уже consumedAt / истекла /       → 401, без инкремента —
   лимит попыток исчерпан             поздно/бессмысленно наказывать
3. bcrypt.compare(code, hash)
   не совпал                        → attemptsCount++, save, 401
4. совпал                           → consumedAt=now, issueTokens()
```

Инкремент строго на шаге 3 — иначе "поздние" попытки (после лимита/истечения) раздували бы счётчик без смысла.

`POST /auth/login/confirm` — `@Public()` (юзер ещё не аутентифицирован) + `@Throttle` (та же защита, что на `/auth/login`).

## 5. `AuthConfigService` — кэш флага (калька `RbacConfigService`)

```ts
private cache = new Map<string, boolean>();   // плоский, не вложенный как у RBAC —
                                                 // здесь одна размерность (action -> bool)
isConfirmationRequired(action) {
  return this.cache.get(action) ?? false;      // fail-OPEN, не fail-closed как у RbacGuard —
}                                                // отсутствие настройки не должно
                                                 // блокировать вход всем
```

`reload()` — `SELECT *` из таблицы, пересобирает Map с нуля, атомарно заменяет `this.cache`. Вызывается при `onModuleInit` и после каждой мутации в `AuthSettingsService`.

**Не используется в обычном флоу логина сам по себе — читается, не пишется.** Это принципиально разные сервисы, легко перепутать:
- `AuthConfigService` — "спросить" (read-only, in-memory, вызывается из `AuthService.login()`).
- `AuthSettingsService` — "изменить" (пишет в БД, потом дёргает `reload()` у первого).

## 6. `AuthSettingsService`/`AuthSettingsController` — admin API (закрывает п.1 ТЗ)

Тот же шаблон, что `RolesService`/`PermissionsService`/`GrantsService`, но урезанный до 2 методов из 4 — действия (`login`) заводятся только миграцией, админ не создаёт/не удаляет их через API, только читает и переключает:

```
findAll()                    → GET  /admin/auth-settings
update(action, dto, actorId) → PUT  /admin/auth-settings/:action
  1. найти по action → 404, если нет (напр. 'register' — сознательно не сеяли)
  2. setting.required = dto.required; save()   ← пишет в БД, источник истины
  3. authConfigService.reload()                ← синхронизирует кэш
  4. [AUTH audit] actor=... op=update entity=auth-setting id=<action> result=<код>
```

Оба метода под `@RequirePermission('auth-settings', 'manage')` — тот же `RbacGuard`, то же право, что выдано роли `admin` миграцией (п.2).

**Важный практический эффект:** с появлением этого контроллера исчезла вся ручная возня с `psql` + перезапуском dev-сервера (webpack watch не видит изменений в БД, только в файлах) — переключение флага стало мгновенным через один HTTP-запрос, `reload()` внутри `update()` синхронизирует кэш без рестарта.

## 7. `MailService` — заглушка с fallback, не strict-режим (`src/core/mail/mail.service.ts`)

```ts
async onModuleInit() {
  const smtpUrl = this.configService.get('SMTP_URL');
  if (!smtpUrl) { /* лог-warn, transporter остаётся null */ return; }

  try {
    await transporter.verify();
    this.transporter = transporter;
  } catch (error) {
    /* лог-error, transporter остаётся null — НЕ крашим приложение */
  }
}

async send(to, subject, body) {
  if (!this.transporter) { /* [MAIL STUB] в лог */ return; }
  await this.transporter.sendMail({ from: MAIL_FROM, to, subject, text: body });
}
```

`SMTP_URL`/`MAIL_FROM` — опциональны в Joi (`config.validation.ts`), не `required()` — сознательное отступление от обычного "fail fast" конфига проекта: почта не критична для старта приложения (в отличие от БД/JWT), плохой SMTP не должен ронять весь сервер.

`SMTP_URL` — единая connection-строка (`smtp://user:pass@host:port`), не 4 отдельных переменных — `nodemailer.createTransport()` парсит её сам. Формат `smtp://email@gmail.com:apppass@smtp.gmail.com:587` содержит два `@` — стандартные URL-парсеры берут **последний** `@` как границу userinfo/host, это не баг.

Подтверждено реальной отправкой на личный Gmail (app password, 2FA) — письмо дошло, `confirmLogin` с реальным кодом из письма отработал корректно.

## 8. Полная трассировка запроса (пример — переключение флага)

```
PUT /admin/auth-settings/login  {"required": true}  Authorization: Bearer <adminJWT>
  ↓ ValidationPipe — UpdateAuthSettingDto (@IsBoolean)
  ↓ JwtAuthGuard — verify JWT → findById → request.user={id}
  ↓ RbacGuard — findById(с .roles) → hasPermission(['admin'],'auth-settings','manage') → true
  ↓ AuthSettingsController.update → AuthSettingsService.update('login', dto, actorId)
      → findOneBy({action:'login'}) → найдена
      → required=true, save() → UPDATE в БД
      → authConfigService.reload() → SELECT * → новая Map → this.cache = новая
      → [AUTH audit] ... result=200
  ↓ 200 { id, action:'login', required:true }

Следующий же запрос:
POST /auth/login {email,password}
  ↓ authConfigService.isConfirmationRequired('login')
      → this.cache.get('login') → true   ← та самая Map, обновлённая секунду назад
  ↓ createPendingLoginAttempt(...) → 200 { attemptId, method:'otp', expiresInSec }
```

Единственная связь между двумя разными контроллерами — общий `this.cache` внутри одного синглтон-инстанса `AuthConfigService` (без `Scope.REQUEST`), не поход в БД.

## Открытые вопросы / TODO (сознательно пропущено на этом шаге)

- [ ] Audit-логи на `login()`/`confirmLogin()` в `AuthService` — сейчас есть только у `AuthSettingsService` (по образцу `[RBAC audit]`).
- [ ] Тесты на новую логику (`createPendingLoginAttempt`/`confirmLogin`/resend-cooldown/`AuthSettingsService`/`AuthConfigService`) — вся проверка на этот момент только ручная (`.http`-файлы, curl, реальная почта).
- [ ] Magic link (п.1.3.2 ТЗ) — не реализован, модель данных не мешает добавить отдельной сущностью позже.
- [ ] Email-подтверждение для регистрации — флаг `register` сознательно не заведён (см. п.2).
- [ ] Cookies/refresh (раздел "Авторизация" из ТЗ) — не тронуто, `issueTokens()` изолирован как точка расширения.
