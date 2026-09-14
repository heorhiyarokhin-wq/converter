import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ListUsersQueryDto {
  // Query-параметры в HTTP всегда строки ("20", не 20) — Fastify/Nest парсят URL
  // как ?limit=20, а не как JSON. @Type(() => Number) заставляет class-transformer
  // сконвертировать строку в number ДО того, как @IsInt() её проверит — без этого
  // @IsInt() увидит string "20" и всегда будет падать с 400.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100) // верхняя граница — защита от "limit=1000000" вместо отдельного rate-limit
  limit: number = 20;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset: number = 0;

  // без @Type — строка остаётся строкой, конвертировать нечего
  @IsOptional()
  @IsString()
  @MaxLength(255) // не даём положить мегабайтную строку в ILIKE-запрос
  q?: string;
}
