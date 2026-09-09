import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserPhoto1788500000000 implements MigrationInterface {
  name = 'AddUserPhoto1788500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "photo" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "photo"`);
  }
}
