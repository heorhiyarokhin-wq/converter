import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateEmailChangeRequests1788500000002 implements MigrationInterface {
  name = 'CreateEmailChangeRequests1788500000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "email_change_requests" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "new_email" character varying NOT NULL,
        "code_hash" character varying NOT NULL,
        "expires_at" TIMESTAMP NOT NULL,
        "attempts_count" integer NOT NULL DEFAULT 0,
        "consumed_at" TIMESTAMP,
        "last_sent_at" TIMESTAMP NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_email_change_requests" PRIMARY KEY ("id"),
        CONSTRAINT "FK_email_change_requests_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_email_change_requests_user_id" ON "email_change_requests" ("user_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "email_change_requests"`);
  }
}
