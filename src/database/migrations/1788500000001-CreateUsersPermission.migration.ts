import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUsersPermission1788500000001 implements MigrationInterface {
  name = 'CreateUsersPermission1788500000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("resource", "actions")
      VALUES ('users', ARRAY['read', 'update', 'read-any', 'update-any'])
      ON CONFLICT ("resource") DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id", "permission_id", "actions")
      SELECT r."id", p."id", ARRAY['read', 'update']
      FROM "roles" r, "permissions" p
      WHERE r."name" = 'user' AND p."resource" = 'users'
        AND NOT EXISTS (
          SELECT 1 FROM "role_permissions" gp
          WHERE gp."role_id" = r."id" AND gp."permission_id" = p."id"
        )
    `);

    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id", "permission_id")
      SELECT r."id", p."id"
      FROM "roles" r, "permissions" p
      WHERE r."name" = 'admin' AND p."resource" = 'users'
        AND NOT EXISTS (
          SELECT 1 FROM "role_permissions" gp
          WHERE gp."role_id" = r."id" AND gp."permission_id" = p."id"
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "role_permissions"
      WHERE "permission_id" IN (
        SELECT "id" FROM "permissions" WHERE "resource" = 'users'
      )
    `);

    await queryRunner.query(
      `DELETE FROM "permissions" WHERE "resource" = 'users'`,
    );
  }
}
