import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CreateGrantDto } from './dto/create-grant.dto';
import { UpdateGrantDto } from './dto/update-grant.dto';
import { Grant } from './entities/grant.entity';
import { Permission } from './entities/permission.entity';
import { Role } from './entities/role.entity';
import { RbacConfigService } from './rbac-config.service';

@Injectable()
export class GrantsService {
  private readonly logger = new Logger(GrantsService.name);

  constructor(
    @InjectRepository(Grant)
    private readonly grantsRepository: Repository<Grant>,
    @InjectRepository(Role)
    private readonly rolesRepository: Repository<Role>,
    @InjectRepository(Permission)
    private readonly permissionsRepository: Repository<Permission>,
    private readonly rbacConfigService: RbacConfigService,
  ) {}

  findAll(): Promise<Grant[]> {
    return this.grantsRepository.find({ relations: ['role', 'permission'] });
  }

  async create(dto: CreateGrantDto, actorUserId: string): Promise<Grant> {
    const role = await this.rolesRepository.findOneBy({ id: dto.roleId });

    if (!role) {
      this.logger.warn(
        `[RBAC audit] actor=${actorUserId} op=create entity=grant id=- result=404`,
      );
      throw new NotFoundException('Role not found');
    }

    const permission = await this.permissionsRepository.findOneBy({
      id: dto.permissionId,
    });

    if (!permission) {
      this.logger.warn(
        `[RBAC audit] actor=${actorUserId} op=create entity=grant id=- result=404`,
      );
      throw new NotFoundException('Permission not found');
    }

    const existing = await this.grantsRepository.findOneBy({
      roleId: dto.roleId,
      permissionId: dto.permissionId,
    });

    if (existing) {
      this.logger.warn(
        `[RBAC audit] actor=${actorUserId} op=create entity=grant id=- result=409`,
      );
      throw new ConflictException(
        'Grant for this role and permission already exists',
      );
    }

    const grant = this.grantsRepository.create(dto);
    const saved = await this.grantsRepository.save(grant);

    await this.rbacConfigService.reload();

    this.logger.log(
      `[RBAC audit] actor=${actorUserId} op=create entity=grant id=${saved.id} result=201`,
    );

    return saved;
  }

  async update(
    id: string,
    dto: UpdateGrantDto,
    actorUserId: string,
  ): Promise<Grant> {
    const grant = await this.grantsRepository.findOneBy({ id });

    if (!grant) {
      this.logger.warn(
        `[RBAC audit] actor=${actorUserId} op=update entity=grant id=${id} result=404`,
      );
      throw new NotFoundException('Grant not found');
    }

    if (dto.roleId) {
      const role = await this.rolesRepository.findOneBy({ id: dto.roleId });

      if (!role) {
        this.logger.warn(
          `[RBAC audit] actor=${actorUserId} op=update entity=grant id=${id} result=404`,
        );
        throw new NotFoundException('Role not found');
      }
    }

    if (dto.permissionId) {
      const permission = await this.permissionsRepository.findOneBy({
        id: dto.permissionId,
      });

      if (!permission) {
        this.logger.warn(
          `[RBAC audit] actor=${actorUserId} op=update entity=grant id=${id} result=404`,
        );
        throw new NotFoundException('Permission not found');
      }
    }

    const nextRoleId = dto.roleId ?? grant.roleId;
    const nextPermissionId = dto.permissionId ?? grant.permissionId;

    if (
      nextRoleId !== grant.roleId ||
      nextPermissionId !== grant.permissionId
    ) {
      const existing = await this.grantsRepository.findOneBy({
        roleId: nextRoleId,
        permissionId: nextPermissionId,
      });

      if (existing) {
        this.logger.warn(
          `[RBAC audit] actor=${actorUserId} op=update entity=grant id=${id} result=409`,
        );
        throw new ConflictException(
          'Grant for this role and permission already exists',
        );
      }
    }

    Object.assign(grant, dto);
    await this.grantsRepository.save(grant);

    await this.rbacConfigService.reload();

    this.logger.log(
      `[RBAC audit] actor=${actorUserId} op=update entity=grant id=${id} result=200`,
    );

    return this.grantsRepository.findOneByOrFail({ id });
  }

  async remove(id: string, actorUserId: string): Promise<void> {
    const grant = await this.grantsRepository.findOneBy({ id });

    if (!grant) {
      this.logger.warn(
        `[RBAC audit] actor=${actorUserId} op=delete entity=grant id=${id} result=404`,
      );
      throw new NotFoundException('Grant not found');
    }

    await this.grantsRepository.remove(grant);

    await this.rbacConfigService.reload();

    this.logger.log(
      `[RBAC audit] actor=${actorUserId} op=delete entity=grant id=${id} result=200`,
    );
  }
}
