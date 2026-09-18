export abstract class FileTransformer {
  abstract transform(input: string | Buffer): string | Buffer;

  process(input: string | Buffer): string | Buffer {
    this.validate(input);
    return this.transform(input);
  }

  protected validate(input: string | Buffer): void {
    if (!input || (Buffer.isBuffer(input) && input.length === 0)) {
      throw new Error('Input is empty');
    }
  }
}
