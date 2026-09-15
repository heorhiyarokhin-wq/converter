import { Transform } from 'class-transformer';
import { IsEmail } from 'class-validator';

export class InitiateEmailChangeDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  newEmail: string;
}
