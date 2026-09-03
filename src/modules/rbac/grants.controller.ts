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

import { CreateGrantDto } from './dto/create-grant.dto';
import { UpdateGrantDto } from './dto/update-grant.dto';
import { Grant } from './entities/grant.entity';
import { GrantsService } from './grants.service';

@Controller('admin/rbac/grants')
export class GrantsController {
  constructor(private readonly grantsService: GrantsService) {}

  @Get()
  @RequirePermission('rbac', 'manage')
  findAll(): Promise<Grant[]> {
    return this.grantsService.findAll();
  }

  @Post()
  @RequirePermission('rbac', 'manage')
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: CreateGrantDto,
    @CurrentUser() user: { id: string },
  ): Promise<Grant> {
    return this.grantsService.create(dto, user.id);
  }

  @Put(':id')
  @RequirePermission('rbac', 'manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGrantDto,
    @CurrentUser() user: { id: string },
  ): Promise<Grant> {
    return this.grantsService.update(id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermission('rbac', 'manage')
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { id: string },
  ): Promise<{ deleted: true }> {
    await this.grantsService.remove(id, user.id);

    return { deleted: true };
  }
}
