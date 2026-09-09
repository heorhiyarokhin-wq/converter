import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { CurrentUser } from '@/core/auth/decorators/current-user.decorator';
import { RequirePermission } from '@/core/rbac/decorators/require-permission.decorator';

import { UserProfileView } from './dto/user-profile-view.interface';
import { UserProfileService } from './user-profile.service';

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
}
