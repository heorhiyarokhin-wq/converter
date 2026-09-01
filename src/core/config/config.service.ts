import { Injectable } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';

import { Config } from './config.types';

@Injectable()
export class ConfigService extends NestConfigService {
  get<T extends keyof Config>(key: T): string {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const value = super.get(key);
    return value as string;
  }
}
