import {
  ArrayNotEmpty,
  IsArray,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreatePermissionDto {
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  resource: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  actions: string[];
}
