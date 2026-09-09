import { IsString, IsUUID, Matches } from 'class-validator';

export class ConfirmLoginDto {
  @IsUUID()
  attemptId: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'otpCode must be a 6-digit code' })
  otpCode: string;
}
