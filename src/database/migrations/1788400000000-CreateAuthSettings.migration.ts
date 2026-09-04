import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuthSettings1788400000000 implements MigrationInterface {
  name = 'CreateAuthSettings1788400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "auth_confirmation_settings" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "action" character varying NOT NULL,
        "required" boolean NOT NULL DEFAULT false,
        CONSTRAINT "UQ_auth_confirmation_settings_action" UNIQUE ("action"),
        CONSTRAINT "PK_auth_confirmation_settings" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      INSERT INTO "auth_confirmation_settings" ("action", "required")
      VALUES ('login', false)
      ON CONFLICT ("action") DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "permissions" ("resource", "actions")
      VALUES ('auth-settings', ARRAY['manage'])
      ON CONFLICT ("resource") DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id", "permission_id")
      SELECT r."id", p."id"
      FROM "roles" r, "permissions" p
      WHERE r."name" = 'admin' AND p."resource" = 'auth-settings'
        AND NOT EXISTS (
          SELECT 1 FROM "role_permissions" gp
          WHERE gp."role_id" = r."id" AND gp."permission_id" = p."id"
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "role_permissions"
      WHERE "role_id" IN (SELECT "id" FROM "roles" WHERE "name" = 'admin')
        AND "permission_id" IN (
          SELECT "id" FROM "permissions" WHERE "resource" = 'auth-settings'
        )
    `);

    await queryRunner.query(
      `DELETE FROM "permissions" WHERE "resource" = 'auth-settings'`,
    );

    await queryRunner.query(`DROP TABLE "auth_confirmation_settings"`);
  }
}
