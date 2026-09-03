import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';
import { Grant } from './entities/grant.entity';
import { Permission } from './entities/permission.entity';
import { RbacConfigService } from './rbac-config.service';

@Injectable()
export class PermissionsService {
  private readonly logger = new Logger(PermissionsService.name);

  constructor(
    @InjectRepository(Permission)
    private readonly permissionsRepository: Repository<Permission>,
    @InjectRepository(Grant)
    private readonly grantsRepository: Repository<Grant>,
    private readonly rbacConfigService: RbacConfigService,
  ) {}

  findAll(): Promise<Permission[]> {
    return this.permissionsRepository.find();
  }

  async create(
    dto: CreatePermissionDto,
    actorUserId: string,
  ): Promise<Permission> {
    const existing = await this.permissionsRepository.findOneBy({
      resource: dto.resource,
    });

    if (existing) {
      this.logger.warn(
        `[RBAC audit] actor=${actorUserId} op=create entity=permission id=- result=409`,
      );
      throw new ConflictException('Permission resource already exists');
    }

    const permission = this.permissionsRepository.create(dto);
    const saved = await this.permissionsRepository.save(permission);

    await this.rbacConfigService.reload();

    this.logger.log(
      `[RBAC audit] actor=${actorUserId} op=create entity=permission id=${saved.id} result=201`,
    );

    return saved;
  }

  async update(
    id: string,
    dto: UpdatePermissionDto,
    actorUserId: string,
  ): Promise<Permission> {
    const permission = await this.permissionsRepository.findOneBy({ id });

    if (!permission) {
      this.logger.warn(
        `[RBAC audit] actor=${actorUserId} op=update entity=permission id=${id} result=404`,
      );
      throw new NotFoundException('Permission not found');
    }

    if (dto.resource && dto.resource !== permission.resource) {
      const existing = await this.permissionsRepository.findOneBy({
        resource: dto.resource,
      });

      if (existing) {
        this.logger.warn(
          `[RBAC audit] actor=${actorUserId} op=update entity=permission id=${id} result=409`,
        );
        throw new ConflictException('Permission resource already exists');
      }
    }

    Object.assign(permission, dto);
    await this.permissionsRepository.save(permission);

    await this.rbacConfigService.reload();

    this.logger.log(
      `[RBAC audit] actor=${actorUserId} op=update entity=permission id=${id} result=200`,
    );

    return this.permissionsRepository.findOneByOrFail({ id });
  }

  async remove(id: string, actorUserId: string): Promise<void> {
    const permission = await this.permissionsRepository.findOneBy({ id });

    if (!permission) {
      this.logger.warn(
        `[RBAC audit] actor=${actorUserId} op=delete entity=permission id=${id} result=404`,
      );
      throw new NotFoundException('Permission not found');
    }

    const dependentGrants = await this.grantsRepository.count({
      where: { permissionId: id },
    });

    if (dependentGrants > 0) {
      this.logger.warn(
        `[RBAC audit] actor=${actorUserId} op=delete entity=permission id=${id} result=409`,
      );
      throw new ConflictException(
        `Cannot delete permission: ${dependentGrants} active grant(s) reference it`,
      );
    }

    await this.permissionsRepository.remove(permission);

    await this.rbacConfigService.reload();

    this.logger.log(
      `[RBAC audit] actor=${actorUserId} op=delete entity=permission id=${id} result=200`,
    );
  }
}
