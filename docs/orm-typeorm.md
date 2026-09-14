# ORM и TypeORM — разбор по пунктам (converter)

Рядом с SQL-треком: [docs/postgres-sql.md](postgres-sql.md). Там таблицы и JOIN глазами Postgres. Здесь — как Nest **переводит объекты TypeScript в тот же SQL**.

В проекте ORM — **TypeORM 0.3** + `@nestjs/typeorm`. Prisma в репозитории нет; в конце — чем она отличается, без призыва всё переписывать.

Включить лог SQL: `POSTGRES_LOGGING=true` в `.env`, перезапустить `npm run start:dev`. Каждый `find`/`save` будет виден как настоящий `SELECT`/`INSERT`.

Документация TypeORM: [Entities](https://typeorm.io/entities), [Relations](https://typeorm.io/relations), [Repository](https://typeorm.io/repository-api), [Migrations](https://typeorm.io/migrations), [Query Builder](https://typeorm.io/select-query-builder). Nest: [Database TypeORM](https://docs.nestjs.com/techniques/database).

---

## 1. ORM Concepts — что это и зачем

**ORM (Object-Relational Mapping)** — слой между классами в коде и таблицами в Postgres.

Без ORM вы пишете SQL руками, сами раскладываете строки в объекты:

```ts
const { rows } = await pool.query(
  'SELECT id, email FROM users WHERE email = $1',
  [email],
);
const user = rows[0]; // { id, email } — уже не класс User
```

С ORM вы описываете класс `User` и вызываете:

```ts
await this.usersRepository.findOneBy({ email });
```

TypeORM строит SQL, шлёт его в Postgres, ответ превращает в экземпляр `User` (`id`, `email`, `passwordHash`, …).

**Зачем:** меньше копипасты SQL в сервисах, типы TypeScript на полях, связи (`roles`) объявлены один раз, миграции можно генерировать из разницы entity ↔ БД.

**Чего ORM не делает:** не заменяет понимание SQL, индексов, транзакций. Плохой `find` в цикле — всё равно N+1 запросов. Схема в проде у вас **не** создаётся сама (`synchronize: false`) — только миграции.

Стек converter:

```
AuthService / UsersService / RbacConfigService
        ↓  Repository<User>, Repository<Role>, …
     TypeORM
        ↓  SQL
     PostgreSQL
```

Подключение: [`DatabaseModule`](../src/core/database/database.module.ts) — `TypeOrmModule.forRootAsync` (хост, пароль, glob `*.entity.ts`). CLI миграций — отдельный [`data-source.ts`](../src/database/data-source.ts) **без** бута Nest. Опции (host, entities, migrations) должны совпадать.

---

## 2. Entities / Models

**Entity** — класс, который TypeORM считает таблицей. В Prisma это `model` в `schema.prisma`. У вас файлы `*.entity.ts`.

[`Role`](../src/modules/rbac/entities/role.entity.ts) — самый простой пример:

```ts
@Entity('roles')
export class Role {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string;

  @Column({ nullable: true })
  description?: string;
}
```

| Декоратор | Смысл | SQL |
|---|---|---|
| `@Entity('roles')` | таблица называется `roles` | `CREATE TABLE "roles"` |
| `@PrimaryGeneratedColumn('uuid')` | PK, значение даёт Postgres | `uuid DEFAULT uuid_generate_v4()` |
| `@Column({ unique: true })` | обычная колонка + UNIQUE | `"name" ... UNIQUE` |
| `@Column({ nullable: true })` | можно `NULL` | `"description" character varying` |

Имя поля в TS и колонки в БД могут **различаться**:

```ts
class User {
  @Column({ name: 'password_hash' })
  passwordHash: string;
}
```

В коде `user.passwordHash`, в SQL — `"password_hash"`.

`@CreateDateColumn` / `@UpdateDateColumn` — Nest/TypeORM сами ставят timestamps (`created_at` / `updated_at` у `User`).

Entity **не создаёт** таблицу при старте приложения, пока `POSTGRES_SYNCHRONIZE=false`. Сначала миграция, класс — контракт для запросов.

Nest подхватывает любой `*.entity.ts` под `src/` (`autoLoadEntities` + glob). В модуле всё равно нужен `forFeature`, чтобы получить `Repository`.

Не путать с **DTO** (`LoginDto`, `RegisterDto`): DTO — вход HTTP и валидация. Entity — строка БД. Пароль в DTO → в entity уже `passwordHash`.

---

## 3. Repositories

**Repository** — объект «все операции над одной entity»: найти, сохранить, удалить. Не путать с паттерном DDD «repository как порт»; здесь это API TypeORM.

Подключение в [`UsersModule`](../src/modules/users/users.module.ts):

```ts
TypeOrmModule.forFeature([User, Role])
```

Дальше в сервисе:

```ts
class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(Role)
    private readonly rolesRepository: Repository<Role>,
  ) {}
}
```

`forRoot` — одно соединение на приложение. `forFeature` — «в этом модуле можно инжектить эти репозитории». Без `forFeature([Role])` `@InjectRepository(Role)` в `UsersService` не соберётся.

Частые методы у вас:

| Вызов | Типичный SQL | Когда |
|---|---|---|
| `find()` | `SELECT * FROM …` | список ролей, grants |
| `findOneBy({ email })` | `WHERE email = $1` | login, register |
| `findOne({ where, relations })` | SELECT + JOIN / второй запрос | user с ролями |
| `findOneByOrFail({ name: 'user' })` | то же + ошибка, если нет строки | сид роли обязателен |
| `create({ … })` | **нет SQL** | объект в памяти |
| `save(entity)` | `INSERT` или `UPDATE` | запись |
| `remove(entity)` | `DELETE` | удаление роли без grants |
| `count({ where })` | `SELECT COUNT` | нельзя удалить роль с grants |

Критично: **`create` ≠ запись в БД.** Только собирает экземпляр. Пишет `save`.

```ts
const user = this.usersRepository.create({
  email,
  passwordHash,
  roles: [defaultRole],
});
return this.usersRepository.save(user); // вот здесь INSERT
```

`save` смотрит, есть ли PK в БД: нет `id` / новый объект → INSERT; загруженный и изменённый → UPDATE.

---

## 4. Relations

Связь в ORM = как в SQL JOIN/FK, но объявлена на полях класса.

### Many-to-many: User ↔ Role

[`User`](../src/modules/users/entities/user.entity.ts):

```ts
class User {
  @ManyToMany(() => Role)
  @JoinTable({
    name: 'user_roles',
    joinColumn: { name: 'user_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'role_id', referencedColumnName: 'id' },
  })
  roles: Role[];
}
```

`@JoinTable` говорит: таблица-связка `user_roles`, колонки `user_id` / `role_id`. Владелец связи — `User` (JoinTable на его стороне). У `Role` обратного `@ManyToMany` нет — не обязательно для работы.

SQL тот же, что в [postgres-sql.md](postgres-sql.md) про JOIN:

```sql
SELECT u.email, r.name
FROM users u
JOIN user_roles ur ON ur.user_id = u.id
JOIN roles r ON r.id = ur.role_id;
```

### Many-to-one: Grant → Role, Grant → Permission

[`Grant`](../src/modules/rbac/entities/grant.entity.ts):

```ts
class Grant {
  @ManyToOne(() => Role, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'role_id' })
  role: Role;

  @Column({ name: 'role_id' })
  roleId: string;
}
```

Два поля на одну колонку: `roleId` — uuid для фильтров (`where: { roleId }`), `role` — объект, если загрузили relation. `onDelete: 'CASCADE'` в entity согласован с FK в миграции (удалили роль — grants тоже). В API вы всё равно часто запрещаете удаление через `count`, если grants есть.

`()` => `Role` в декораторе — функция, чтобы избежать циклических импортов файлов.

Связи **не подгружаются сами** (eager у вас не стоит). Без `relations` поле `user.roles` будет `undefined`, даже если в `user_roles` есть строки.

---

## 5. Queries (запросы через Repository)

«Query» здесь — не сырой SQL, а методы репозитория, которые SQL генерируют.

Точечный поиск:

```ts
this.usersRepository.findOneBy({ email: dto.email });
```

≈ `SELECT … FROM users WHERE email = $1 LIMIT 1`. Нет строки → `null` (не exception).

С условием и связями:

```ts
this.usersRepository.findOne({
  where: { id },
  relations: ['roles'],
});
```

TypeORM сделает JOIN или отдельный SELECT по `user_roles`+`roles`. В логе увидите один или два запроса — зависит от версии/настроек, но роли в объекте появятся.

Список с вложенными объектами (кеш RBAC):

```ts
this.grantsRepository.find({
  relations: ['role', 'permission'],
});
```

Каждый `Grant` придёт с `grant.role.name` и `grant.permission.resource` — иначе в `reload()` не из чего собрать Map.

`findOneByOrFail` — нет строки → `EntityNotFoundError`. Регистрация без сида роли `user` должна упасть явно.

Фильтр «ещё не подтверждённый OTP» (идея, как в auth): `consumedAt: IsNull()` → `WHERE consumed_at IS NULL`.

Писать `SELECT` руками в сервисах у вас почти не нужно — пока хватает `where` / `relations` / `order`.

---

## 6. Transactions

Несколько SQL как одно «всё или ничего». В SQL это `BEGIN`/`COMMIT`. В converter — `@Transactional()` из `typeorm-transactional`.

[`createUser`](../src/modules/users/users.service.ts):

```ts
@Transactional()
async createUser(...) {
  const defaultRole = await this.rolesRepository.findOneByOrFail({ name: 'user' });
  const user = this.usersRepository.create({ ...data, roles: [defaultRole] });
  return this.usersRepository.save(user);
}
```

`save` с `roles: [defaultRole]` даёт как минимум:

1. `INSERT INTO users …`
2. `INSERT INTO user_roles (user_id, role_id) …`

Без транзакции: users вставился, `user_roles` упал → человек в БД **без роли**. С декоратором оба шага в одном `BEGIN`…`COMMIT`; ошибка → `ROLLBACK`.

Чтобы это работало, в [`main.ts`](../src/main.ts) вызывается `initializeTransactionalContext`, а DataSource оборачивается в `addTransactionalDataSource` в `DatabaseModule`. Иначе декоратор не к чему привязать.

Обычный TypeORM-вариант без библиотеки:

```ts
await this.dataSource.transaction(async (manager) => {
  await manager.getRepository(User).save(user);
});
```

`@Transactional()` удобнее, когда транзакция пересекает несколько сервисов в одном запросе.

---

## 7. Query Builder

**Query Builder (QB)** — цепочка методов, которая собирает SQL явнее, чем `find({ where })`. Нужен для JOIN с условием, `EXISTS`, агрегатов, `lower(email)`, кусков, которые Repository API плохо выражает.

В этом репозитории **QB пока не используется** — CRUD закрыт `find`/`save`. Эквивалент `findByEmail`:

```ts
await this.usersRepository
  .createQueryBuilder('u')
  .where('u.email = :email', { email })
  .getOne();
```

Пользователь с ролями:

```ts
await this.usersRepository
  .createQueryBuilder('u')
  .leftJoinAndSelect('u.roles', 'r')
  .where('u.id = :id', { id })
  .getOne();
```

`leftJoinAndSelect` ≈ LEFT JOIN + колонки роли в результате (как `relations: ['roles']`).

Сырой SQL, когда QB уже тесен:

```ts
await this.usersRepository.query(
  'SELECT id FROM users WHERE lower(email) = lower($1)',
  [email],
);
```

Так вы обходите маппинг entity; типы и relations сами не появятся. Имеет смысл для отчётов и `EXPLAIN`.

Правило: простой CRUD — Repository; сложный SELECT — QB; разовый отчёт / кусок, который генерится криво — `query()`.

---

## 8. N+1 Problem

**N+1** — один запрос за списком, потом ещё по одному на каждую строку.

Плохо (такого цикла у вас в auth нет, но это классика):

```ts
const users = await this.usersRepository.find(); // 1 запрос
for (const u of users) {
  const full = await this.usersRepository.findOne({
    where: { id: u.id },
    relations: ['roles'],
  }); // ещё N запросов
}
```

100 пользователей → 101 SQL. На мелкой таблице незаметно, под нагрузкой — тормоза.

Хорошо: один (или два) запроса со связями:

```ts
await this.usersRepository.find({ relations: ['roles'] });
```

Или JOIN через Query Builder.

Где это уже учтено:

- `findById` с `relations: ['roles']` — JWT/RBAC получают роли сразу.
- `RbacConfigService.reload` — все grants одним `find({ relations: ['role', 'permission'] })`, не grant-за-grant.

Где запас N+1 остаётся: **два** `findById` на один HTTP (JwtAuthGuard и RbacGuard). Это не классический N+1 по списку, но лишний повторный SELECT того же user. Лечится, если JWT-guard положит `user` с ролями в `request` и RBAC не будет искать снова.

Как ловить: `POSTGRES_LOGGING=true` и один запрос к `/admin/rbac/roles` — если в логе пачка одинаковых `SELECT` в цикле, это N+1.

---

## 9. Migrations

**Миграция** — версионированный SQL: «как из схемы A получить схему B». Файлы в [`src/database/migrations/`](../src/database/migrations/), имя `*.migration.ts` (не просто `*.ts` — так задан glob).

Почему не `synchronize: true`: auto-sync на проде может дропнуть колонку. У вас synchronize по умолчанию выключен; схема едет только миграциями. `POSTGRES_MIGRATIONS_RUN=true` прогоняет pending при старте **Nest**, не при CLI.

Два DataSource:

| | Nest runtime | CLI (`npm run migration:*`) |
|---|---|---|
| файл | `database.module.ts` | `data-source.ts` |
| env | `ConfigService` | `dotenv` + `process.env` |

Команды:

```bash
npm run migration:show      # что применено / ждёт
npm run migration:generate  # diff entity vs живая БД → черновик SQL
npm run migration:run       # применить pending
npm run migration:revert    # откатить последнюю
```

`generate` смотрит CLI DataSource. Сгенерированный SQL всегда ревьюить: TypeORM любит лишние DROP/CREATE.

Пример эволюции: [`CreateUsers`](../src/database/migrations/1787841224258-CreateUsers.migration.ts) создаёт `users` с колонкой `role` enum. [`CreateRbac`](../src/database/migrations/1788300000000-CreateRbac.migration.ts) создаёт `roles` / `user_roles`, копирует enum в связку, дропает колонку. Entity `User` сейчас уже без `role` — истина для кода; истина для пустой БД — прогон всех миграций по порядку.

Таблица `migrations` в Postgres помнит, какие файлы уже `up`.

---

## 10. Seed Data

**Сид** — стартовые **данные**, не структура. «После пустой БД сразу есть роль `user`, иначе register упадёт на `findOneByOrFail`».

У вас сиды **внутри миграций**, отдельного `npm run seed` нет.

CreateRbac:

```sql
INSERT INTO "roles" ("name") VALUES ('user'), ('admin');
INSERT INTO "permissions" ("resource", "actions")
  VALUES ('rbac', ARRAY['manage']);
-- grant rbac@manage роли admin
-- существующим users проставить user_roles из старого enum
```

Auth settings:

```sql
INSERT INTO "auth_confirmation_settings" ("action", "required")
VALUES ('login', false);
```

Это не пользовательский API и не «рандом». Это известные строки, без которых приложение не консистентно.

Минус смешения сида с миграцией: поменять дефолт `login.required` уже на живой БД миграция сама не сделает (строка уже есть, `ON CONFLICT DO NOTHING`). Тогда UPDATE руками или admin API + `reload()`.

---

## TypeORM и Prisma (зачем в списке Tools)

Оба — ORM для Postgres. Converter уже на TypeORM; менять стек «чтобы было Prisma» незачем.

| | TypeORM (у вас) | Prisma |
|---|---|---|
| Откуда схема | декораторы на классах | файл `schema.prisma` |
| Клиент | `Repository<User>` | сгенерированный `prisma.user.findUnique` |
| Миграции | `migration:generate` из entity | `prisma migrate` из schema |
| Связи | `@ManyToMany` / `@JoinTable` | `User` / `Role` + implicit/explicit M2M |
| Nest | `@nestjs/typeorm` | обычно `PrismaService` |

Идея та же: объекты ↔ таблицы. Синтаксис и CLI разные. Поняв Repository + entity + миграции здесь, Prisma читается как другой диалект того же.

---

## Карта файлов converter

| Тема | Куда смотреть |
|---|---|
| Подключение | `src/core/database/database.module.ts` |
| CLI | `src/database/data-source.ts` |
| Простой entity | `src/modules/rbac/entities/role.entity.ts` |
| M2M + JoinTable | `src/modules/users/entities/user.entity.ts` |
| M2O + roleId | `src/modules/rbac/entities/grant.entity.ts` |
| Repository CRUD | `src/modules/users/users.service.ts`, RBAC services |
| relations | `findById`, `RbacConfigService.reload` |
| Транзакция | `createUser` + `@Transactional()` |
| Миграции + сид | `src/database/migrations/*.migration.ts` |

---

## Порядок изучения

1. Зачем ORM (этот файл, п. 1) и SQL-трек п. 4–6 — один `findOneBy` глазами лога.
2. Entity `Role` → `User` → `Grant` (колонки, потом связи).
3. `forFeature` + методы репозитория; `create` vs `save`.
4. `relations` и N+1; включить logging.
5. `@Transactional()` на register.
6. Прочитать одну миграцию целиком (CreateRbac) как SQL-истину + сиды.
7. Query Builder — когда появится запрос сложнее `find`.

Официальные главы TypeORM лучше читать **после** того, как сопоставите декоратор с строкой миграции: так ORM перестаёт быть магией и становится генератором SQL, который вы уже понимаете.
