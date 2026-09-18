import {
  BadRequestException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Config } from '@/core/config/config.types';
import { ConfigService } from '@/core/config/config.service';

import { FileTransformation } from './entities/file-transformation.entity';
import {
  FormatHandler,
  SupportedFormat,
} from './formats/format-handler.abstract';
import { FORMAT_HANDLERS } from './formats/format-handlers.map';
import { PairFileTransformer } from './pair-file-transformer';
import { ResultStorageService } from './result-storage.service';

const MAX_SIZE_BY_FORMAT: Record<SupportedFormat, keyof Config> = {
  csv: 'CONVERT_MAX_SIZE_CSV',
  json: 'CONVERT_MAX_SIZE_JSON',
  xml: 'CONVERT_MAX_SIZE_XML',
  yaml: 'CONVERT_MAX_SIZE_YAML',
};

export interface ConvertResult {
  output: string;
  historyId: string;
}

@Injectable()
export class FileTransformService {
  constructor(
    private readonly configService: ConfigService,
    private readonly resultStorageService: ResultStorageService,
    @InjectRepository(FileTransformation)
    private readonly historyRepository: Repository<FileTransformation>,
  ) {}

  async convert(
    userId: string,
    sourceFormat: SupportedFormat,
    targetFormat: SupportedFormat,
    input: Buffer,
    saveResult: boolean,
  ): Promise<ConvertResult> {
    this.assertSizeAllowed(sourceFormat, input.length);
    const startedAt = Date.now();

    try {
      const transformer = new PairFileTransformer(
        this.getHandler(sourceFormat),
        this.getHandler(targetFormat),
      );
      const output = transformer.process(input) as string;

      const history = await this.historyRepository.save(
        this.historyRepository.create({
          userId,
          sourceFormat,
          targetFormat,
          inputSize: input.length,
          outputSize: Buffer.byteLength(output),
          status: 'success',
          errorMessage: null,
          durationMs: Date.now() - startedAt,
        }),
      );

      if (saveResult) {
        await this.resultStorageService.save(history.id, output);
      }

      return { output, historyId: history.id };
    } catch (error) {
      await this.historyRepository.save(
        this.historyRepository.create({
          userId,
          sourceFormat,
          targetFormat,
          inputSize: input.length,
          outputSize: null,
          status: 'error',
          errorMessage: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - startedAt,
        }),
      );
      throw new BadRequestException('Conversion failed');
    }
  }

  async getHistoryForDownload(
    id: string,
    userId: string,
  ): Promise<{ content: string; targetFormat: SupportedFormat }> {
    const history = await this.historyRepository.findOneBy({ id });
    if (!history || history.userId !== userId) {
      throw new NotFoundException();
    }

    const content = await this.resultStorageService.read(history.id);
    return { content, targetFormat: history.targetFormat as SupportedFormat };
  }

  private getHandler(format: SupportedFormat): FormatHandler {
    const handler = FORMAT_HANDLERS[format];
    if (!handler) {
      throw new UnsupportedMediaTypeException(`Unsupported format: ${format}`);
    }
    return handler;
  }

  private assertSizeAllowed(format: SupportedFormat, size: number): void {
    const limit = Number(this.configService.get(MAX_SIZE_BY_FORMAT[format]));
    if (size > limit) {
      throw new PayloadTooLargeException('File too large');
    }
  }
}
