import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Grant } from './entities/grant.entity';

@Injectable()
export class RbacConfigService implements OnModuleInit {
  private readonly logger = new Logger(RbacConfigService.name);

  private cache = new Map<string, Map<string, Set<string>>>();

  constructor(
    @InjectRepository(Grant)
    private readonly grantsRepository: Repository<Grant>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reload();
    this.logger.log('RBAC config cache loaded');
  }

  async reload(): Promise<void> {
    const grants = await this.grantsRepository.find({
      relations: ['role', 'permission'],
    });

    const cache = new Map<string, Map<string, Set<string>>>();

    for (const grant of grants) {
      const roleName = grant.role.name;
      const resource = grant.permission.resource;

      const effectiveActions =
        grant.actions && grant.actions.length > 0
          ? grant.actions
          : grant.permission.actions;

      const resourceMap = cache.get(roleName) ?? new Map<string, Set<string>>();
      cache.set(roleName, resourceMap);

      const actionSet = resourceMap.get(resource) ?? new Set<string>();
      resourceMap.set(resource, actionSet);

      for (const action of effectiveActions) {
        actionSet.add(action);
      }
    }

    this.cache = cache;
  }

  hasPermission(
    roleNames: string[],
    resource: string,
    action: string,
  ): boolean {
    for (const roleName of roleNames) {
      const actions = this.cache.get(roleName)?.get(resource);

      if (actions?.has(action)) {
        return true;
      }
    }

    return false;
  }
}
