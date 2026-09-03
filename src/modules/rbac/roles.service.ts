import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { Grant } from './entities/grant.entity';
import { Role } from './entities/role.entity';
import { RbacConfigService } from './rbac-config.service';

@Injectable()
export class RolesService {
  private readonly logger = new Logger(RolesService.name);

  constructor(
    @InjectRepository(Role)
    private readonly rolesRepository: Repository<Role>,
    @InjectRepository(Grant)
    private readonly grantsRepository: Repository<Grant>,
    private readonly rbacConfigService: RbacConfigService,
  ) {}

  findAll(): Promise<Role[]> {
    return this.rolesRepository.find();
  }

  async create(dto: CreateRoleDto, actorUserId: string): Promise<Role> {
    const existing = await this.rolesRepository.findOneBy({ name: dto.name });

    if (existing) {
      this.logger.warn(
        `[RBAC audit] actor=${actorUserId} op=create entity=role id=- result=409`,
      );
      throw new ConflictException('Role name already exists');
    }

    const role = this.rolesRepository.create(dto);
    const saved = await this.rolesRepository.save(role);

    await this.rbacConfigService.reload();

    this.logger.log(
      `[RBAC audit] actor=${actorUserId} op=create entity=role id=${saved.id} result=201`,
    );

    return saved;
  }

  async update(
    id: string,
    dto: UpdateRoleDto,
    actorUserId: string,
  ): Promise<Role> {
    const role = await this.rolesRepository.findOneBy({ id });

    if (!role) {
      this.logger.warn(
        `[RBAC audit] actor=${actorUserId} op=update entity=role id=${id} result=404`,
      );
      throw new NotFoundException('Role not found');
    }

    if (dto.name && dto.name !== role.name) {
      const existing = await this.rolesRepository.findOneBy({
        name: dto.name,
      });

      if (existing) {
        this.logger.warn(
          `[RBAC audit] actor=${actorUserId} op=update entity=role id=${id} result=409`,
        );
        throw new ConflictException('Role name already exists');
      }
    }

    Object.assign(role, dto);
    await this.rolesRepository.save(role);

    await this.rbacConfigService.reload();

    this.logger.log(
      `[RBAC audit] actor=${actorUserId} op=update entity=role id=${id} result=200`,
    );

    return this.rolesRepository.findOneByOrFail({ id });
  }

  async remove(id: string, actorUserId: string): Promise<void> {
    const role = await this.rolesRepository.findOneBy({ id });

    if (!role) {
      this.logger.warn(
        `[RBAC audit] actor=${actorUserId} op=delete entity=role id=${id} result=404`,
      );
      throw new NotFoundException('Role not found');
    }

    const dependentGrants = await this.grantsRepository.count({
      where: { roleId: id },
    });

    if (dependentGrants > 0) {
      this.logger.warn(
        `[RBAC audit] actor=${actorUserId} op=delete entity=role id=${id} result=409`,
      );
      throw new ConflictException(
        `Cannot delete role: ${dependentGrants} active grant(s) reference it`,
      );
    }

    await this.rolesRepository.remove(role);

    await this.rbacConfigService.reload();

    this.logger.log(
      `[RBAC audit] actor=${actorUserId} op=delete entity=role id=${id} result=200`,
    );
  }
}
