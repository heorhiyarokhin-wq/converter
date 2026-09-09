import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('auth_confirmation_settings')
export class AuthConfirmationSetting {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  action: string;

  @Column({ default: false })
  required: boolean;
}
