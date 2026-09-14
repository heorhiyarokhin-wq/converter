import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
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

  updateUser(
    user: User,
    patch: Partial<Pick<User, 'email' | 'photo'>>,
  ): Promise<User> {
    return this.usersRepository.save(Object.assign(user, patch));
  }

  async deleteUser(user: User): Promise<void> {
    await this.usersRepository.remove(user);
  }

  findMany(params: {
    limit: number;
    offset: number;
    q?: string;
  }): Promise<[User[], number]> {
    return this.usersRepository.findAndCount({
      // явный select — гарантия, что passwordHash (и любое чувствительное поле,
      // которое кто-то добавит в entity в будущем) никогда не попадёт в список.
      // Без select find() тянет ВСЕ колонки по умолчанию.
      select: { id: true, email: true, photo: true, createdAt: true },
      // ищем именно в email — единственное текстовое поле User, по которому
      // вообще имеет смысл частичный поиск (id — точное совпадение, не ILIKE)
      //
      // '%' + '' + '%' = '%%' — этот паттерн ILIKE совпадает с ЛЮБОЙ строкой,
      // так что отдельная ветка "если q нет — верни всех" не нужна вообще
      where: { email: ILike(`%${params.q ?? ''}%`) },
      order: { createdAt: 'DESC' },
      take: params.limit,
      skip: params.offset,
    });
  }
}
