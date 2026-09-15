# Authentication & Authorization — разбор по пунктам (converter)

Рядом с этим файлом: [docs/orm-typeorm.md](orm-typeorm.md) (как сущности ложатся в SQL) и [docs/postgres-sql.md](postgres-sql.md) (сам SQL). Здесь — как поверх этого построена аутентификация (кто ты) и авторизация (что тебе можно).

Протестировать руками: `requests/login.http`, `requests/rbac.http`, `requests/user-profile.http` — REST Client-файлы с готовыми сценариями (включая 401/403/409).

Документация: [NestJS Authentication](https://docs.nestjs.com/security/authentication), [NestJS Authorization](https://docs.nestjs.com/security/authorization), [jwt.io](https://jwt.io/introduction) (что такое JWT и как его читать), [bcrypt](https://www.npmjs.com/package/bcryptjs).

---

## 1. Authentication vs Authorization

Два вопроса, которые постоянно путают, потому что решаются один за другим на одном запросе:

- **Authentication (аутентификация)** — "кто ты?". Проверка личности: ты действительно тот, за кого себя выдаёшь (обычно — предъявил валидный токен/пароль).
- **Authorization (авторизация)** — "что тебе можно?". Уже зная, кто ты, — разрешено ли тебе именно это действие над именно этим ресурсом.

В converter это буквально **два разных guard'а**, включённых глобально один за другим на каждый запрос:

```
запрос → JwtAuthGuard (authentication) → RbacGuard (authorization) → контроллер
```

[`JwtAuthGuard`](../src/core/auth/guards/jwt-auth.guard.ts) — только про личность:

```ts
const token = request.headers.authorization?.replace('Bearer ', '');
if (!token) throw new UnauthorizedException();

const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
const user = await this.usersService.findById(payload.sub);
if (!user) throw new UnauthorizedException();

request.user = { id: user.id };   // дальше по цепочке уже известно, КТО это
```

[`RbacGuard`](../src/core/rbac/guards/rbac.guard.ts) — только про право, и работает уже после того, как `request.user` заполнен:

```ts
const allowed = this.rbacConfigService.hasPermission(
  roleNames,
  requirement.resource,
  requirement.action,
);
if (!allowed) throw new ForbiddenException();
```

Отсюда и разные коды ошибок: **401 Unauthorized** — не прошёл аутентификацию (нет валидного токена вообще, `JwtAuthGuard`). **403 Forbidden** — аутентификация прошла, личность известна, но именно этому пользователю именно это действие запрещено (`RbacGuard` или ручная проверка в сервисе). Если в ответе 403 — значит, приложение уже знает, кто вы; если 401 — ещё нет.

---

## 2. User Registration & Login

**Регистрация** — создать нового пользователя. **Логин** — по паре email/пароль подтвердить личность и выдать токены.

[`RegisterDto`](../src/modules/auth/dto/register.dto.ts):

```ts
export class RegisterDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'password must contain at least one letter and one digit',
  })
  password: string;
}
```

[`AuthService.register`](../src/modules/auth/auth.service.ts):

```ts
async register(dto: RegisterDto): Promise<RegisteredUser> {
  const existingUser = await this.usersService.findByEmail(dto.email);
  if (existingUser) {
    throw new ConflictException('Email already registered');   // 409 — email занят
  }

  const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

  try {
    const user = await this.usersService.createUser({ email: dto.email, passwordHash });
    return { id: user.id, email: user.email, roles: user.roles.map(r => r.name), createdAt: user.createdAt };
  } catch (error) {
    if (this.isUniqueViolation(error)) {
      throw new ConflictException('Email already registered');  // гонка: кто-то занял email между проверкой и записью
    }
    throw error;
  }
}
```

Два слоя защиты от дубля email не случайны: `findByEmail` — быстрая проверка "на глаз" перед тем, как что-то делать; `catch` на код ошибки Postgres `23505` (unique violation) — страховка на случай гонки, если два запроса регистрации с одним email пришли почти одновременно. Первого слоя недостаточно самого по себе — между `findByEmail` и `save` есть окно, в которое может успеть вклиниться другой запрос.

**Логин** ([`AuthService.login`](../src/modules/auth/auth.service.ts)) — не просто "сверить пароль", а развилка на опциональное второе подтверждение (см. §5–6):

```ts
async login(dto: LoginDto): Promise<TokenPair | PendingLoginResult> {
  const user = await this.usersService.findByEmail(dto.email);
  if (!user) throw new UnauthorizedException('Invalid credentials');

  const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);
  if (!passwordMatches) throw new UnauthorizedException('Invalid credentials');

  if (!this.authConfigService.isConfirmationRequired('login')) {
    return this.issueTokens(user.id);        // без доп. подтверждения — сразу пара токенов
  }

  return this.createPendingLoginAttempt(user); // с OTP — сначала код на почту, токены позже
}
```

**Важная деталь про безопасность сообщений об ошибке:** и "нет такого email", и "пароль неверный" отвечают одинаковым `UnauthorizedException('Invalid credentials')`. Если бы ответы отличались (`404 No such user` vs `401 Wrong password`), злоумышленник по коду ошибки мог бы перебором узнавать, какие email вообще зарегистрированы в системе — классическая утечка через различимость ошибок (подробнее та же идея разобрана в §10 на примере OTP).

---

## 3. Password Hashing

Пароль **никогда** не хранится в открытом виде и не шифруется обратимо (encryption, где есть ключ для расшифровки) — он **хешируется** (hashing, необратимая операция: из хеша пароль восстановить нельзя даже с ключом).

```ts
const SALT_ROUNDS = 10;
const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
```

`bcrypt` — не просто хеш-функция (как `sha256`), а специально **медленная**, с встроенной **солью** (`salt`) — случайным значением, добавляемым к паролю перед хешированием. Соль хранится в самом результате `bcrypt.hash(...)` (не отдельной колонкой) — поэтому у двух пользователей с одинаковым паролем `passwordHash` в БД будет разным. Без соли одинаковые пароли давали бы одинаковые хеши, и rainbow-table атака (заранее посчитанные хеши популярных паролей) была бы тривиальной.

`SALT_ROUNDS = 10` — количество раундов хеширования (сложность растёт экспоненциально: `2^10` итераций). Чем больше — тем дольше считать хеш (и на регистрации, и при переборе паролей злоумышленником), но и дольше логиниться легитимному пользователю. 10 — стандартный баланс для 2020-х.

Проверка при логине — **не** "расшифровать и сравнить" (это невозможно), а **захешировать введённый пароль той же солью и сравнить хеши**:

```ts
const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);
```

`bcrypt.compare` сам достаёт соль из `user.passwordHash`, хеширует `dto.password` ею же и сравнивает результат — вызывающему коду соль знать не нужно.

---

## 4. JWT

**JWT (JSON Web Token)** — подписанная строка вида `header.payload.signature`, которую сервер может проверить **без похода в БД за сессией**. Расшифровать открытым способом может кто угодно (payload — просто `base64`, не секрет), а вот подделать — нет: подпись считается секретным ключом (`JWT_SECRET`), которого нет ни у кого, кроме сервера.

Выпуск токена ([`AuthService.issueTokens`](../src/modules/auth/auth.service.ts)):

```ts
const accessToken = await this.jwtService.signAsync({ sub: userId });
```

`sub` (subject) — стандартное поле JWT для "кому принадлежит токен", у нас — `userId`. Больше в payload ничего не кладём (ни email, ни роли) — намеренно: роли меняются (см. §9), а токен неизменен до истечения TTL. Если бы роли лежали в токене, отзыв прав задним числом не сработал бы, пока не истечёт старый токен.

Настройка секрета/TTL ([`AuthModule`](../src/modules/auth/auth.module.ts)):

```ts
JwtModule.registerAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    secret: config.get('JWT_SECRET'),
    signOptions: { expiresIn: config.get('JWT_EXPIRES_IN') },
  }),
}),
```

Проверка на каждый защищённый запрос ([`JwtAuthGuard`](../src/core/auth/guards/jwt-auth.guard.ts)):

```ts
const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
```

`verifyAsync` пересчитывает подпись тем же `JWT_SECRET` и сравнивает с той, что в токене — не совпало (истёк / подделан / не тем секретом подписан) → бросает исключение → guard превращает это в `401`. Это и значит "stateless": серверу не нужна таблица активных сессий — вся нужная информация (кто, до какого момента) уже внутри самого токена, подтверждённая подписью.

---

## 5. Access & Refresh Tokens

Один токен на всё — плохая идея: если он живёт долго (недели), кража токена (XSS, перехват) даёт доступ надолго; если живёт коротко (минуты), пользователю приходится перелогиниваться каждые несколько минут. Решение — **два токена с разным назначением**.

```ts
private async issueTokens(userId: string): Promise<TokenPair> {
  const accessToken = await this.jwtService.signAsync({ sub: userId });
  const refreshToken = await this.jwtService.signAsync(
    { sub: userId },
    {
      secret: this.configService.get('JWT_REFRESH_SECRET'),        // ДРУГОЙ секрет
      expiresIn: this.configService.get('JWT_REFRESH_EXPIRES_IN'), // ДРУГОЙ TTL
    },
  );
  return { accessToken, refreshToken };
}
```

| | Access token | Refresh token |
|---|---|---|
| TTL | `JWT_EXPIRES_IN` = `15m` | `JWT_REFRESH_EXPIRES_IN` = `30d` |
| Секрет | `JWT_SECRET` | `JWT_REFRESH_SECRET` (другой!) |
| Где хранится у клиента | заголовок `Authorization: Bearer …` (обычно в памяти JS) | `httpOnly` cookie |
| Зачем | подтверждать личность на каждом запросе | получить новую пару токенов, когда access истёк |

**Разный секрет — не паранойя, а изоляция.** Если бы оба токена подписывались одним `JWT_SECRET`, утечка одного секрета компрометировала бы оба механизма разом. А раздельные секреты — это ещё и защита от **подмены типа токена**: без этого ничто не мешало бы подсунуть access-токен туда, где ожидается refresh (оба ведь просто JWT с `{ sub }`) — `verifyAsync(token, { secret: JWT_REFRESH_SECRET })` на access-токене, подписанном `JWT_SECRET`, провалится на проверке подписи.

**Почему refresh — именно в `httpOnly` cookie, а не так же, как access** ([`AuthController.setRefreshCookie`](../src/modules/auth/auth.controller.ts)):

```ts
reply.setCookie(REFRESH_COOKIE_NAME, token, {
  httpOnly: true,     // JS на странице не может прочитать document.cookie и украсть его через XSS
  sameSite: 'lax',    // не уйдёт автоматически на сторонний сайт (CSRF-смягчение)
  path: '/auth/refresh',   // браузер отправит cookie ТОЛЬКО на этот путь, не на каждый запрос
  secure: this.configService.get('NODE_ENV') === 'production',
  maxAge: ms(this.configService.get('JWT_REFRESH_EXPIRES_IN')) / 1000,
});
```

`path: '/auth/refresh'` — тонкий, но важный момент: раз refresh-токен живёт **30 дней** и способен выпускать новые токены, его ценность для атакующего намного выше access-токена. Ограничение по `path` значит, что браузер даже не приложит эту cookie к обычным API-запросам (`GET /users/:id` и т.п.) — только к единственному эндпоинту, которому она вообще нужна.

---

## 6. Token Expiration & Rotation

**Expiration (истечение)** — TTL из §5: `15m` для access, `30d` для refresh. Когда access истёк, обычные запросы начнут получать `401` от `JwtAuthGuard` (`verifyAsync` бросит из-за просроченной подписи) — это ожидаемо, не баг.

**Rotation (ротация)** — при каждом обращении к `/auth/refresh` сервер выдаёт **новую** пару токенов, а не продлевает старую ([`AuthService.refreshTokens`](../src/modules/auth/auth.service.ts)):

```ts
async refreshTokens(refreshToken: string): Promise<TokenPair> {
  const payload = await this.jwtService.verifyAsync<{ sub: string }>(
    refreshToken,
    { secret: this.configService.get('JWT_REFRESH_SECRET') },
  );

  const user = await this.usersService.findById(payload.sub);
  if (!user) throw new UnauthorizedException('Invalid refresh token');

  return this.issueTokens(user.id);   // новый access И новый refresh
}
```

[`AuthController.refresh`](../src/modules/auth/auth.controller.ts) сразу же перезаписывает cookie новым refresh-токеном (`this.setRefreshCookie(reply, tokens.refreshToken)`) — старый refresh-токен из этого запроса больше клиенту не нужен и не возвращается повторно.

**Честный пробел, который стоит знать:** ротация здесь — только "выдать новый", а не "отозвать старый". Старый refresh-токен, если его успели скопировать до ротации, **остаётся технически валидным** до собственного истечения (`verifyAsync` проверяет только подпись и `exp` — никакой таблицы "использованных" или "отозванных" токенов в БД нет). Полноценная ротация с обнаружением повторного использования (reuse detection: если старый refresh-токен всплыл ПОСЛЕ того, как уже была выдана новая пара — это сигнал кражи, и тогда отзывается вся цепочка) потребовала бы хранить refresh-токены (или их хеши) в БД — как раз тот случай, где `LoginAttempt`-подобная таблица понадобилась бы уже для самих токенов, не только для OTP.

---

## 7. Logout

Логаут для JWT концептуально сложнее, чем для сессий на сервере (там можно просто удалить запись сессии из БД/Redis) — токен ведь самодостаточен, сервер не обязан "знать" о его существовании.

[`AuthController.logout`](../src/modules/auth/auth.controller.ts):

```ts
@Post('logout')
logout(@CurrentUser() user: { id: string }, @Res({ passthrough: true }) reply: FastifyReply) {
  reply.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
  this.authService.logout(user.id);
  return { success: true };
}
```

[`AuthService.logout`](../src/modules/auth/auth.service.ts):

```ts
logout(userId: string): void {
  this.logger.log(`[AUTH audit] action=logout result=success userId=${userId}`);
}
```

**Что реально происходит:** удаляется refresh-токен **из cookie браузера** — то есть клиент больше не сможет молча получить новую пару через `/auth/refresh`. Но: (1) уже выданный **access-токен** остаётся рабочим до истечения своих 15 минут — его на сервере никто не помечает недействительным; (2) если refresh-токен уже был скопирован куда-то ещё (не только в cookie этого браузера), логаут в одном месте не отзовёт его — `AuthService.logout` ничего не пишет в БД, только лог. Это прямое следствие того же самого пробела, что и в §6 — без хранилища отозванных/выданных токенов "настоящий" logout (мгновенно инвалидирующий все копии токена) для stateless JWT не сделать.

---

## 8. Password Reset & Email Verification

**В этом проекте эндпоинта password reset ("забыли пароль") нет вообще** — специально проверил (`grep -i "reset\|forgot"` по `src/` — пусто). Ниже — как он бы выглядел по аналогии с уже существующими флоу, и что в проекте есть **вместо** email verification.

**Как выглядел бы password reset** — по образцу `LoginAttempt` (§вход с подтверждением) или свежего `EmailChangeRequest` (см. `.omc/plans/user-profile-plan.md`): отдельная таблица `password_reset_requests` (`userId`, `codeHash`/`tokenHash`, `expiresAt`, `consumedAt`) → `POST /auth/password-reset` генерирует одноразовый код/токен, шлёт на email, **не выдавая наружу**, существует ли такой email в системе (иначе — та же утечка, что разобрана в конце §2) → `POST /auth/password-reset/confirm` проверяет код и заменяет `passwordHash`. Ни одной новой концепции для этого не нужно — весь строительный материал (`generateOtpCode` из [`core/otp/otp.util.ts`](../src/core/otp/otp.util.ts), `bcrypt.hash` на код, TTL/attempts-паттерн) уже есть в проекте.

**Email verification в проекте есть — но не при регистрации, а при смене email.** [`UserProfileService.initiateEmailChange`/`confirmEmailChange`](../src/modules/user-profile/user-profile.service.ts):

```ts
// код уходит на НОВЫЙ адрес — это и есть подтверждение владения им
await this.mailService.send(newEmail, 'Email change confirmation', `Your code: ${code}`);
```

```ts
const codeMatches = await bcrypt.compare(dto.code, attempt.codeHash);
// ...успех → email пользователя реально меняется только здесь, не раньше
```

Смысл верификации email всегда один: **доказать, что вы контролируете почтовый ящик**, а не просто ввели строку, похожую на email. `@IsEmail()` в DTO проверяет только *формат* ("похоже на email"); реальное владение доказывается только тем, что вы получили письмо и вернули код обратно — по-другому это не проверить.

Отдельно в проекте есть **login-подтверждение** ([`AuthService.confirmLogin`](../src/modules/auth/auth.service.ts), включается через `AuthConfirmationSetting`/`AuthConfigService`) — это концептуально ближе к 2FA ("подтверди, что это точно ты, вторым фактором"), чем к email verification, хотя механика (OTP на почту) та же самая.

---

## 9. Roles & Permissions

Три сущности вместо одного поля `role: string` на пользователе — вот почему.

[`Role`](../src/modules/rbac/entities/role.entity.ts) — просто именованная группа (`user`, `admin`):

```ts
@Entity('roles')
export class Role {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ unique: true }) name: string;
  @Column({ nullable: true }) description?: string;
}
```

[`Permission`](../src/modules/rbac/entities/permission.entity.ts) — какие действия вообще существуют над каким ресурсом (справочник, не привязан ни к одной роли):

```ts
@Entity('permissions')
export class Permission {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ unique: true }) resource: string;       // 'users', 'rbac', ...
  @Column({ type: 'text', array: true }) actions: string[];  // ['read', 'update', 'read-any', 'update-any']
}
```

[`Grant`](../src/modules/rbac/entities/grant.entity.ts) — связка "этой роли — вот это разрешение", причём **с возможностью урезать** список действий именно для этой связки:

```ts
@Entity('role_permissions')
export class Grant {
  @ManyToOne(() => Role, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'role_id' }) role: Role;
  @Column({ name: 'role_id' }) roleId: string;

  @ManyToOne(() => Permission, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'permission_id' }) permission: Permission;
  @Column({ name: 'permission_id' }) permissionId: string;

  @Column({ type: 'text', array: true, nullable: true }) actions?: string[];  // override, необязателен
}
```

Всё это стягивается в один кэш в памяти при старте ([`RbacConfigService.reload`](../src/modules/rbac/rbac-config.service.ts)):

```ts
for (const grant of grants) {
  const effectiveActions =
    grant.actions && grant.actions.length > 0
      ? grant.actions             // у гранта свой урезанный список — используем его
      : grant.permission.actions; // иначе — полный список самого permission

  // cache: Map<roleName, Map<resource, Set<action>>>
  cache.get(grant.role.name).get(grant.permission.resource).add(...effectiveActions);
}
```

Именно этот `grant.actions`-override и даёт роли `user` только `['read', 'update']` из полного `['read', 'update', 'read-any', 'update-any']` у permission `users`, а роли `admin` — все четыре (грант без override → берётся полный список permission). Один и тот же справочник permission, разный "срез" через grant.

---

## 10. RBAC

**RBAC (Role-Based Access Control)** — модель, где право получают не пользователи напрямую, а роли, а пользователь получает права через принадлежность к роли. Вопрос, на который отвечает RBAC: *"может ли роль X в принципе делать действие Y над ресурсом Z"* — общий, не про конкретную строку в таблице.

```ts
@RequirePermission('users', 'read')   // 'может ли роль этого пользователя читать users вообще'
@Get(':id')
getProfile(@Param('id') targetId: string, @CurrentUser() viewer: { id: string }) { ... }
```

**Слепая зона чистого RBAC**, реально встретившаяся в этом проекте при реализации профиля пользователя: `@RequirePermission('users', 'read')` пропустит **любого** пользователя с ролью `user` к `GET /users/:id` — но тот же самый guard физически не видит, что `:id` в URL — это чужой профиль, а не свой собственный. RBAC отвечает "роли можно читать users", но не "можно ли ИМЕННО ЭТОМУ пользователю читать ИМЕННО ЭТУ строку". Это называется object-level authorization (или IDOR-защита) — отдельный вопрос, на который чистый RBAC в принципе не отвечает, и его пришлось дописать вручную в сервисе:

```ts
// UserProfileService.getProfile
if (targetId !== viewerId) {
  const canReadAny = this.rbacConfigService.hasPermission(viewerRoles, 'users', 'read-any');
  if (!canReadAny) throw new ForbiddenException();
}
```

Итого — два слоя авторизации поверх одной модели: **грубый** (`@RequirePermission` + guard — "у роли вообще есть такое право") и **точный** (ручной вызов того же `RbacConfigService.hasPermission` внутри сервиса — "а на этот конкретный объект"). Второй слой — не новый механизм, а тот же самый сервис, вызванный вручную там, где guard не дотягивается.

---

## 11. Authorization Guards

Guard в Nest — класс с методом `canActivate(context): boolean | Promise<boolean>`: `true` — запрос идёт дальше, `false`/exception — обрывается. В converter три штуки работают на каждый запрос, зарегистрированные глобально через `APP_GUARD` (не через `@UseGuards()` на каждом контроллере — иначе легко забыть повесить на новый роут):

```ts
// AuthModule
{ provide: APP_GUARD, useClass: JwtAuthGuard }

// RbacModule
{ provide: APP_GUARD, useClass: RbacGuard }
```

Порядок регистрации совпадает с порядком выполнения: сначала `JwtAuthGuard` (заполняет `request.user`), потом `RbacGuard` (уже пользуется `request.user`). Плюс `ThrottlerModule` даёт третий `APP_GUARD` — тоже `canActivate`, но про частоту запросов, а не личность/права; тот же интерфейс используется для совсем другой задачи.

**Байпас через `@Public()`** — не "дырка", а осознанный список исключений:

```ts
// JwtAuthGuard
const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
  context.getHandler(), context.getClass(),
]);
if (isPublic) return true;
```

`/auth/register`, `/auth/login`, `/auth/login/confirm`, `/auth/refresh` помечены `@Public()` — по определению к ним нельзя прийти уже аутентифицированным (вы как раз пытаетесь получить токен). `RbacGuard`, наоборот, **не** имеет "публичного" пути по умолчанию — устроен fail-closed: нет `@RequirePermission(...)` на роуте → `403` всем без исключений (сам разработчик должен явно объявить требуемое право, иначе роут закрыт для всех, а не открыт).

---

## 12. Custom Decorators

Два разных вида кастомных декораторов в проекте — и они решают разные задачи.

**Параметр-декоратор** — достаёт значение из `request` прямо в аргумент метода контроллера, вместо `@Req() request` + `request.user` руками в каждом хендлере ([`CurrentUser`](../src/core/auth/decorators/current-user.decorator.ts)):

```ts
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): { id: string } => {
    const request = ctx.switchToHttp().getRequest<FastifyRequest & { user: { id: string } }>();
    return request.user;   // положено туда JwtAuthGuard'ом чуть раньше в цепочке
  },
);

// использование:
getProfile(@CurrentUser() viewer: { id: string }) { ... }
```

**Metadata-декоратор** — ничего не "достаёт" сам, а просто **прикрепляет ярлык** к методу/классу, который потом читает guard ([`Public`](../src/core/auth/decorators/public.decorator.ts), [`RequirePermission`](../src/core/rbac/decorators/require-permission.decorator.ts)):

```ts
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const PERMISSION_KEY = 'permission';
export const RequirePermission = (resource: string, action: string) =>
  SetMetadata(PERMISSION_KEY, { resource, action } satisfies RequiredPermission);
```

`SetMetadata` не выполняется при каждом запросе — это происходит один раз, при старте приложения (декоратор просто прикрепляет данные к классу/методу через `Reflect`). А guard читает эту метку **на каждый запрос** через `Reflector`:

```ts
const requirement = this.reflector.getAllAndOverride<RequiredPermission>(
  PERMISSION_KEY,
  [context.getHandler(), context.getClass()],   // сначала метод, потом класс — getAllAndOverride берёт первое, что найдёт
);
```

Общий паттерн, который стоит унести из этого раздела: **декоратор пишет метаданные, guard их читает через `Reflector`**. Это не два независимых механизма — `@RequirePermission('users', 'update')` без единой строчки в `RbacGuard` вообще ничего бы не делал, это просто аннотация. Вся логика — на стороне того, кто эту аннотацию потом ищет.

---

## Карта файлов converter

| Тема | Куда смотреть |
|---|---|
| Authn guard | `src/core/auth/guards/jwt-auth.guard.ts` |
| Authz guard | `src/core/rbac/guards/rbac.guard.ts` |
| Регистрация/логин/refresh/logout | `src/modules/auth/auth.controller.ts`, `auth.service.ts` |
| Password hashing | `bcrypt.hash`/`bcrypt.compare` в `auth.service.ts` |
| JWT конфигурация | `src/modules/auth/auth.module.ts`, `src/core/config/config.types.ts` |
| OTP/2FA при логине | `src/modules/auth/entities/login-attempt.entity.ts`, `otp.util.ts`, `confirmLogin` |
| Email verification (смена email) | `src/modules/user-profile/entities/email-change-request.entity.ts`, `user-profile.service.ts` |
| Roles/Permissions/Grants | `src/modules/rbac/entities/*.entity.ts` |
| RBAC кэш | `src/modules/rbac/rbac-config.service.ts` |
| Object-level authz (self/any) | `src/modules/user-profile/user-profile.service.ts` (`getProfile`, `updateProfile`) |
| Custom decorators | `src/core/auth/decorators/current-user.decorator.ts`, `src/core/auth/decorators/public.decorator.ts`, `src/core/rbac/decorators/require-permission.decorator.ts` |

---

## Порядок изучения

1. §1–3 — authn/authz на словах, регистрация, хеширование пароля (`requests/login.http` — прогнать `register`+`login` и посмотреть на `passwordHash` в БД через `psql`).
2. §4–6 — JWT целиком: включить `POSTGRES_LOGGING` не нужно, вместо этого скопировать `accessToken` из ответа `/auth/login` на [jwt.io](https://jwt.io) и посмотреть payload своими глазами.
3. §7–8 — logout и честные пробелы (нет блэклиста токенов) — важно понять ДО того, как проектировать что-то поверх, чтобы не считать текущий logout "настоящим" отзывом токена.
4. §9–10 — RBAC: сначала `RbacConfigService.reload()` построчно, потом `.omc/plans/user-profile-plan.md` целиком — там self/any-развилка разобрана подробнее, чем здесь.
5. §11–12 — guards и декораторы последними: к этому моменту уже понятно, ЧТО они проверяют (§1–10), осталось увидеть КАК это технически подключено к каждому запросу.
