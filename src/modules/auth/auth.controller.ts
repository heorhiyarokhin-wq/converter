import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';
import ms from 'ms';

import { CurrentUser } from '@/core/auth/decorators/current-user.decorator';
import { Public } from '@/core/auth/decorators/public.decorator';
import {
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_PATH,
} from '@/core/auth/refresh-cookie.constants';
import { ConfigService } from '@/core/config/config.service';

import {
  AuthService,
  LoginResult,
  PendingLoginResult,
  RegisteredUser,
} from './auth.service';
import { ConfirmLoginDto } from './dto/confirm-login.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  register(@Body() dto: RegisterDto): Promise<RegisteredUser> {
    return this.authService.register(dto);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<LoginResult | PendingLoginResult> {
    const result = await this.authService.login(dto);

    if (!('refreshToken' in result)) {
      return result;
    }

    this.setRefreshCookie(reply, result.refreshToken);

    return { accessToken: result.accessToken };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('login/confirm')
  @HttpCode(HttpStatus.OK)
  async confirmLogin(
    @Body() dto: ConfirmLoginDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<LoginResult> {
    const { accessToken, refreshToken } =
      await this.authService.confirmLogin(dto);

    this.setRefreshCookie(reply, refreshToken);

    return { accessToken };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<LoginResult> {
    const refreshToken = request.cookies[REFRESH_COOKIE_NAME];

    if (!refreshToken) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokens = await this.authService.refreshTokens(refreshToken);

    this.setRefreshCookie(reply, tokens.refreshToken);

    return { accessToken: tokens.accessToken };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(
    @CurrentUser() user: { id: string },
    @Res({ passthrough: true }) reply: FastifyReply,
  ): { success: true } {
    reply.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
    this.authService.logout(user.id);

    return { success: true };
  }

  private setRefreshCookie(reply: FastifyReply, token: string): void {
    reply.setCookie(REFRESH_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: REFRESH_COOKIE_PATH,
      secure: this.configService.get('NODE_ENV') === 'production',
      maxAge:
        ms(this.configService.get('JWT_REFRESH_EXPIRES_IN') as ms.StringValue) /
        1000, // ms() возвращает миллисекунды, cookie ждёт секунды
    });
  }
}
