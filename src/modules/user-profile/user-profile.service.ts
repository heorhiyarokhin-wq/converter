import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import bcrypt from 'bcryptjs';
import { IsNull, Repository } from 'typeorm';

import { ConfigService } from '@/core/config/config.service';
import { MailService } from '@/core/mail/mail.service';
import { generateOtpCode } from '@/core/otp/otp.util';
import { RbacConfigService } from '@/modules/rbac/rbac-config.service';
import { User } from '@/modules/users/entities/user.entity';
import { UsersService } from '@/modules/users/users.service';

import { ConfirmEmailChangeDto } from './dto/confirm-email-change.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { InitiateEmailChangeDto } from './dto/initiate-email-change.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserProfileView } from './dto/user-profile-view.interface';
import { EmailChangeRequest } from './entities/email-change-request.entity';

const SALT_ROUNDS = 10;

export interface InitiateEmailChangeResult {
  requiresConfirmation: true;
  challengeId: string;
}

@Injectable()
export class UserProfileService {
  private readonly logger = new Logger(UserProfileService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly rbacConfigService: RbacConfigService,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
    @InjectRepository(EmailChangeRequest)
    private readonly emailChangeRequestsRepository: Repository<EmailChangeRequest>,
  ) {}

  async getProfile(
    targetId: string,
    viewerId: string,
  ): Promise<UserProfileView> {
    if (targetId !== viewerId) {
      const viewerRoles = await this.getRoleNames(viewerId);
      const canReadAny = this.rbacConfigService.hasPermission(
        viewerRoles,
        'users',
        'read-any',
      );

      if (!canReadAny) {
        this.logger.warn(
          `[USERS audit] action=view result=403 viewerId=${viewerId} targetId=${targetId}`,
        );
        throw new ForbiddenException();
      }
    }

    const target = await this.usersService.findById(targetId);

    if (!target) {
      this.logger.warn(
        `[USERS audit] action=view result=404 viewerId=${viewerId} targetId=${targetId}`,
      );
      throw new NotFoundException();
    }

    this.logger.log(
      `[USERS audit] action=view result=200 viewerId=${viewerId} targetId=${targetId}`,
    );

    return this.toProfileView(target);
  }

  async updateProfile(
    targetId: string,
    actorId: string,
    dto: UpdateUserDto,
  ): Promise<UserProfileView> {
    const actorRoles = await this.getRoleNames(actorId);
    const isElevated = this.rbacConfigService.hasPermission(
      actorRoles,
      'users',
      'update-any',
    );

    if (targetId !== actorId && !isElevated) {
      this.logger.warn(
        `[USERS audit] action=update result=403 actorId=${actorId} targetId=${targetId}`,
      );
      throw new ForbiddenException();
    }

    if (dto.email !== undefined && !isElevated) {
      this.logger.warn(
        `[USERS audit] action=update result=403 actorId=${actorId} targetId=${targetId} reason=self_email_change`,
      );
      throw new ForbiddenException(
        'Self cannot change email directly, use /email-change',
      );
    }

    const target = await this.usersService.findById(targetId);

    if (!target) {
      this.logger.warn(
        `[USERS audit] action=update result=404 actorId=${actorId} targetId=${targetId}`,
      );
      throw new NotFoundException();
    }

    if (dto.email !== undefined) {
      await this.assertEmailAvailable(dto.email, targetId);
    }

    const updated = await this.usersService.updateUser(target, dto);

    this.logger.log(
      `[USERS audit] action=update result=200 actorId=${actorId} targetId=${targetId} fields=${Object.keys(dto).join(',')}`,
    );

    return this.toProfileView(updated);
  }

  async initiateEmailChange(
    targetId: string,
    actorId: string,
    dto: InitiateEmailChangeDto,
  ): Promise<InitiateEmailChangeResult> {
    if (targetId !== actorId) {
      this.logger.warn(
        `[USERS audit] action=email_change_initiate result=403 actorId=${actorId} targetId=${targetId}`,
      );
      throw new ForbiddenException();
    }

    await this.assertEmailAvailable(dto.newEmail, targetId);

    return this.createEmailChangeAttempt(targetId, dto.newEmail);
  }

  async confirmEmailChange(
    targetId: string,
    actorId: string,
    dto: ConfirmEmailChangeDto,
  ): Promise<UserProfileView> {
    if (targetId !== actorId) {
      throw new ForbiddenException();
    }

    const attempt = await this.verifyEmailChangeCode(targetId, dto);

    attempt.consumedAt = new Date();
    await this.emailChangeRequestsRepository.save(attempt);

    await this.assertEmailAvailable(attempt.newEmail, targetId);

    const target = await this.usersService.findById(targetId);

    if (!target) {
      throw new NotFoundException();
    }

    const updated = await this.usersService.updateUser(target, {
      email: attempt.newEmail,
    });

    this.logger.log(
      `[USERS audit] action=email_change_confirm result=200 userId=${targetId} challengeId=${attempt.id}`,
    );

    return this.toProfileView(updated);
  }

  async deleteAccount(
    targetId: string,
    actorId: string,
    dto: DeleteAccountDto,
  ): Promise<void> {
    const actorRoles = await this.getRoleNames(actorId);
    const isElevated = this.rbacConfigService.hasPermission(
      actorRoles,
      'users',
      'delete-any',
    );

    if (targetId !== actorId && !isElevated) {
      this.logger.warn(
        `[USERS audit] action=delete result=403 actorId=${actorId} targetId=${targetId}`,
      );
      throw new ForbiddenException();
    }

    const target = await this.usersService.findById(targetId);

    if (!target) {
      this.logger.warn(
        `[USERS audit] action=delete result=404 actorId=${actorId} targetId=${targetId}`,
      );
      throw new NotFoundException();
    }

    if (!isElevated) {
      if (!dto.password) {
        throw new BadRequestException(
          'password is required to delete your own account',
        );
      }

      const passwordMatches = await bcrypt.compare(
        dto.password,
        target.passwordHash,
      );

      if (!passwordMatches) {
        throw new UnauthorizedException('Invalid password');
      }
    }

    await this.usersService.deleteUser(target);

    this.logger.log(
      `[USERS audit] action=delete result=200 actorId=${actorId} targetId=${targetId}`,
    );
  }

  async listUsers(
    query: ListUsersQueryDto,
  ): Promise<{ items: UserProfileView[]; total: number }> {
    // права уже проверены в guard'е (@RequirePermission('users', 'read-any')
    // на контроллере) — self/any-развилки тут нет, в отличие от остальных
    // методов сервиса, поэтому дальше сразу идём в БД
    const [users, total] = await this.usersService.findMany(query);

    return {
      items: users.map((user) => this.toProfileView(user)),
      total,
    };
  }

  private async getRoleNames(userId: string): Promise<string[]> {
    const user = await this.usersService.findById(userId);

    return user?.roles.map((role) => role.name) ?? [];
  }

  private toProfileView(user: User): UserProfileView {
    return {
      id: user.id,
      email: user.email,
      photo: user.photo,
      createdAt: user.createdAt,
    };
  }

  private async assertEmailAvailable(
    email: string,
    targetId: string,
  ): Promise<void> {
    const existing = await this.usersService.findByEmail(email);

    if (existing && existing.id !== targetId) {
      throw new ConflictException('Email already registered');
    }
  }

  private async createEmailChangeAttempt(
    userId: string,
    newEmail: string,
  ): Promise<InitiateEmailChangeResult> {
    const ttlMinutes = Number(this.configService.get('OTP_TTL_MINUTES'));
    const cooldownSeconds = Number(
      this.configService.get('OTP_RESEND_COOLDOWN_SECONDS'),
    );
    const codeLength = Number(this.configService.get('OTP_LENGTH'));

    const existingAttempt = await this.emailChangeRequestsRepository.findOne({
      where: { userId, consumedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });

    const now = new Date();

    if (existingAttempt) {
      const secondsSinceLastSent =
        (now.getTime() - existingAttempt.lastSentAt.getTime()) / 1000;

      if (secondsSinceLastSent < cooldownSeconds) {
        this.logger.warn(
          `[USERS audit] action=email_change_initiate result=rate_limited userId=${userId}`,
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

    const attempt = existingAttempt
      ? Object.assign(existingAttempt, {
          newEmail,
          codeHash,
          expiresAt,
          lastSentAt: now,
          attemptsCount: 0,
        })
      : this.emailChangeRequestsRepository.create({
          userId,
          newEmail,
          codeHash,
          expiresAt,
          lastSentAt: now,
        });

    const saved = await this.emailChangeRequestsRepository.save(attempt);

    // код идёт на НОВЫЙ адрес — это и есть проверка владения им, а не старым
    await this.mailService.send(
      newEmail,
      'Email change confirmation',
      `Your code: ${code}`,
    );

    this.logger.log(
      `[USERS audit] action=email_change_initiate result=otp_sent userId=${userId} challengeId=${saved.id}`,
    );

    return { requiresConfirmation: true, challengeId: saved.id };
  }

  private async verifyEmailChangeCode(
    targetId: string,
    dto: ConfirmEmailChangeDto,
  ): Promise<EmailChangeRequest> {
    const attempt = await this.emailChangeRequestsRepository.findOne({
      where: { id: dto.challengeId },
    });

    const maxAttempts = Number(this.configService.get('OTP_MAX_ATTEMPTS'));
    const invalidOrExpired = () => {
      this.logger.warn(
        `[USERS audit] action=email_change_confirm result=invalid_or_expired userId=${targetId}`,
      );
      return new UnauthorizedException('Invalid or expired code');
    };

    if (
      attempt?.consumedAt !== null ||
      attempt.expiresAt < new Date() ||
      attempt.attemptsCount >= maxAttempts
    ) {
      throw invalidOrExpired();
    }

    const codeMatches = await bcrypt.compare(dto.code, attempt.codeHash);

    if (!codeMatches) {
      attempt.attemptsCount += 1;
      await this.emailChangeRequestsRepository.save(attempt);
      throw invalidOrExpired();
    }

    return attempt;
  }
}
