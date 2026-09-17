import XMLBuilder from 'fast-xml-builder'; // default export — конструктор, не именованный
import { XMLParser } from 'fast-xml-parser';

import { FormatHandler, SupportedFormat } from './format-handler.abstract';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
});
const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: true,
});

export class XmlFormatHandler extends FormatHandler {
  readonly format: SupportedFormat = 'xml';

  parse(input: Buffer): unknown {
    return parser.parse(input.toString('utf-8'));
  }

  serialize(data: unknown): string {
    return builder.build({ root: data });
  }
}
