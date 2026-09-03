import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';

import { RbacGuard } from '@/core/rbac/guards/rbac.guard';
import { UsersModule } from '@/modules/users/users.module';

import { Grant } from './entities/grant.entity';
import { Permission } from './entities/permission.entity';
import { Role } from './entities/role.entity';
import { GrantsController } from './grants.controller';
import { GrantsService } from './grants.service';
import { PermissionsController } from './permissions.controller';
import { PermissionsService } from './permissions.service';
import { RbacConfigService } from './rbac-config.service';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

@Module({
  imports: [TypeOrmModule.forFeature([Grant, Role, Permission]), UsersModule],
  controllers: [RolesController, PermissionsController, GrantsController],
  providers: [
    RbacConfigService,
    RolesService,
    PermissionsService,
    GrantsService,
    {
      provide: APP_GUARD,
      useClass: RbacGuard,
    },
  ],
  exports: [RbacConfigService],
})
export class RbacModule {}
