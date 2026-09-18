import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('file_transformations')
export class FileTransformation {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ name: 'user_id' }) userId: string;
  @Column({ name: 'source_format' }) sourceFormat: string;
  @Column({ name: 'target_format' }) targetFormat: string;
  @Column({ name: 'input_size', type: 'integer' }) inputSize: number;
  @Column({ name: 'output_size', type: 'integer', nullable: true })
  outputSize: number | null;
  @Column({ type: 'varchar' }) status: 'success' | 'error';
  @Column({ name: 'error_message', type: 'varchar', nullable: true })
  errorMessage: string | null;
  @Column({ name: 'duration_ms', type: 'integer' }) durationMs: number;

  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
