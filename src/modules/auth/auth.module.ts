import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { SignOptions } from 'jsonwebtoken';

import { JwtAuthGuard } from '@/core/auth/guards/jwt-auth.guard';
import { ConfigModule } from '@/core/config/config.module';
import { ConfigService } from '@/core/config/config.service';
import { MailModule } from '@/core/mail/mail.module';
import { UsersModule } from '@/modules/users/users.module';

import { AuthConfigService } from './auth-config.service';
import { AuthSettingsController } from './auth-settings.controller';
import { AuthSettingsService } from './auth-settings.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthConfirmationSetting } from './entities/auth-confirmation-setting.entity';
import { LoginAttempt } from './entities/login-attempt.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([AuthConfirmationSetting, LoginAttempt]),
    UsersModule,
    MailModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_SECRET'),
        signOptions: {
          expiresIn: config.get('JWT_EXPIRES_IN') as SignOptions['expiresIn'],
        },
      }),
    }),
  ],
  controllers: [AuthController, AuthSettingsController],
  providers: [
    AuthService,
    AuthConfigService,
    AuthSettingsService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AuthModule {}
