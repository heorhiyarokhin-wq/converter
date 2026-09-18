import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

import { FormatHandler, SupportedFormat } from './format-handler.abstract';

export class CsvFormatHandler extends FormatHandler {
  readonly format: SupportedFormat = 'csv';

  parse(input: Buffer): unknown {
    return parse(input, { columns: true, skip_empty_lines: true });
  }

  serialize(data: unknown): string {
    return stringify(data as Record<string, unknown>[], { header: true });
  }
}
