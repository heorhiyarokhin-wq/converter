import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { IS_PUBLIC_KEY } from '@/core/auth/decorators/public.decorator';
import { RbacConfigService } from '@/modules/rbac/rbac-config.service';
import { UsersService } from '@/modules/users/users.service';

import { RbacGuard } from './rbac.guard';

describe('RbacGuard', () => {
  let guard: RbacGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let usersService: { findById: jest.Mock };
  let rbacConfigService: { hasPermission: jest.Mock };

  const createContext = (userId = 'user-1'): ExecutionContext =>
    ({
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: userId } }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    usersService = { findById: jest.fn() };
    rbacConfigService = { hasPermission: jest.fn() };

    guard = new RbacGuard(
      reflector as unknown as Reflector,
      usersService as unknown as UsersService,
      rbacConfigService as unknown as RbacConfigService,
    );
  });

  it('allows public endpoints without checking permissions', async () => {
    reflector.getAllAndOverride.mockImplementation((key: string) =>
      key === IS_PUBLIC_KEY ? true : undefined,
    );

    await expect(guard.canActivate(createContext())).resolves.toBe(true);
    expect(usersService.findById).not.toHaveBeenCalled();
  });

  it('throws 403 when no @RequirePermission metadata is present (fail-closed)', async () => {
    reflector.getAllAndOverride.mockImplementation((key: string) =>
      key === IS_PUBLIC_KEY ? false : undefined,
    );

    await expect(guard.canActivate(createContext())).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('throws 403 when the user lacks the required permission', async () => {
    reflector.getAllAndOverride.mockImplementation((key: string) =>
      key === IS_PUBLIC_KEY ? false : { resource: 'rbac', action: 'manage' },
    );
    usersService.findById.mockResolvedValue({
      id: 'user-1',
      roles: [{ name: 'user' }],
    });
    rbacConfigService.hasPermission.mockReturnValue(false);

    await expect(guard.canActivate(createContext())).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('allows the request when the user has the required permission', async () => {
    reflector.getAllAndOverride.mockImplementation((key: string) =>
      key === IS_PUBLIC_KEY ? false : { resource: 'rbac', action: 'manage' },
    );
    usersService.findById.mockResolvedValue({
      id: 'user-1',
      roles: [{ name: 'admin' }],
    });
    rbacConfigService.hasPermission.mockReturnValue(true);

    await expect(guard.canActivate(createContext())).resolves.toBe(true);
    expect(rbacConfigService.hasPermission).toHaveBeenCalledWith(
      ['admin'],
      'rbac',
      'manage',
    );
  });

  it('throws 403 when the authenticated user no longer exists', async () => {
    reflector.getAllAndOverride.mockImplementation((key: string) =>
      key === IS_PUBLIC_KEY ? false : { resource: 'rbac', action: 'manage' },
    );
    usersService.findById.mockResolvedValue(null);

    await expect(guard.canActivate(createContext())).rejects.toThrow(
      ForbiddenException,
    );
  });
});
