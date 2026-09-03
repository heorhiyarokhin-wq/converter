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

import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { Role } from './entities/role.entity';
import { RolesService } from './roles.service';

@Controller('admin/rbac/roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @RequirePermission('rbac', 'manage')
  findAll(): Promise<Role[]> {
    return this.rolesService.findAll();
  }

  @Post()
  @RequirePermission('rbac', 'manage')
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: CreateRoleDto,
    @CurrentUser() user: { id: string },
  ): Promise<Role> {
    return this.rolesService.create(dto, user.id);
  }

  @Put(':id')
  @RequirePermission('rbac', 'manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() user: { id: string },
  ): Promise<Role> {
    return this.rolesService.update(id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermission('rbac', 'manage')
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { id: string },
  ): Promise<{ deleted: true }> {
    await this.rolesService.remove(id, user.id);

    return { deleted: true };
  }
}
