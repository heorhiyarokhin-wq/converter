# RBAC Flow — гайд-подсказка

Личный конспект по фиче access_control (коммит `fd3e1af`). Не для коммита в git — просто справка "что и зачем сделано".

## 1. Модель данных

```
User --(N..M, join-таблица user_roles)--> Role --(через Grant)--> Permission
```

- `Role` (`roles`) — id, name (unique, case-insensitive через отдельный индекс), description.
- `Permission` (`permissions`) — resource (unique), actions[] (максимум возможных действий на ресурсе).
- `Grant` (`role_permissions`) — связка role↔permission, с опциональным `actions[]`, который **сужает** набор действий из Permission для конкретной роли. Пусто/null → берутся все actions из Permission.
- `User.roles` — `@ManyToMany` к Role через `user_roles`. Юзер может иметь несколько ролей.

Файлы: `src/modules/rbac/entities/{role,permission,grant}.entity.ts`, `src/modules/users/entities/user.entity.ts`.

**Пробел:** нет CRUD/API для `user_roles` (назначение роли конкретному юзеру). Есть только:
- автоназначение роли `user` при регистрации (`UsersService.createUser`);
- разовый перенос ролей существующих юзеров в миграции.
Чтобы сделать юзера admin — только вручную через БД.

## 2. Миграция и сидинг (`1788300000000-CreateRbac.migration.ts`)

Порядок: `roles` → `permissions` → `role_permissions` (FK CASCADE) → `user_roles` (FK CASCADE).

Сидинг:
- roles: `user`, `admin`
- permissions: `rbac` → `[manage]`
- grant: `admin` → `rbac` (без override → берёт `[manage]`)

Перенос старых данных: `users.role` (enum) → `user_roles` (по имени роли), потом колонка `role` и её enum дропаются.

`down()` — лоссовый откат: если у юзера несколько ролей, в enum попадёт только одна (первая по алфавиту). Комментарий об этом прямо в коде миграции.

## 3. JWT-аутентификация (кто пользователь)

```
POST /auth/register → AuthService.register → createUser (роль user по умолчанию)
POST /auth/login     → AuthService.login → JWT { sub: user.id }  (только id, без ролей!)
```

Почему только `id` в токене: роли пересчитываются из БД на каждый запрос → смена роли действует немедленно, не дожидаясь истечения токена.

`JwtAuthGuard` (глобальный `APP_GUARD` в `AuthModule`) → `JwtStrategy.validate()` → `usersService.findById(sub)` → `request.user = {id}`. 401 если юзера больше нет в БД, даже с валидной подписью токена.

`@Public()` (`SetMetadata(IS_PUBLIC_KEY, true)`) снимает JWT-проверку. Читается через `Reflector.getAllAndOverride` (метод > класс).

## 4. RbacGuard + @RequirePermission (что можно)

```ts
@RequirePermission('rbac', 'manage')  // SetMetadata(PERMISSION_KEY, {resource, action})
```

`RbacGuard` (глобальный `APP_GUARD` в `RbacModule`):
1. `@Public()` → пропустить.
2. Нет `@RequirePermission` на роуте → **403 (fail-closed)**. Забыли навесить декоратор — роут наглухо закрыт, а не открыт всем.
3. `usersService.findById(request.user.id)` — **второй** запрос юзера в БД за request (первый был в JwtStrategy).
4. `rbacConfigService.hasPermission(roleNames, resource, action)` — читает **только из памяти**, без БД.
5. OR-семантика: разрешено, если хотя бы одна роль юзера даёт нужное право.

## 5. RbacConfigService — кэш role→permission

```ts
Map<roleName, Map<resource, Set<action>>>
```

Кэшируется только "какая роль что может" (из `role_permissions`+`permissions`), НЕ "какие роли у юзера" (это всегда свежий запрос к БД).

- Строится при старте (`onModuleInit`).
- Инвалидируется и перестраивается синхронно (`reload()`) после **каждой** мутации в Roles/Permissions/Grants сервисах.
- **Ограничение:** кэш в памяти процесса. При нескольких инстансах приложения `reload()` на одном не видят другие — actual для одного инстанса, "выстрелит" при горизонтальном масштабировании.

## 6. CRUD-модули (Roles / Permissions / Grants)

Единый шаблон во всех трёх (`*.controller.ts` + `*.service.ts`):

```
findAll → find()
create  → проверить уникальность (409) → save → reload() → audit-лог
update  → найти (404) → проверить конфликт если меняется уникальное поле (409)
        → Object.assign + save → reload() → audit-лог
remove  → найти (404) → проверить зависимости (409) → remove → reload() → audit-лог
```

- Все методы контроллеров — `@RequirePermission('rbac', 'manage')` (fail-closed, см. п.4).
- `@Put(':id')`, но DTO с `@IsOptional()` на всех полях → фактически PATCH-семантика, не строгий REST PUT.
- Проверка зависимостей перед удалением (Role/Permission нельзя удалить, если есть Grant) — дублирует FK CASCADE из миграции намеренно: FK — подстраховка от прямого SQL, сервисная проверка — защита от случайного удаления через API.
- Аудит-лог единого формата на все операции, включая неудачные:
  `[RBAC audit] actor=<id> op=<create|update|delete> entity=<role|permission|grant> id=<id|-> result=<http-код>`

Роль **регистрозависимости** различается: у Role — `trim().toLowerCase()` в DTO (защищает `UQ_roles_name_lower`), у Permission `resource` — нет такой нормализации.

## 7. Сборка модулей и порядок guard'ов

```
AppModule imports: [..., UsersModule, AuthModule, RbacModule]
```

Два `APP_GUARD` (multi-provider): `JwtAuthGuard` (из AuthModule) и `RbacGuard` (из RbacModule). Порядок выполнения = порядок импорта модулей в `AppModule`. **Auth обязан идти раньше Rbac** — RbacGuard читает `request.user.id`, который кладёт JwtAuthGuard. Переставить местами в `imports` → рантайм-падение `Cannot read property 'id' of undefined`, без ошибки типов.

`UsersModule` — общая зависимость обоих (`AuthModule` и `RbacModule` импортируют его независимо, циклической связи нет). Связь `User.roles → Role` — только на уровне TypeORM-сущностей, не DI.

`autoLoadEntities: true` в `DatabaseModule` подхватывает все `*.entity.ts` автоматически в схему БД — но `TypeOrmModule.forFeature([...])` в каждом модуле всё равно нужен отдельно, чтобы инжектить `Repository<T>`.

`HealthModule` — единственное место, где `@Public()` висит на классе контроллера целиком, а не на методе.

## Полная трассировка запроса (пример)

```
POST /admin/rbac/grants  Authorization: Bearer <jwt>
  ↓ ValidationPipe (global) — валидация CreateGrantDto
  ↓ JwtAuthGuard — не @Public → verify JWT → findById(sub) → request.user={id}
  ↓ RbacGuard — не @Public → @RequirePermission('rbac','manage')
      → findById(id) → roles → hasPermission(['admin'],'rbac','manage') → true (из кэша)
  ↓ GrantsController.create → GrantsService.create
      → проверки существования role/permission (404) и дубликата (409)
      → save → rbacConfigService.reload() → audit-лог
  ↓ 201 Created
```

## Открытые вопросы / TODO

- [ ] Нет API назначения роли пользователю (`user_roles` управляется только миграцией + дефолтом при регистрации).
- [ ] Двойной запрос юзера в БД на защищённый запрос (JwtStrategy + RbacGuard независимо зовут `findById`) — не критично для CRUD, но заметно для горячих read-эндпоинтов.
- [ ] Кэш `RbacConfigService` не переживёт горизонтальное масштабирование без доп. механизма инвалидации между инстансами.
- [ ] Асимметрия нормализации: Role.name нормализуется (trim+lowercase), Permission.resource — нет.
