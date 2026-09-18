import { parse, stringify } from 'yaml';

import { FormatHandler, SupportedFormat } from './format-handler.abstract';

export class YamlFormatHandler extends FormatHandler {
  readonly format: SupportedFormat = 'yaml';

  parse(input: Buffer): unknown {
    return parse(input.toString('utf-8'));
  }

  serialize(data: unknown): string {
    return stringify(data);
  }
}
