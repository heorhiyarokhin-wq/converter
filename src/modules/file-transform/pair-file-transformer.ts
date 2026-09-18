import { FileTransformer } from './file-transformer.abstract';
import { FormatHandler } from './formats/format-handler.abstract';

export class PairFileTransformer extends FileTransformer {
  constructor(
    private readonly source: FormatHandler,
    private readonly target: FormatHandler,
  ) {
    super();
  }

  transform(input: string | Buffer): string {
    const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);

    const internal = this.source.parse(buffer);
    return this.target.serialize(internal);
  }
}
