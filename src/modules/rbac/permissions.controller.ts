import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';

import { CurrentUser } from '@/core/auth/decorators/current-user.decorator';
import { RequirePermission } from '@/core/rbac/decorators/require-permission.decorator';

import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';
import { Permission } from './entities/permission.entity';
import { PermissionsService } from './permissions.service';

@Controller('admin/rbac/permissions')
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Get()
  @RequirePermission('rbac', 'manage')
  findAll(): Promise<Permission[]> {
    return this.permissionsService.findAll();
  }

  @Post()
  @RequirePermission('rbac', 'manage')
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: CreatePermissionDto,
    @CurrentUser() user: { id: string },
  ): Promise<Permission> {
    return this.permissionsService.create(dto, user.id);
  }

  @Put(':id')
  @RequirePermission('rbac', 'manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePermissionDto,
    @CurrentUser() user: { id: string },
  ): Promise<Permission> {
    return this.permissionsService.update(id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermission('rbac', 'manage')
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { id: string },
  ): Promise<{ deleted: true }> {
    await this.permissionsService.remove(id, user.id);

    return { deleted: true };
  }
}
