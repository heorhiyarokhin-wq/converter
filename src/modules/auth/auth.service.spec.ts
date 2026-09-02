import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import bcrypt from 'bcryptjs';

import { UsersService } from '../users/users.service';

import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let usersService: { findByEmail: jest.Mock; createUser: jest.Mock };

  beforeEach(async () => {
    usersService = {
      findByEmail: jest.fn(),
      createUser: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
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
            role: 'user',
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
        role: 'user',
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
});
