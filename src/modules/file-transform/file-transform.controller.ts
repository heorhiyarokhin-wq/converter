import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { Multipart } from '@fastify/multipart';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { CurrentUser } from '@/core/auth/decorators/current-user.decorator';
import { RequirePermission } from '@/core/rbac/decorators/require-permission.decorator';

import { FileTransformService } from './file-transform.service';
import {
  FORMAT_METADATA,
  SupportedFormat,
} from './formats/format-handler.abstract';
import { FORMAT_HANDLERS } from './formats/format-handlers.map';

const EXTENSION_TO_FORMAT: Record<string, SupportedFormat> = {
  csv: 'csv',
  json: 'json',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
};

const detectFormatByExtension = (filename: string): SupportedFormat => {
  const extension = filename.split('.').pop()?.toLowerCase();
  const format = extension && EXTENSION_TO_FORMAT[extension];
  if (!format) {
    throw new UnsupportedMediaTypeException(
      `Unsupported file extension: ${extension}`,
    );
  }
  return format;
};

const multipartFieldValue = (
  field: Multipart | Multipart[] | undefined,
): unknown => {
  const part = Array.isArray(field) ? field[0] : field;
  if (!part || part.type !== 'field') {
    return undefined;
  }
  return part.value;
};

@Controller('convert')
export class FileTransformController {
  constructor(private readonly fileTransformService: FileTransformService) {}

  @RequirePermission('file-transform', 'convert')
  @Get('formats')
  listFormats() {
    const formats = Object.keys(FORMAT_HANDLERS) as SupportedFormat[];
    return formats.map((source) => ({
      source,
      target: formats.filter((format) => format !== source),
    }));
  }

  @RequirePermission('file-transform', 'convert')
  @Post()
  @HttpCode(HttpStatus.OK)
  async convert(
    @Req() request: FastifyRequest,
    @CurrentUser() user: { id: string },
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    const filePart = await request.file();
    if (!filePart) {
      throw new BadRequestException('file is required');
    }

    // читаем файл до конца ПЕРВЫМ — только после этого fields гарантированно заполнены
    const input = await filePart.toBuffer();
    const targetFormat = multipartFieldValue(
      filePart.fields.targetFormat,
    ) as SupportedFormat;
    const saveResult =
      multipartFieldValue(filePart.fields.saveResult) === 'true';
    const sourceFormat = detectFormatByExtension(filePart.filename);

    const { output } = await this.fileTransformService.convert(
      user.id,
      sourceFormat,
      targetFormat,
      input,
      saveResult,
    );

    this.setDownloadHeaders(reply, targetFormat);
    return output;
  }

  @RequirePermission('file-transform', 'convert')
  @Get('history/:id/download')
  async downloadHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { id: string },
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    const { content, targetFormat } =
      await this.fileTransformService.getHistoryForDownload(id, user.id);

    this.setDownloadHeaders(reply, targetFormat);
    return content;
  }

  private setDownloadHeaders(
    reply: FastifyReply,
    format: SupportedFormat,
  ): void {
    const meta = FORMAT_METADATA[format];
    reply.header('Content-Type', meta.mimeType);
    reply.header(
      'Content-Disposition',
      `attachment; filename="converted.${meta.fileExtension}"`,
    );
  }
}
