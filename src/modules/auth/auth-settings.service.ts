import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AuthConfigService } from './auth-config.service';
import { UpdateAuthSettingDto } from './dto/update-auth-setting.dto';
import { AuthConfirmationSetting } from './entities/auth-confirmation-setting.entity';

@Injectable()
export class AuthSettingsService {
  private readonly logger = new Logger(AuthSettingsService.name);

  constructor(
    @InjectRepository(AuthConfirmationSetting)
    private readonly settingsRepository: Repository<AuthConfirmationSetting>,
    private readonly authConfigService: AuthConfigService,
  ) {}

  findAll(): Promise<AuthConfirmationSetting[]> {
    return this.settingsRepository.find();
  }

  async update(
    action: string,
    dto: UpdateAuthSettingDto,
    actorUserId: string,
  ): Promise<AuthConfirmationSetting> {
    const setting = await this.settingsRepository.findOneBy({ action });

    if (!setting) {
      this.logger.warn(
        `[AUTH audit] actor=${actorUserId} op=update entity=auth-setting id=${action} result=404`,
      );
      throw new NotFoundException(`Unknown action: ${action}`);
    }

    setting.required = dto.required;
    await this.settingsRepository.save(setting);

    await this.authConfigService.reload();

    this.logger.log(
      `[AUTH audit] actor=${actorUserId} op=update entity=auth-setting id=${action} result=200`,
    );

    return setting;
  }
}
