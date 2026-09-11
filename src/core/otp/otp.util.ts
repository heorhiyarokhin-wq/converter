import { randomInt } from 'crypto';

export function generateOtpCode(length: number): string {
  return randomInt(0, 10 ** length)
    .toString()
    .padStart(length, '0');
}
