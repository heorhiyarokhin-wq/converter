import { Injectable } from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';

const STORAGE_DIR = join(process.cwd(), 'storage', 'converted');

@Injectable()
export class ResultStorageService {
  async save(key: string, content: string): Promise<void> {
    await mkdir(STORAGE_DIR, { recursive: true });
    await writeFile(join(STORAGE_DIR, key), content, 'utf-8');
  }

  async read(key: string): Promise<string> {
    return readFile(join(STORAGE_DIR, key), 'utf-8');
  }
}
