import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFileTransformPermission1789569788543 implements MigrationInterface {
  name = 'CreateFileTransformPermission1789569788543';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("resource", "actions")
      VALUES ('file-transform', ARRAY['convert'])
      ON CONFLICT ("resource") DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id", "permission_id")
      SELECT r."id", p."id"
      FROM "roles" r, "permissions" p
      WHERE r."name" IN ('user', 'admin') AND p."resource" = 'file-transform'
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
        SELECT "id" FROM "permissions" WHERE "resource" = 'file-transform'
      )
    `);

    await queryRunner.query(
      `DELETE FROM "permissions" WHERE "resource" = 'file-transform'`,
    );
  }
}
