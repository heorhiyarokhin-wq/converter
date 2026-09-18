export type SupportedFormat = 'csv' | 'json' | 'xml' | 'yaml';

export abstract class FormatHandler {
  abstract readonly format: SupportedFormat;
  abstract parse(input: Buffer): unknown;
  abstract serialize(data: unknown): string;
}

// статичные факты о форматах — просто данные, не поведение, не нужен абстрактный класс
export const FORMAT_METADATA: Record<
  SupportedFormat,
  { mimeType: string; fileExtension: string }
> = {
  csv: { mimeType: 'text/csv', fileExtension: 'csv' },
  json: { mimeType: 'application/json', fileExtension: 'json' },
  xml: { mimeType: 'application/xml', fileExtension: 'xml' },
  yaml: { mimeType: 'application/x-yaml', fileExtension: 'yaml' },
};
