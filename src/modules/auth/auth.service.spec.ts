import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import bcrypt from 'bcryptjs';

import { UsersService } from '../users/users.service';

import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let usersService: { findByEmail: jest.Mock; createUser: jest.Mock };
  let jwtService: { signAsync: jest.Mock };

  beforeEach(async () => {
    usersService = {
      findByEmail: jest.fn(),
      createUser: jest.fn(),
    };
    jwtService = {
      signAsync: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('register', () => {
    it('hashes the password and creates a user when the email is free', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      usersService.createUser.mockImplementation(
        ({ email, passwordHash }: { email: string; passwordHash: string }) =>
          Promise.resolve({
            id: 'generated-id',
            email,
            passwordHash,
            roles: [{ id: 'role-id', name: 'user' }],
            createdAt: new Date('2026-01-01'),
            updatedAt: new Date('2026-01-01'),
          }),
      );

      const result = await service.register({
        email: 'new@test.com',
        password: 'passw0rd',
      });

      expect(usersService.findByEmail).toHaveBeenCalledWith('new@test.com');
      expect(usersService.createUser).toHaveBeenCalledTimes(1);

      const [createUserArg] = usersService.createUser.mock.calls[0] as [
        { email: string; passwordHash: string },
      ];
      expect(createUserArg.email).toBe('new@test.com');
      expect(createUserArg.passwordHash).not.toBe('passw0rd');
      await expect(
        bcrypt.compare('passw0rd', createUserArg.passwordHash),
      ).resolves.toBe(true);

      expect(result).toEqual({
        id: 'generated-id',
        email: 'new@test.com',
        roles: ['user'],
        createdAt: new Date('2026-01-01'),
      });
      expect(result).not.toHaveProperty('passwordHash');
    });

    it('throws ConflictException when the email is already taken', async () => {
      usersService.findByEmail.mockResolvedValue({
        id: 'existing-id',
        email: 'taken@test.com',
        passwordHash: 'hash',
        role: 'user',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await expect(
        service.register({ email: 'taken@test.com', password: 'passw0rd' }),
      ).rejects.toThrow(ConflictException);

      expect(usersService.createUser).not.toHaveBeenCalled();
    });

    it('throws ConflictException on a database unique-violation race', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      usersService.createUser.mockRejectedValue({ code: '23505' });

      await expect(
        service.register({ email: 'race@test.com', password: 'passw0rd' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('login', () => {
    it('returns an access token for correct credentials', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 10);
      usersService.findByEmail.mockResolvedValue({
        id: 'user-1',
        email: 'test@test.com',
        passwordHash,
      });
      jwtService.signAsync.mockResolvedValue('signed-token');

      const result = await service.login({
        email: 'test@test.com',
        password: 'correct-password',
      });

      expect(result).toEqual({ accessToken: 'signed-token' });
      expect(jwtService.signAsync).toHaveBeenCalledWith({ sub: 'user-1' });
    });

    it('throws the same 401 for a wrong password as for a non-existent email', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 10);
      usersService.findByEmail.mockResolvedValueOnce({
        id: 'user-1',
        email: 'test@test.com',
        passwordHash,
      });

      await expect(
        service.login({
          email: 'test@test.com',
          password: 'wrong-password',
        }),
      ).rejects.toThrow(new UnauthorizedException('Invalid credentials'));

      usersService.findByEmail.mockResolvedValueOnce(null);

      await expect(
        service.login({ email: 'nobody@test.com', password: 'whatever' }),
      ).rejects.toThrow(new UnauthorizedException('Invalid credentials'));
    });
  });
});
