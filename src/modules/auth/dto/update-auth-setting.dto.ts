import { IsBoolean } from 'class-validator';

export class UpdateAuthSettingDto {
  @IsBoolean()
  required: boolean;
}
