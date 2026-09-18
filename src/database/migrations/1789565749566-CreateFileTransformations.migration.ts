import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFileTransformations1789565749566 implements MigrationInterface {
  name = 'CreateFileTransformations1789565749566';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "file_transformations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "source_format" character varying NOT NULL,
        "target_format" character varying NOT NULL,
        "input_size" integer NOT NULL,
        "output_size" integer,
        "status" character varying NOT NULL,
        "error_message" character varying,
        "duration_ms" integer NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_file_transformations" PRIMARY KEY ("id"),
        CONSTRAINT "FK_file_transformations_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_file_transformations_user_id" ON "file_transformations" ("user_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "file_transformations"`);
  }
}
