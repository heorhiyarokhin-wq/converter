import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLoginAttempts1788400000001 implements MigrationInterface {
  name = 'CreateLoginAttempts1788400000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "login_attempts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "code_hash" character varying NOT NULL,
        "expires_at" TIMESTAMP NOT NULL,
        "attempts_count" integer NOT NULL DEFAULT 0,
        "consumed_at" TIMESTAMP,
        "last_sent_at" TIMESTAMP NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_login_attempts" PRIMARY KEY ("id"),
        CONSTRAINT "FK_login_attempts_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_login_attempts_user_id" ON "login_attempts" ("user_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "login_attempts"`);
  }
}
