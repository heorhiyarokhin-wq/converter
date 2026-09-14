import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply } from 'fastify';

import { CurrentUser } from '@/core/auth/decorators/current-user.decorator';
import {
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_PATH,
} from '@/core/auth/refresh-cookie.constants';
import { RequirePermission } from '@/core/rbac/decorators/require-permission.decorator';

import { ConfirmEmailChangeDto } from './dto/confirm-email-change.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { InitiateEmailChangeDto } from './dto/initiate-email-change.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserProfileView } from './dto/user-profile-view.interface';
import {
  InitiateEmailChangeResult,
  UserProfileService,
} from './user-profile.service';

@Controller('users')
export class UserProfileController {
  constructor(private readonly userProfileService: UserProfileService) {}

  @RequirePermission('users', 'read')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Get(':id')
  getProfile(
    @Param('id', ParseUUIDPipe) targetId: string,
    @CurrentUser() viewer: { id: string },
  ): Promise<UserProfileView> {
    return this.userProfileService.getProfile(targetId, viewer.id);
  }

  // 'update' — тот же грубый RBAC-фильтр, что 'read' у getProfile: пропускает
  // и user, и admin (у обеих ролей это право есть). Кто именно что может
  // редактировать (свой профиль / чужой / email) — решает не guard, а сервис.
  @RequirePermission('users', 'update')
  // лимит ниже, чем у чтения (20) — это запись в БД, разумно ограничивать строже
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Patch(':id')
  updateProfile(
    // ':id' из URL — тот профиль, который правят; ParseUUIDPipe даёт 400
    // раньше, чем невалидный id вообще попадёт в сервис/базу
    @Param('id', ParseUUIDPipe) targetId: string,
    // тот, кто РЕАЛЬНО прислал запрос — берём из JWT, а не из URL;
    // targetId и actor.id могут не совпадать (это и есть self/any-развилка)
    @CurrentUser() actor: { id: string },
    // тело уже провалидировано и трансформировано глобальным ValidationPipe
    // (whitelist/forbidNonWhitelisted/transform из main.ts) до того, как
    // дойти сюда — здесь это просто готовый типизированный объект
    @Body() dto: UpdateUserDto,
  ): Promise<UserProfileView> {
    // сам контроллер не содержит НИКАКОЙ бизнес-логики — только пробрасывает
    // три значения (кого меняем, кто меняет, что меняем) в сервис
    return this.userProfileService.updateProfile(targetId, actor.id, dto);
  }

  // тот же 'update' — фильтр общий для self/any, а "только для себя" для
  // email-change проверяется внутри сервиса (targetId !== actorId → 403)
  @RequirePermission('users', 'update')
  // самый строгий лимит из трёх — эта ручка реально отправляет письма,
  // без throttle её можно было бы использовать для спама на произвольный email
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post(':id/email-change')
  initiateEmailChange(
    @Param('id', ParseUUIDPipe) targetId: string,
    @CurrentUser() actor: { id: string },
    @Body() dto: InitiateEmailChangeDto,
  ): Promise<InitiateEmailChangeResult> {
    return this.userProfileService.initiateEmailChange(targetId, actor.id, dto);
  }

  @RequirePermission('users', 'update')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post(':id/email-change/confirm')
  confirmEmailChange(
    @Param('id', ParseUUIDPipe) targetId: string,
    @CurrentUser() actor: { id: string },
    @Body() dto: ConfirmEmailChangeDto,
  ): Promise<UserProfileView> {
    return this.userProfileService.confirmEmailChange(targetId, actor.id, dto);
  }

  @RequirePermission('users', 'delete')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteAccount(
    @Param('id', ParseUUIDPipe) targetId: string,
    @CurrentUser() actor: { id: string },
    @Body() dto: DeleteAccountDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.userProfileService.deleteAccount(targetId, actor.id, dto);

    // чистим cookie только своей же сессии — если admin удаляет чужого,
    // это чужой браузер, у admin в его собственном ничего менять не нужно
    if (targetId === actor.id) {
      reply.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
    }
  }
}
