import { Body, Controller, Get, Param, Put } from '@nestjs/common';

import { CurrentUser } from '@/core/auth/decorators/current-user.decorator';
import { RequirePermission } from '@/core/rbac/decorators/require-permission.decorator';

import { AuthSettingsService } from './auth-settings.service';
import { UpdateAuthSettingDto } from './dto/update-auth-setting.dto';
import { AuthConfirmationSetting } from './entities/auth-confirmation-setting.entity';

@Controller('admin/auth-settings')
export class AuthSettingsController {
  constructor(private readonly authSettingsService: AuthSettingsService) {}

  @Get()
  @RequirePermission('auth-settings', 'manage')
  findAll(): Promise<AuthConfirmationSetting[]> {
    return this.authSettingsService.findAll();
  }

  @Put(':action')
  @RequirePermission('auth-settings', 'manage')
  update(
    @Param('action') action: string,
    @Body() dto: UpdateAuthSettingDto,
    @CurrentUser() user: { id: string },
  ): Promise<AuthConfirmationSetting> {
    return this.authSettingsService.update(action, dto, user.id);
  }
}
