import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AuthConfirmationSetting } from './entities/auth-confirmation-setting.entity';

@Injectable()
export class AuthConfigService implements OnModuleInit {
  private readonly logger = new Logger(AuthConfigService.name);

  private cache = new Map<string, boolean>();

  constructor(
    @InjectRepository(AuthConfirmationSetting)
    private readonly settingsRepository: Repository<AuthConfirmationSetting>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reload();
    this.logger.log('Auth confirmation settings cache loaded');
  }

  async reload(): Promise<void> {
    const settings = await this.settingsRepository.find();
    const cache = new Map<string, boolean>();

    for (const setting of settings) {
      cache.set(setting.action, setting.required);
    }

    this.cache = cache;
  }

  isConfirmationRequired(action: string): boolean {
    return this.cache.get(action) ?? false;
  }
}
