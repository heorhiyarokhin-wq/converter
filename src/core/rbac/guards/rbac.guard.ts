import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FastifyRequest } from 'fastify';

import { IS_PUBLIC_KEY } from '@/core/auth/decorators/public.decorator';
import { RbacConfigService } from '@/modules/rbac/rbac-config.service';
import { UsersService } from '@/modules/users/users.service';

import {
  PERMISSION_KEY,
  RequiredPermission,
} from '../decorators/require-permission.decorator';

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly usersService: UsersService,
    private readonly rbacConfigService: RbacConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const requirement = this.reflector.getAllAndOverride<RequiredPermission>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requirement) {
      throw new ForbiddenException();
    }

    const request = context
      .switchToHttp()
      .getRequest<FastifyRequest & { user: { id: string } }>();
    const userId = request.user.id;

    const user = await this.usersService.findById(userId);

    if (!user) {
      throw new ForbiddenException();
    }

    const roleNames = user.roles.map((role) => role.name);
    const allowed = this.rbacConfigService.hasPermission(
      roleNames,
      requirement.resource,
      requirement.action,
    );

    if (!allowed) {
      throw new ForbiddenException();
    }

    return true;
  }
}
