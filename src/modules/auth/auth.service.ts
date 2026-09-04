import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';

import { UsersService } from '@/modules/users/users.service';

import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

const SALT_ROUNDS = 10;
const POSTGRES_UNIQUE_VIOLATION = '23505';

export interface RegisteredUser {
  id: string;
  email: string;
  roles: string[];
  createdAt: Date;
}

export interface LoginResult {
  accessToken: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto): Promise<RegisteredUser> {
    this.logger.debug('Registration attempt received');

    const existingUser = await this.usersService.findByEmail(dto.email);

    if (existingUser) {
      this.logger.warn('Registration rejected, email already taken');
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

    try {
      const user = await this.usersService.createUser({
        email: dto.email,
        passwordHash,
      });

      this.logger.log(`Registration succeeded: ${user.id}`);

      return {
        id: user.id,
        email: user.email,
        roles: user.roles.map((role) => role.name),
        createdAt: user.createdAt,
      };
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        this.logger.warn('Registration rejected, unique-violation race');
        throw new ConflictException('Email already registered');
      }

      this.logger.error(
        'Registration failed unexpectedly',
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  async login(dto: LoginDto): Promise<LoginResult> {
    const user = await this.usersService.findByEmail(dto.email);

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatches = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );

    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const accessToken = await this.jwtService.signAsync({ sub: user.id });

    return { accessToken };
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === POSTGRES_UNIQUE_VIOLATION
    );
  }
}
