-- Practice SQL for docs/postgres-sql.md
-- psql -h localhost -p 5432 -U postgres -d app
-- Run blocks one at a time. Prefer SELECT / EXPLAIN; wrap writes in ROLLBACK.

-- =============================================================================
-- Tutorial follow-up: SELECT / WHERE / ORDER BY / GROUP BY
-- =============================================================================

SELECT id, email, created_at
FROM users
ORDER BY created_at DESC
LIMIT 10;

SELECT action, required
FROM auth_confirmation_settings
WHERE action = 'login';

SELECT user_id, COUNT(*) AS attempt_count
FROM login_attempts
GROUP BY user_id
ORDER BY attempt_count DESC;

-- =============================================================================
-- JOINs + PK/FK  (users N:M roles via user_roles)
-- =============================================================================

-- Inner join: who has which role (TypeORM relations: ['roles'])
SELECT u.id, u.email, r.name AS role_name
FROM users u
JOIN user_roles ur ON ur.user_id = u.id
JOIN roles r ON r.id = ur.role_id
ORDER BY u.email, r.name;

-- Left join: users with no row in user_roles (should be rare after register)
SELECT u.email, ur.role_id
FROM users u
LEFT JOIN user_roles ur ON ur.user_id = u.id
WHERE ur.user_id IS NULL;

-- Role -> grants -> permissions (1:N then N:1)
SELECT r.name AS role_name, p.resource, COALESCE(rp.actions, p.actions) AS actions
FROM roles r
JOIN role_permissions rp ON rp.role_id = r.id
JOIN permissions p ON p.id = rp.permission_id
ORDER BY r.name, p.resource;

-- Inspect PK / FK (information_schema)
SELECT
  tc.constraint_name,
  tc.constraint_type,
  tc.table_name
FROM information_schema.table_constraints tc
WHERE tc.table_schema = 'public'
  AND tc.table_name IN ('users', 'roles', 'user_roles', 'role_permissions')
ORDER BY tc.table_name, tc.constraint_type, tc.constraint_name;

-- =============================================================================
-- Transactions (try in one session; open a second psql to see isolation)
-- =============================================================================

BEGIN;
UPDATE auth_confirmation_settings
SET required = required
WHERE action = 'login';
-- COMMIT;
ROLLBACK;

-- =============================================================================
-- Indexes + EXPLAIN vs lower(email)
-- =============================================================================

SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'users'
ORDER BY indexname;

-- Exact email: unique constraint on email (DTO already lowercases on register/login)
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, email
FROM users
WHERE email = 'test@test.com';

-- Expression index UQ_users_email_lower — predicate must use lower(email)
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, email
FROM users
WHERE lower(email) = 'test@test.com';

-- Same idea on roles
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, name
FROM roles
WHERE lower(name) = 'admin';

-- Expect Index Scan / Index Only Scan on UQ_* or unique constraint,
-- not Seq Scan once the table is non-trivial.
