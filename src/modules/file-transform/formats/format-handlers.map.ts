import { CsvFormatHandler } from './csv-format.handler';
import { FormatHandler, SupportedFormat } from './format-handler.abstract';
import { JsonFormatHandler } from './json-format.handler';
import { XmlFormatHandler } from './xml-format.handler';
import { YamlFormatHandler } from './yaml-format.handler';

export const FORMAT_HANDLERS: Record<SupportedFormat, FormatHandler> = {
  csv: new CsvFormatHandler(),
  json: new JsonFormatHandler(),
  xml: new XmlFormatHandler(),
  yaml: new YamlFormatHandler(),
};
