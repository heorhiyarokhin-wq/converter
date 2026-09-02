import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUsersEmailLowerUniqueIndex1788251349909 implements MigrationInterface {
  name = 'AddUsersEmailLowerUniqueIndex1788251349909';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_users_email_lower" ON "users" (lower("email"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."UQ_users_email_lower"`);
  }
}
