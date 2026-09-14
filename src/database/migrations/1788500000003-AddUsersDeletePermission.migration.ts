import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUsersDeletePermission1788500000003 implements MigrationInterface {
  name = 'AddUsersDeletePermission1788500000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "permissions"
      SET "actions" = ARRAY['read', 'update', 'read-any', 'update-any', 'delete', 'delete-any']
      WHERE "resource" = 'users'
    `);

    await queryRunner.query(`
      UPDATE "role_permissions" rp
      SET "actions" = ARRAY['read', 'update', 'delete']
      FROM "roles" r, "permissions" p
      WHERE rp."role_id" = r."id" AND rp."permission_id" = p."id"
        AND r."name" = 'user' AND p."resource" = 'users'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "role_permissions" rp
      SET "actions" = ARRAY['read', 'update']
      FROM "roles" r, "permissions" p
      WHERE rp."role_id" = r."id" AND rp."permission_id" = p."id"
        AND r."name" = 'user' AND p."resource" = 'users'
    `);

    await queryRunner.query(`
      UPDATE "permissions"
      SET "actions" = ARRAY['read', 'update', 'read-any', 'update-any']
      WHERE "resource" = 'users'
    `);
  }
}
