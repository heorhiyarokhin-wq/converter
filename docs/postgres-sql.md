# PostgreSQL и SQL — разбор по пунктам (converter)

Практиковать в `psql` на БД из `.env` (обычно `app`). Схема: `users`, `roles`, `user_roles`, `permissions`, `role_permissions`, `login_attempts`, `auth_confirmation_settings`.

```bash
docker compose up -d
psql -h localhost -p 5432 -U postgres -d app
```

Готовые запросы без теории: [src/database/practice/postgres-sql-practice.sql](../src/database/practice/postgres-sql-practice.sql).

Документация рядом с текстом:

- [Tutorial PostgreSQL](https://www.postgresql.org/docs/current/tutorial.html)
- [То же по-русски (Postgres Pro)](https://postgrespro.ru/docs/postgresql/current/tutorial)
- Книга: [Моргунов — «Язык SQL. Базовый курс»](https://postgrespro.ru/education/books/sqlprimer)

---

## 1. Relational Databases (реляционные БД)

**Зачем:** данные лежат не «кучей JSON», а в таблицах со связями. Один факт — в одном месте; связи — через ключи, не через копирование.

PostgreSQL — реляционная СУБД: клиент (Nest / `psql`) шлёт SQL, сервер хранит таблицы на диске и отвечает строками. [Что такое PostgreSQL](https://postgrespro.ru/docs/postgresql/current/intro-whatis).

Термины (одно и то же разными словами):

| Разговорно | Теория | У вас |
|---|---|---|
| таблица | отношение (relation) | `users`, `roles` |
| строка | кортеж | один пользователь |
| колонка | атрибут | `email`, `password_hash` |

TypeORM **entity** — описание отношения на TypeScript. Postgres не знает про классы: он видит таблицу. Когда пишете `usersRepository.findOneBy({ email })`, в БД уходит `SELECT ... FROM users WHERE email = $1`.

Пример «реляционности»: роль не обязана жить внутри строки пользователя. Есть таблица `roles` и таблица связей `user_roles`. Чтобы узнать роли человека, таблицы **соединяют** (JOIN), а не хранят `"user,admin"` в одной ячейке.

---

## 2. Tables, Rows & Columns

**Таблица** — именованный набор колонок фиксированного типа. **Строка** — один набор значений по этим колонкам. **Колонка** — одно поле у всех строк.

Создание таблицы — [tutorial: Creating a New Table](https://www.postgresql.org/docs/current/tutorial-table.html) ([рус.](https://postgrespro.ru/docs/postgresql/current/tutorial-table)).

Фрагмент из миграции [`CreateRbac`](../src/database/migrations/1788300000000-CreateRbac.migration.ts):

```sql
CREATE TABLE "roles" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "name" character varying NOT NULL,
  "description" character varying,  -- можно NULL
  CONSTRAINT "UQ_roles_name" UNIQUE ("name"),
  CONSTRAINT "PK_roles" PRIMARY KEY ("id")
);
```

Как это выглядит в голове:

```
roles
+--------------------------------------+--------+---------------+
| id (PK)                              | name   | description   |
+--------------------------------------+--------+---------------+
| a1b2-...                             | user   | NULL          |
| c3d4-...                             | admin  | NULL          |
+--------------------------------------+--------+---------------+
```

Каждая строка — отдельная роль. Колонка `name` одинакова по смыслу у всех строк, значения разные. Пустая `description` — не «нет колонки», а значение `NULL` в этой ячейке.

Посмотреть колонки уже существующей таблицы:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'roles';
```

---

## 3. Data Types

Тип колонки ограничивает, **что можно записать**, и как сравнивать/индексировать. Неверный тип — ошибка на INSERT или странные сравнения (`'10' > '9'` как строки).

Обзор: [Data Types](https://www.postgresql.org/docs/current/datatype.html) — главу 8 целиком сразу не нужно.

| Тип | Смысл | Пример в converter |
|---|---|---|
| `uuid` | 128-битный id, обычно генерит БД | `users.id`, `roles.id` — [uuid](https://postgrespro.ru/docs/postgresql/current/datatype-uuid) |
| `character varying` / `varchar` | строка | `users.email`, `roles.name` |
| `boolean` | true / false (в GUI часто чекбокс `[ ]`) | `auth_confirmation_settings.required` — [boolean](https://postgrespro.ru/docs/postgresql/current/datatype-boolean) |
| `timestamp` | дата-время | `users.created_at`, `login_attempts.expires_at` |
| `text[]` | массив строк | `permissions.actions` — например `{manage}` — [arrays](https://postgrespro.ru/docs/postgresql/current/arrays) |

Примеры:

```sql
-- boolean
SELECT action, required FROM auth_confirmation_settings;

-- массив: есть ли действие manage у permission
SELECT resource, actions
FROM permissions
WHERE 'manage' = ANY (actions);

-- uuid сравнивают как обычные значения
SELECT id, email FROM users WHERE id = 'f7a20f20-833a-402e-befe-f77c7d1c6170';
```

`NULL` — не тип, а «значения нет». `description` у роли может быть `NULL`; `boolean required` у вас `NOT NULL` — пустым быть не может.

---

## 4. SELECT / INSERT / UPDATE / DELETE

Четыре базовые операции над строками (DML). В TypeORM это в основном `find` / `create`+`save` / `save` / `remove`.

Материалы: [SELECT](https://www.postgresql.org/docs/current/tutorial-select.html), [INSERT](https://www.postgresql.org/docs/current/tutorial-populate.html), reference: [INSERT](https://www.postgresql.org/docs/current/sql-insert.html), [UPDATE](https://www.postgresql.org/docs/current/sql-update.html), [DELETE](https://www.postgresql.org/docs/current/sql-delete.html).

**SELECT** — прочитать, БД не меняет.

```sql
SELECT id, email FROM users;
SELECT * FROM roles;   -- все колонки; в проде лучше перечислять поля
```

**INSERT** — новая строка. `DEFAULT` подставит uuid / `now()`, если так задано в таблице.

```sql
INSERT INTO roles (name, description)
VALUES ('moderator', 'can edit grants')
RETURNING id, name;
```

Сид в миграции — тот же INSERT:

```sql
INSERT INTO roles (name) VALUES ('user'), ('admin');
```

**UPDATE** — изменить уже существующие строки. Без `WHERE` обновятся **все** — почти всегда ошибка.

```sql
UPDATE auth_confirmation_settings
SET required = true
WHERE action = 'login';
```

Это то, что делает admin API настроек, затем `authConfigService.reload()`.

**DELETE** — удалить строки. Снова обязателен `WHERE`. FK с `ON DELETE CASCADE` может снести связанные строки (например `user_roles` при удалении user).

```sql
DELETE FROM login_attempts
WHERE consumed_at IS NOT NULL
  AND expires_at < now();
```

Включите `POSTGRES_LOGGING=true` и сделайте login: в логе Nest увидите те же `SELECT` / `INSERT`.

---

## 5. WHERE, ORDER BY, GROUP BY

Это не отдельные команды, а **части SELECT** (WHERE ещё и у UPDATE/DELETE).

Источник: [tutorial-select](https://www.postgresql.org/docs/current/tutorial-select.html), агрегаты: [tutorial-agg](https://www.postgresql.org/docs/current/tutorial-agg.html).

**WHERE** — какие строки брать. Условие истинно → строка в результате.

```sql
SELECT email FROM users
WHERE email = 'test@test.com';

SELECT * FROM login_attempts
WHERE consumed_at IS NULL
  AND expires_at > now();
```

`AND` / `OR` / `NOT`. Сравнение с `NULL` только через `IS NULL` / `IS NOT NULL`, не `= NULL`.

**ORDER BY** — порядок вывода, не порядок хранения.

```sql
SELECT email, created_at
FROM users
ORDER BY created_at DESC
LIMIT 10;
```

**GROUP BY** — схлопнуть строки в группы и посчитать. Колонки в SELECT либо в GROUP BY, либо внутри `COUNT`/`SUM`/`MAX`.

```sql
SELECT user_id, COUNT(*) AS attempt_count
FROM login_attempts
GROUP BY user_id
ORDER BY attempt_count DESC;
```

Смысл: «по каждому пользователю — сколько у него строк в `login_attempts`». Без GROUP BY `COUNT(*)` дал бы одно число на всю таблицу.

`HAVING` фильтрует **уже группы** (после агрегата), `WHERE` — сырые строки **до** группировки.

```sql
SELECT user_id, COUNT(*) AS n
FROM login_attempts
GROUP BY user_id
HAVING COUNT(*) > 3;
```

---

## 6. JOINs

JOIN склеивает строки **разных таблиц** по условию (обычно равенство ключей). [Joins Between Tables](https://www.postgresql.org/docs/current/tutorial-join.html).

В converter роли не лежат в `users`. Чтобы получить «email + имя роли», нужны три таблицы:

```sql
SELECT u.email, r.name AS role_name
FROM users u
JOIN user_roles ur ON ur.user_id = u.id
JOIN roles r ON r.id = ur.role_id;
```

Как читается: возьми пользователя → найди его строки в `user_roles` → по `role_id` подтяни `roles`. Это то же, что TypeORM делает при `relations: ['roles']`.

Если у человека две роли, в результате **две строки** с одним email — это нормально для JOIN, не «дубль пользователя в БД».

**INNER JOIN** (просто `JOIN`): пара попадает в результат, только если совпадение есть с обеих сторон. Пользователь без записи в `user_roles` **не** появится.

**LEFT JOIN**: все строки левой таблицы остаются; если справа нет пары — колонки справа `NULL`.

```sql
SELECT u.email, ur.role_id
FROM users u
LEFT JOIN user_roles ur ON ur.user_id = u.id
WHERE ur.user_id IS NULL;
```

Этот запрос ищет пользователей без роли. После нормального `register` (`createUser` вешает роль `user`) список должен быть пустой.

**CROSS JOIN** — все комбинации без условия; для RBAC почти не нужен.

---

## 7. Primary & Foreign Keys

**Primary key (PK)** — уникальный идентификатор строки. Одна таблица — один PK (иногда составной). У `roles` это `id`. У `user_roles` PK из двух колонок `(user_id, role_id)`: одна и та же пара user+role не может повториться.

**Foreign key (FK)** — колонка (или набор), которая **ссылается** на PK другой таблицы. Postgres не даст вставить `user_roles.user_id`, которого нет в `users`.

Глава: [Constraints](https://www.postgresql.org/docs/current/ddl-constraints.html).

```
users.id  <──── user_roles.user_id   (FK_user_roles_user)
roles.id  <──── user_roles.role_id   (FK_user_roles_role)
```

В миграции:

```sql
CONSTRAINT "FK_user_roles_user" FOREIGN KEY ("user_id")
  REFERENCES "users"("id") ON DELETE CASCADE
```

`ON DELETE CASCADE`: удалили пользователя → Postgres сам удалит его строки в `user_roles`. Без CASCADE удаление user при живых связях упало бы с ошибкой FK.

Проверка:

```sql
-- упадёт: нет такого user_id
INSERT INTO user_roles (user_id, role_id)
VALUES ('00000000-0000-0000-0000-000000000000',
        (SELECT id FROM roles WHERE name = 'user'));
```

---

## 8. Constraints (ограничения)

Правила целостности **на стороне БД**, не только в Nest. Даже сырой SQL или гонка двух register не обойдёт UNIQUE.

Та же глава [ddl-constraints](https://www.postgresql.org/docs/current/ddl-constraints.html).

| Вид | Что запрещает | Пример у вас |
|---|---|---|
| `NOT NULL` | пустую ячейку | `roles.name`, `users.email` |
| `UNIQUE` | две одинаковые значения | `UQ_roles_name`, unique `email`, unique `action` в settings |
| `PRIMARY KEY` | и UNIQUE, и NOT NULL | `roles.id` |
| `CHECK` | любое условие | в текущих миграциях почти не используется |
| `FOREIGN KEY` | «сироту» без родителя | см. пункт 7 |

Индекс `CREATE UNIQUE INDEX ... ON users (lower(email))` — тоже ограничение уникальности, но по **выражению**: `Admin@x.com` и `admin@x.com` не уживутся вместе.

Когда INSERT/UPDATE нарушает UNIQUE, Postgres кидает ошибку с кодом **`23505`**. Именно её ловит `isUniqueViolation` в `AuthService` и превращает в HTTP 409 «Email already registered» при гонке двух регистраций.

```sql
-- второй раз тот же name → ошибка unique
INSERT INTO roles (name) VALUES ('user');
```

Приложение может проверить `findByEmail` заранее; constraint — последний рубеж, когда два запроса одновременно прошли проверку.

---

## 9. Transactions & ACID

**Транзакция** — пачка SQL как один шаг: либо все изменения видны, либо ни одного. [Tutorial: Transactions](https://www.postgresql.org/docs/current/tutorial-transactions.html).

```sql
BEGIN;
UPDATE auth_confirmation_settings SET required = true WHERE action = 'login';
-- другая сессия psql пока не видит true
COMMIT;    -- теперь видно
-- или ROLLBACK; — как будто UPDATE не было
```

Без `BEGIN` каждый запрос — своя крошечная транзакция (сам себе BEGIN+COMMIT).

**ACID** (имена на память, не зубрёжка):

| Буква | Смысл на примере register |
|---|---|
| **A**tomicity | INSERT `users` и INSERT `user_roles` вместе. Упал второй — первого тоже нет |
| **C**onsistency | после COMMIT ограничения (UNIQUE, FK) выполнены |
| **I**solation | чужой логин не видит «полусозданного» пользователя |
| **D**urability | после COMMIT данные на диске, рестарт Postgres их не съест |

В коде это `@Transactional()` в [`users.service.ts`](../src/modules/users/users.service.ts): `createUser` пишет user и связь с ролью в одной транзакции. Уровни изоляции (`READ COMMITTED` и т.д.) в первую неделю можно не копать — достаточно модели «всё или ничего».

---

## 10. Database Relationships

Как сущности ссылаются друг на друга. JOIN — способ **прочитать** связь; FK — способ её **защитить**.

**1:N (один ко многим).** Одна роль — много grants. Одна строка `roles`, много строк `role_permissions` с одним `role_id`. Один user — много `login_attempts`.

```sql
SELECT r.name, rp.id AS grant_id
FROM roles r
JOIN role_permissions rp ON rp.role_id = r.id
WHERE r.name = 'admin';
```

**N:M (многие ко многим).** У пользователя несколько ролей, у роли несколько пользователей. Прямой FK из `users` в `roles` этого не выразит (одна колонка = одна роль). Нужна таблица-связка `user_roles`.

В TypeORM это [`@ManyToMany` + `@JoinTable`](../src/modules/users/entities/user.entity.ts) с именем таблицы `user_roles`.

**1:1** у вас почти нет (было бы, например, `user_profiles` с PK = `user_id`).

Карта converter:

```
users 1──N login_attempts
users N──M roles          (через user_roles)
roles 1──N role_permissions (Grant)
permissions 1──N role_permissions
```

---

## 11. Normalization (нормализация)

Цель: не дублировать факты и не смешивать разные смыслы в одной таблице. Для разработки обычно хватает **1NF–3NF**. Статья: [Нормализация глазами разработчика](https://proselyte.net/db-normalization-for-devs/); формулы до 3NF: [Хабр](https://habr.com/ru/articles/254773/).

**1NF.** В ячейке одно значение, не список. Плохо: колонка `roles = 'user,admin'`. У вас сначала был enum — одно значение, формально 1NF, но **нельзя две роли** без смены типа.

**2NF.** Имеет смысл при составном ключе: поле не должно зависеть только от части ключа. У `users` ключ один (`id`), `email` зависит от всего ключа — ок.

**3NF.** Неключевые поля не зависят друг от друга транзитивно. «Справочник ролей» не должен быть зашит в строку пользователя как копия имени, если имя — отдельная сущность.

**Как было** ([CreateUsers](../src/database/migrations/1787841224258-CreateUsers.migration.ts)):

```sql
-- упрощённо
users (id, email, password_hash, role enum 'user'|'admin')
```

Чтобы добавить роль `moderator`, нужна миграция enum. У пользователя не может быть `user` и `admin` сразу.

**Как стало** (CreateRbac):

```sql
roles (id, name, description)          -- справочник
user_roles (user_id, role_id)          -- факт: этому user выдана эта роль
-- колонка users.role удалена
```

Аномалии, которые ушли:

- смена названия роли не требует UPDATE всех users;
- вторая роль — INSERT в `user_roles`, не ALTER TYPE;
- «какие роли бывают» живёт в `roles`, а не в коде enum.

Нормализация не бесплатна: читать роли нужно JOIN (или `relations`). Для RBAC это правильная цена.

---

## 12. Indexes (индексы)

Индекс — отдельная структура (обычно B-tree), чтобы **не сканировать всю таблицу** при поиске по колонке. [Глава 11](https://postgrespro.ru/docs/postgresql/current/indexes), [лекция PDF](https://edu.postgrespro.ru/sqlprimer/sqlprimer-2018-msu-06.pdf).

Аналогия: оглавление книги. `WHERE email = '...'` без индекса — листать все страницы (`Seq Scan`). С индексом — прыжок к нужной строке (`Index Scan`).

Минус: каждый INSERT/UPDATE по индексируемой колонке чуть дороже — индекс тоже обновляют. Поэтому не индексируют «на всякий случай» все поля.

UNIQUE и PRIMARY KEY **сами создают** уникальный индекс.

У `users` два разных индекса на почту:

1. `UNIQUE (email)` — точное совпадение колонки. Login после DTO (`trim` + `toLowerCase`) ищет `WHERE email = $1` — этот путь.
2. `UQ_users_email_lower ON (lower(email))` — уникальность без учёта регистра на уровне БД, если кто-то вставит SQL в обход DTO.

Посмотреть:

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'users';
```

Expression-индекс срабатывает, только если в запросе **то же выражение**:

```sql
-- может использовать UQ_users_email_lower
SELECT id FROM users WHERE lower(email) = 'test@test.com';

-- использует индекс по самой колонке email, не lower()
SELECT id FROM users WHERE email = 'test@test.com';
```

Аналогично `UQ_roles_name_lower` на `lower(name)`.

---

## 13. Query Optimization

Оптимизация здесь — не «переписать SQL красивее», а понять, **какой план выбрал Postgres** и помогает ли индекс.

Инструмент: [EXPLAIN](https://www.postgresql.org/docs/current/using-explain.html). Практика по WHERE/JOIN: [Use The Index, Luke](https://use-the-index-luke.com/).

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, email
FROM users
WHERE email = 'test@test.com';
```

`EXPLAIN` — план без выполнения. `ANALYZE` — ещё и реальное время (на SELECT безопасно; на UPDATE/DELETE выполнит изменение).

На что смотреть в выводе:

| Узел | Обычно значит |
|---|---|
| `Seq Scan` | полный проход по таблице. На 10 строках ок, на миллионе — подозрительно для точечного WHERE |
| `Index Scan` / `Index Only Scan` | пошли по индексу — для поиска по email это ожидаемо |
| огромный `cost` / `actual time` | кандидат на индекс или на переписанный JOIN |

Подставьте email, который **есть** в вашей таблице. На крошечной БД Seq Scan и Index Scan оба мгновенные — смысл EXPLAIN виден, когда данных больше.

Типичные рычаги: индекс под WHERE/JOIN-колонку, не тащить `SELECT *`, не делать N+1 (цикл в JS + запрос на каждую строку вместо одного JOIN). TypeORM `relations: ['roles']` — как раз один (или два) SQL вместо цикла.

---

## Порядок чтения (две недели)

1. Пункты 1–4 + tutorial ch.1–2, потыкать SELECT/INSERT в psql
2. Пункты 5–8 на `users` / `roles` / `user_roles`
3. Пункт 9 и `@Transactional()` в `createUser`
4. Пункты 12–13: `EXPLAIN` на `email` и `lower(email)`
5. Пункты 10–11: связи и нормализация ролей

Интерактивно (только SELECT/JOIN, не специфика Postgres): [SQLBolt](https://sqlbolt.com/), [pgexercises](https://pgexercises.com/).

Официальный tutorial тем же порядком: [concepts](https://www.postgresql.org/docs/current/tutorial-concepts.html) → [table](https://www.postgresql.org/docs/current/tutorial-table.html) → [populate](https://www.postgresql.org/docs/current/tutorial-populate.html) → [select](https://www.postgresql.org/docs/current/tutorial-select.html) → [join](https://www.postgresql.org/docs/current/tutorial-join.html) → [transactions](https://www.postgresql.org/docs/current/tutorial-transactions.html). Схему `weather`/`cities` из учебника можно не создавать — те же идеи уже разобраны выше на converter.
