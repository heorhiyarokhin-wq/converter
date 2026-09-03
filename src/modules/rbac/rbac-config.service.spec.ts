import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Grant } from './entities/grant.entity';
import { RbacConfigService } from './rbac-config.service';

describe('RbacConfigService', () => {
  let service: RbacConfigService;
  let grantsRepository: { find: jest.Mock };

  beforeEach(async () => {
    grantsRepository = { find: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RbacConfigService,
        { provide: getRepositoryToken(Grant), useValue: grantsRepository },
      ],
    }).compile();

    service = module.get<RbacConfigService>(RbacConfigService);
  });

  it('grants access to all permission actions when the grant has no override', async () => {
    grantsRepository.find.mockResolvedValue([
      {
        role: { name: 'admin' },
        permission: { resource: 'rbac', actions: ['manage'] },
        actions: null,
      },
    ]);

    await service.reload();

    expect(service.hasPermission(['admin'], 'rbac', 'manage')).toBe(true);
    expect(service.hasPermission(['user'], 'rbac', 'manage')).toBe(false);
  });

  it('restricts access to the grant-specific action subset', async () => {
    grantsRepository.find.mockResolvedValue([
      {
        role: { name: 'moderator' },
        permission: {
          resource: 'documents',
          actions: ['create', 'read', 'update', 'delete'],
        },
        actions: ['read', 'update'],
      },
    ]);

    await service.reload();

    expect(service.hasPermission(['moderator'], 'documents', 'read')).toBe(
      true,
    );
    expect(service.hasPermission(['moderator'], 'documents', 'delete')).toBe(
      false,
    );
  });

  it('grants access if any of the user roles has the permission', async () => {
    grantsRepository.find.mockResolvedValue([
      {
        role: { name: 'admin' },
        permission: { resource: 'rbac', actions: ['manage'] },
        actions: null,
      },
    ]);

    await service.reload();

    expect(service.hasPermission(['user', 'admin'], 'rbac', 'manage')).toBe(
      true,
    );
  });

  it('loads the cache automatically on module init', async () => {
    grantsRepository.find.mockResolvedValue([]);

    await service.onModuleInit();

    expect(grantsRepository.find).toHaveBeenCalledWith({
      relations: ['role', 'permission'],
    });
  });
});
