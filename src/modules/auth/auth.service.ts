import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import bcrypt from 'bcryptjs';
import type { SignOptions } from 'jsonwebtoken';
import { IsNull, Repository } from 'typeorm';

import { ConfigService } from '@/core/config/config.service';
import { MailService } from '@/core/mail/mail.service';
import { User } from '@/modules/users/entities/user.entity';
import { UsersService } from '@/modules/users/users.service';

import { AuthConfigService } from './auth-config.service';
import { ConfirmLoginDto } from './dto/confirm-login.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { LoginAttempt } from './entities/login-attempt.entity';
import { generateOtpCode } from './otp.util';

const SALT_ROUNDS = 10;
const POSTGRES_UNIQUE_VIOLATION = '23505';

export interface RegisteredUser {
  id: string;
  email: string;
  roles: string[];
  createdAt: Date;
}

export interface LoginResult {
  accessToken: string;
}

export interface TokenPair extends LoginResult {
  refreshToken: string;
}

export interface PendingLoginResult {
  attemptId: string;
  method: 'otp';
  expiresInSec: number;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly authConfigService: AuthConfigService,
    private readonly mailService: MailService,
    @InjectRepository(LoginAttempt)
    private readonly loginAttemptsRepository: Repository<LoginAttempt>,
  ) {}

  async register(dto: RegisterDto): Promise<RegisteredUser> {
    this.logger.debug('Registration attempt received');

    const existingUser = await this.usersService.findByEmail(dto.email);

    if (existingUser) {
      this.logger.warn('Registration rejected, email already taken');
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

    try {
      const user = await this.usersService.createUser({
        email: dto.email,
        passwordHash,
      });

      this.logger.log(`Registration succeeded: ${user.id}`);

      return {
        id: user.id,
        email: user.email,
        roles: user.roles.map((role) => role.name),
        createdAt: user.createdAt,
      };
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        this.logger.warn('Registration rejected, unique-violation race');
        throw new ConflictException('Email already registered');
      }

      this.logger.error(
        'Registration failed unexpectedly',
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  async login(dto: LoginDto): Promise<TokenPair | PendingLoginResult> {
    const user = await this.usersService.findByEmail(dto.email);

    if (!user) {
      // email ещё не известен
      this.logger.warn('[AUTH audit] action=login result=invalid_credentials');
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatches = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );

    if (!passwordMatches) {
      this.logger.warn(
        `[AUTH audit] action=login result=invalid_credentials userId=${user.id}`,
      );
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!this.authConfigService.isConfirmationRequired('login')) {
      this.logger.log(
        `[AUTH audit] action=login result=success userId=${user.id}`,
      );
      return this.issueTokens(user.id);
    }

    const pending = await this.createPendingLoginAttempt(user);

    this.logger.log(
      `[AUTH audit] action=login result=otp_sent userId=${user.id} attemptId=${pending.attemptId}`,
    );

    return pending;
  }

  async confirmLogin(dto: ConfirmLoginDto): Promise<TokenPair> {
    const attempt = await this.loginAttemptsRepository.findOne({
      where: { id: dto.attemptId },
    });

    const invalidOrExpired = () =>
      new UnauthorizedException('Invalid or expired code');

    if (!attempt) {
      this.logger.warn(
        `[AUTH audit] action=login_confirm result=invalid_or_expired attemptId=${dto.attemptId}`,
      );
      throw invalidOrExpired();
    }

    const maxAttempts = Number(this.configService.get('OTP_MAX_ATTEMPTS'));

    if (
      attempt.consumedAt !== null ||
      attempt.expiresAt < new Date() ||
      attempt.attemptsCount >= maxAttempts
    ) {
      this.logger.warn(
        `[AUTH audit] action=login_confirm result=invalid_or_expired userId=${attempt.userId} attemptId=${attempt.id}`,
      );
      throw invalidOrExpired();
    }

    const codeMatches = await bcrypt.compare(dto.otpCode, attempt.codeHash);

    if (!codeMatches) {
      attempt.attemptsCount += 1;
      await this.loginAttemptsRepository.save(attempt);
      this.logger.warn(
        `[AUTH audit] action=login_confirm result=invalid_or_expired userId=${attempt.userId} attemptId=${attempt.id}`,
      );
      throw invalidOrExpired();
    }

    attempt.consumedAt = new Date();
    await this.loginAttemptsRepository.save(attempt);

    this.logger.log(
      `[AUTH audit] action=login_confirm result=success userId=${attempt.userId} attemptId=${attempt.id}`,
    );

    return this.issueTokens(attempt.userId);
  }

  async refreshTokens(refreshToken: string): Promise<TokenPair> {
    const invalidToken = () =>
      new UnauthorizedException('Invalid refresh token');

    let payload: { sub: string };

    try {
      payload = await this.jwtService.verifyAsync<{ sub: string }>(
        refreshToken,
        { secret: this.configService.get('JWT_REFRESH_SECRET') },
      );
    } catch {
      this.logger.warn('[AUTH audit] action=refresh result=invalid_token');
      throw invalidToken();
    }

    const user = await this.usersService.findById(payload.sub);

    if (!user) {
      this.logger.warn(
        `[AUTH audit] action=refresh result=invalid_token userId=${payload.sub}`,
      );
      throw invalidToken();
    }

    this.logger.log(
      `[AUTH audit] action=refresh result=success userId=${user.id}`,
    );

    return this.issueTokens(user.id);
  }

  logout(userId: string): void {
    this.logger.log(
      `[AUTH audit] action=logout result=success userId=${userId}`,
    );
  }

  private async issueTokens(userId: string): Promise<TokenPair> {
    const accessToken = await this.jwtService.signAsync({ sub: userId });
    const refreshToken = await this.jwtService.signAsync(
      { sub: userId },
      {
        secret: this.configService.get('JWT_REFRESH_SECRET'),
        expiresIn: this.configService.get(
          'JWT_REFRESH_EXPIRES_IN',
        ) as SignOptions['expiresIn'],
      },
    );

    return { accessToken, refreshToken };
  }

  private async createPendingLoginAttempt(
    user: User,
  ): Promise<PendingLoginResult> {
    const ttlMinutes = Number(this.configService.get('OTP_TTL_MINUTES'));
    const cooldownSeconds = Number(
      this.configService.get('OTP_RESEND_COOLDOWN_SECONDS'),
    );
    const codeLength = Number(this.configService.get('OTP_LENGTH'));

    const existing = await this.loginAttemptsRepository.findOne({
      where: { userId: user.id, consumedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });

    const now = new Date();

    if (existing) {
      const secondsSinceLastSent =
        (now.getTime() - existing.lastSentAt.getTime()) / 1000;

      if (secondsSinceLastSent < cooldownSeconds) {
        this.logger.warn(
          `[AUTH audit] action=login result=rate_limited userId=${user.id}`,
        );
        throw new HttpException(
          'Too many requests',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    const code = generateOtpCode(codeLength);
    const codeHash = await bcrypt.hash(code, SALT_ROUNDS);
    const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000);

    const attempt = existing
      ? Object.assign(existing, {
          codeHash,
          expiresAt,
          lastSentAt: now,
          attemptsCount: 0,
        })
      : this.loginAttemptsRepository.create({
          userId: user.id,
          codeHash,
          expiresAt,
          lastSentAt: now,
        });

    const saved = await this.loginAttemptsRepository.save(attempt);

    await this.mailService.send(
      user.email,
      'Login confirmation code',
      `Your code: ${code}`,
    );

    return {
      attemptId: saved.id,
      method: 'otp',
      expiresInSec: ttlMinutes * 60,
    };
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === POSTGRES_UNIQUE_VIOLATION
    );
  }
}
