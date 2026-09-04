import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRbac1788300000000 implements MigrationInterface {
  name = 'CreateRbac1788300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "roles" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying NOT NULL,
        "description" character varying,
        CONSTRAINT "UQ_roles_name" UNIQUE ("name"),
        CONSTRAINT "PK_roles" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "permissions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "resource" character varying NOT NULL,
        "actions" text[] NOT NULL,
        CONSTRAINT "UQ_permissions_resource" UNIQUE ("resource"),
        CONSTRAINT "PK_permissions" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "role_permissions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "role_id" uuid NOT NULL,
        "permission_id" uuid NOT NULL,
        "actions" text[],
        CONSTRAINT "PK_role_permissions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_role_permissions_role" FOREIGN KEY ("role_id")
          REFERENCES "roles"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_role_permissions_permission" FOREIGN KEY ("permission_id")
          REFERENCES "permissions"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "user_roles" (
        "user_id" uuid NOT NULL,
        "role_id" uuid NOT NULL,
        CONSTRAINT "PK_user_roles" PRIMARY KEY ("user_id", "role_id"),
        CONSTRAINT "FK_user_roles_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_user_roles_role" FOREIGN KEY ("role_id")
          REFERENCES "roles"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_roles_name_lower" ON "roles" (lower("name"))`,
    );

    await queryRunner.query(`
      INSERT INTO "roles" ("name") VALUES ('user'), ('admin')
      ON CONFLICT ("name") DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "permissions" ("resource", "actions")
      VALUES ('rbac', ARRAY['manage'])
      ON CONFLICT ("resource") DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id", "permission_id")
      SELECT r."id", p."id"
      FROM "roles" r, "permissions" p
      WHERE r."name" = 'admin' AND p."resource" = 'rbac'
        AND NOT EXISTS (
          SELECT 1 FROM "role_permissions" gp
          WHERE gp."role_id" = r."id" AND gp."permission_id" = p."id"
        )
    `);

    await queryRunner.query(`
      INSERT INTO "user_roles" ("user_id", "role_id")
      SELECT "id", (SELECT "id" FROM "roles" WHERE "name" = "users"."role"::text)
      FROM "users"
    `);

    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "role"`);
    await queryRunner.query(`DROP TYPE "public"."users_role_enum"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."users_role_enum" AS ENUM('user', 'admin')`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "role" "public"."users_role_enum" NOT NULL DEFAULT 'user'`,
    );

    // If a user has more than one role, only one (first alphabetically) is
    // restored here — a single enum column cannot represent multiple roles,
    // so a rollback after multi-role assignments is a deliberate, lossy
    // best-effort, not a full data restore.
    await queryRunner.query(`
      UPDATE "users" u
      SET "role" = sub."name"::"public"."users_role_enum"
      FROM (
        SELECT DISTINCT ON (ur."user_id") ur."user_id", r."name"
        FROM "user_roles" ur
        JOIN "roles" r ON r."id" = ur."role_id"
        ORDER BY ur."user_id", r."name"
      ) sub
      WHERE u."id" = sub."user_id"
    `);

    await queryRunner.query(`DROP TABLE "role_permissions"`);
    await queryRunner.query(`DROP TABLE "user_roles"`);
    await queryRunner.query(`DROP TABLE "permissions"`);
    await queryRunner.query(`DROP TABLE "roles"`);
  }
}
