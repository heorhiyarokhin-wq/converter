import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Transactional } from 'typeorm-transactional';

import { Role } from '@/modules/rbac/entities/role.entity';

import { User } from './entities/user.entity';

const DEFAULT_ROLE_NAME = 'user';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(Role)
    private readonly rolesRepository: Repository<Role>,
  ) {}

  findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOneBy({ email });
  }

  findById(id: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { id },
      relations: ['roles'],
    });
  }

  @Transactional()
  async createUser(data: {
    email: string;
    passwordHash: string;
  }): Promise<User> {
    const defaultRole = await this.rolesRepository.findOneByOrFail({
      name: DEFAULT_ROLE_NAME,
    });

    const user = this.usersRepository.create({
      ...data,
      roles: [defaultRole],
    });

    return this.usersRepository.save(user);
  }
}
