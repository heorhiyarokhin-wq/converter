import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { RbacConfigService } from '@/modules/rbac/rbac-config.service';
import { User } from '@/modules/users/entities/user.entity';
import { UsersService } from '@/modules/users/users.service';

import { UserProfileView } from './dto/user-profile-view.interface';

@Injectable()
export class UserProfileService {
  private readonly logger = new Logger(UserProfileService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly rbacConfigService: RbacConfigService,
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
}
