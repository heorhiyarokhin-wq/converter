import { IsArray, IsOptional, IsString, IsUUID } from 'class-validator';

export class UpdateGrantDto {
  @IsOptional()
  @IsUUID()
  roleId?: string;

  @IsOptional()
  @IsUUID()
  permissionId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  actions?: string[];
}
