import { FormatHandler, SupportedFormat } from './format-handler.abstract';

export class JsonFormatHandler extends FormatHandler {
  readonly format: SupportedFormat = 'json';

  parse(input: Buffer): unknown {
    return JSON.parse(input.toString('utf-8'));
  }

  serialize(data: unknown): string {
    return JSON.stringify(data, null, 2);
  }
}
