import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { User } from '@/modules/users/entities/user.entity';

@Entity('login_attempts')
export class LoginAttempt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ name: 'code_hash' })
  codeHash: string;

  @Column({ name: 'expires_at' })
  expiresAt: Date;

  @Column({ name: 'attempts_count', default: 0 })
  attemptsCount: number;

  @Column({ name: 'consumed_at', type: 'timestamp', nullable: true })
  consumedAt: Date | null;

  @Column({ name: 'last_sent_at' })
  lastSentAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
