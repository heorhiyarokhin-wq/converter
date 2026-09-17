# User Profile — просмотр, изменение, смена email, удаление, список (converter)

Рядом: [docs/auth-authorization.md](auth-authorization.md) (аутентификация + RBAC, на чём всё это строится), [docs/orm-typeorm.md](orm-typeorm.md), [docs/postgres-sql.md](postgres-sql.md).

Протестировать руками: `requests/user-profile.http`.

Документация: [NestJS Authorization](https://docs.nestjs.com/security/authorization), [TypeORM QueryBuilder](https://typeorm.io/select-query-builder), [class-validator](https://github.com/typestack/class-validator).

Все примеры ниже — реальный код, не иллюстрация: [`user-profile.controller.ts`](../src/modules/user-profile/user-profile.controller.ts), [`user-profile.service.ts`](../src/modules/user-profile/user-profile.service.ts).

---

## 1. Главная проблема фичи: RBAC отвечает не на тот вопрос

`RbacGuard` (см. [docs/auth-authorization.md](auth-authorization.md)) умеет проверять один вопрос: *"может ли роль X в принципе выполнять действие Y над ресурсом Z"*. Это грубый, ролевой фильтр — он ничего не знает про `:id` в URL.

Но `GET /users/:id` — на самом деле два разных вопроса:
1. Может ли роль вообще смотреть профили? → отвечает `RbacGuard` через `@RequirePermission('users', 'read')`.
2. Тот `:id`, что в URL — это сам вызывающий или чужой профиль? → RBAC этого не видит и не проверяет. Это называется **object-level authorization** (или ownership check) — универсальная проблема всех RBAC-систем, не специфичная для Nest. Забыть эту вторую проверку — классический IDOR (Insecure Direct Object Reference).

### Решение: один и тот же грант, два уровня действий

`RbacConfigService` (уже разобран в auth-authorization.md) поддерживает override действий на уровне гранта:

```ts
// src/modules/rbac/rbac-config.service.ts
const effectiveActions =
  grant.actions && grant.actions.length > 0
    ? grant.actions             // роль user: override ['read', 'update']
    : grant.permission.actions; // роль admin: без override → полный список, включая read-any/update-any
```

Разрешение `users` целиком: `['read', 'update', 'read-any', 'update-any', 'delete', 'delete-any']`. Роль `user` получает урезанный грант (`read`, `update`, `delete` — только "свои" действия), роль `admin` получает грант без override — значит автоматически видит весь список, включая `*-any`.

Дальше в коде это две проверки, а не одна:
- **Грубый фильтр на роуте** — `@RequirePermission('users', 'read')` пропускает и `user`, и `admin` (у обеих ролей есть `read`).
- **Точная проверка внутри сервиса** — вызывается вручную, не через guard, потому что только сервис видит и `targetId` из URL, и `viewerId` из токена:

```ts
// src/modules/user-profile/user-profile.service.ts
async getProfile(targetId: string, viewerId: string): Promise<UserProfileView> {
  if (targetId !== viewerId) {
    const viewerRoles = await this.getRoleNames(viewerId);
    const canReadAny = this.rbacConfigService.hasPermission(viewerRoles, 'users', 'read-any');
    if (!canReadAny) throw new ForbiddenException(); // 403 — виден чужой ресурс, но право не то
  }
  // ...
}
```

**Важно понимать правильно:** `read-any` — не "супер-право видеть вообще всё". Оно проверяется **только** в ветке `targetId !== viewerId`. Свой профиль (`targetId === viewerId`) читается по обычному `read`, которое есть у всех ролей — `read-any` там даже не спрашивается.

Вывод, который стоит запомнить как общий принцип: **`RbacConfigService` — обычный инжектируемый сервис с кэшем в памяти, а не что-то, что умеет вызывать только `RbacGuard`.** Звать `.hasPermission()` вручную откуда угодно — нормальный паттерн, когда guard не видит нужные данные (id из пути).

---

## 2. Почему `UserProfileModule`, а не контроллер внутри `UsersModule`

`UsersModule` — уже общая нижнеуровневая зависимость для `AuthModule` и `RbacModule` (обоим нужен `UsersService`/`User`). Добавление HTTP-слоя новой фичи (`UserProfileController`) прямо туда означало бы: `UserProfileModule`-функционал внутри модуля, который трогают ради других задач, плюс потенциальный цикл, если профильному сервису понадобится `RbacModule` (а он ему нужен — для `RbacConfigService`), а `RbacModule` уже импортирует `UsersModule`.

Решение — не чинить цикл, а не создавать его: новый модуль, зависимости идут только "наружу":

```
UserProfileModule ──> UsersModule
UserProfileModule ──> RbacModule ──> UsersModule
```

`UsersModule` при этом остаётся чистым "доступ к данным" слоем — ни одного контроллера.

---

## 3. Изменение профиля — почему email нельзя менять через обычный `PATCH`

```ts
// src/modules/user-profile/user-profile.service.ts
if (dto.email !== undefined && !isElevated) {
  throw new ForbiddenException(
    'Self cannot change email directly, use /email-change',
  );
}
```

`isElevated` (наличие `update-any`) отвечает сразу на два разных по смыслу вопроса — "можно ли трогать чужой профиль" и "можно ли менять email напрямую" — потому что по правилам системы это одно и то же право (Admin). Не размножаем права там, где по смыслу это один и тот же уровень доступа.

Валидация формата (`@IsEmail()` в DTO) и проверка прав (кто МОЖЕТ прислать это поле) — намеренно в разных местах: `ValidationPipe` (глобальный, `main.ts`) отрабатывает до того, как выполнится хоть строчка бизнес-логики контроллера, и ничего не знает про роли/`viewerId`. Формат email не зависит от того, кто его прислал — смешивать эти проверки было бы усложнением без пользы.

---

## 4. Смена email — почему это **два запроса** и **отдельная сущность**, а не то же самое, что login-OTP

### Почему два запроса

`POST /users/:id/email-change` → `POST /users/:id/email-change/confirm`. Между ними должно пройти время (пользователь идёт читать почту), а HTTP/JWT — stateless: серверу негде "запомнить" код между двумя независимыми запросами кроме как в БД:

```ts
// src/modules/user-profile/entities/email-change-request.entity.ts
@Entity('email_change_requests')
export class EmailChangeRequest {
  @Column({ name: 'user_id' }) userId: string;
  @Column({ name: 'new_email' }) newEmail: string;   // ← ключевое отличие от LoginAttempt
  @Column({ name: 'code_hash' }) codeHash: string;
  @Column({ name: 'expires_at' }) expiresAt: Date;
  @Column({ name: 'attempts_count', default: 0 }) attemptsCount: number;
  @Column({ name: 'consumed_at', nullable: true }) consumedAt: Date | null;
  @Column({ name: 'last_sent_at' }) lastSentAt: Date;
}
```

### Почему не переиспользовать `LoginAttempt` (тот же механизм из auth-флоу)

Механика идентична (`bcrypt`-хэш кода, `expiresAt`, `attemptsCount`, `lastSentAt`, единое сообщение об ошибке) — но `LoginAttempt` не хранит **новое значение**, которое нужно применить после подтверждения (после логина просто выдаётся токен тому же юзеру). `EmailChangeRequest` обязан хранить `newEmail` — то, что подтверждение должно **записать**. Общая "generic OTP"-абстракция под оба случая превратилась бы в сущность с полем-заглушкой "что применить после" (JSON blob) — сложнее читать, чем две простых именованных таблицы.

**Вывод, применимый шире:** одинаковая *механика* (TTL + bcrypt + счётчик попыток) — повод переиспользовать *паттерн* (структуру кода), но не обязательно физически объединять в одну сущность/сервис. Что реально переиспользуется буквально — сама генерация кода: `generateOtpCode()` вынесена в `src/core/otp/otp.util.ts`, откуда её берут и `AuthService`, и `UserProfileService`.

### Код идёт на новый адрес, не на старый

```ts
// код идёт на НОВЫЙ адрес — это и есть проверка владения им, а не старым
await this.mailService.send(newEmail, 'Email change confirmation', `Your code: ${code}`);
```
Это единственное реальное доказательство, которое запрашивается: пользователь может прочитать почту по адресу, на который её меняют.

---

## 5. Удаление аккаунта — почему `DELETE` синхронный, hard-delete, и без blacklist токенов

Три решения, каждое — сознательный отказ от более сложного варианта:

**Синхронный `DELETE`, не job+queue.** В проекте нет очереди (Redis/Bull) — заводить инфраструктуру ради одной фичи было бы избытком. Убирает целиком промежуточное состояние "уже удаляется" (`409`) и отдельный `GET /deletion-status`.

**Hard delete, не анонимизация.** FK на `users` из трёх таблиц уже настроены `ON DELETE CASCADE`:
```
user_roles              → FK users, ON DELETE CASCADE
login_attempts          → FK users, ON DELETE CASCADE
email_change_requests   → FK users, ON DELETE CASCADE
```
`DELETE FROM users WHERE id = ...` сам подчищает все связанные строки за один SQL — Postgres делает всю работу.

**Отзыв токенов — не строим отдельно, работает бесплатно.** `JwtAuthGuard` на каждый запрос делает `usersService.findById(payload.sub)`. Как только строки `users` больше нет — **любой** следующий запрос тем же access-токеном получает `401`, даже если `exp` ещё не истёк. Отдельно чистится только refresh-cookie (как в `logout`):

```ts
// src/modules/user-profile/user-profile.controller.ts
if (targetId === actor.id) {
  reply.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
}
```

**Подтверждение self-delete — паролем, не OTP.** Не заводим третью почти идентичную OTP-сущность (после `LoginAttempt` и `EmailChangeRequest`) — один запрос вместо двух, то же доказательство личности ("вы прямо сейчас знаете текущий пароль"):

```ts
if (!isElevated) {
  if (!dto.password) throw new BadRequestException('password is required to delete your own account');
  const passwordMatches = await bcrypt.compare(dto.password, target.passwordHash);
  if (!passwordMatches) throw new UnauthorizedException('Invalid password');
}
// admin, удаляющий чужой аккаунт — isElevated, пароль не нужен вообще
```

---

## 6. Список пользователей — offset-пагинация и почему не cursor

`GET /users` (тот же контроллер, отдельный `@RequirePermission('users', 'read-any')` — только admin, self-кейса тут физически не бывает, значит развилки self/any внутри сервиса нет вообще).

### Offset — «страница по номеру»

```sql
SELECT * FROM users ORDER BY created_at DESC LIMIT 20 OFFSET 40; -- страница 3
```
Тривиально реализовать, можно прыгнуть на любую страницу. Минус — Postgres физически читает и отбрасывает все `OFFSET` строк перед `LIMIT` (дорого на больших таблицах), и результат "плывёт", если между запросами что-то удалили/добавили.

### Keyset/cursor — «дай то, что после этой точки» (не реализовано, но держим в уме)

```sql
SELECT * FROM users
WHERE (created_at, id) < ('2026-09-01 10:00:00', 'uuid-последнего')
ORDER BY created_at DESC, id DESC
LIMIT 20;
```
Быстро на любом объёме (использует индекс, не сканирует пропущенное), устойчиво к удалениям между запросами. Минус — нельзя прыгнуть на "страницу 5", только вперёд от текущей точки. **Решение проекта: offset сейчас** — таблица маленькая, деградация offset на больших `OFFSET` не грозит; keyset — осознанно отложено.

### Явный `select` — не забывчивость, а гарантия

```ts
// src/modules/users/users.service.ts
findMany(params: { limit: number; offset: number; q?: string }) {
  return this.usersRepository.findAndCount({
    // явный select — гарантия, что passwordHash (и любое чувствительное поле,
    // которое кто-то добавит в entity в будущем) никогда не попадёт в список.
    // Без select find() тянет ВСЕ колонки по умолчанию.
    select: { id: true, email: true, photo: true, createdAt: true },
    where: { email: ILike(`%${params.q ?? ''}%`) },
    order: { createdAt: 'DESC' },
    take: params.limit,
    skip: params.offset,
  });
}
```
Поиск — только по `email` (`ILIKE`): единственное текстовое поле `User`, где вообще имеет смысл частичный поиск, и на нём уже есть unique index (`@Column({ unique: true })`) — отдельная миграция под индекс не нужна.

---

## Сводная таблица эндпоинтов

| Роут | Право (грубый фильтр) | Self/any-развилка внутри сервиса |
|---|---|---|
| `GET /users` | `read-any` | нет — только admin проходит guard |
| `GET /users/:id` | `read` | да — чужой профиль требует `read-any` |
| `PATCH /users/:id` | `update` | да — чужой профиль и/или смена `email` требуют `update-any` |
| `POST /users/:id/email-change` | `update` | да — только self (`targetId === actorId`), иначе `403` |
| `POST /users/:id/email-change/confirm` | `update` | да — только self |
| `DELETE /users/:id` | `delete` | да — чужой требует `delete-any`; self требует пароль в теле |

## Аудит (`[USERS audit]`, тот же формат, что `[AUTH audit]`/`[RBAC audit]`)

Значения полей (email, пароль, код) никогда не попадают в лог — только их **имена** и результат:
```
action=view   result=200|403|404 viewerId=... targetId=...
action=update result=200|403|404 actorId=... targetId=... fields=email,photo
action=delete result=200|403|404 actorId=... targetId=...
```
