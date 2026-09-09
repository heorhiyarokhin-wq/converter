import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import nodemailer, { Transporter } from 'nodemailer';

import { ConfigService } from '@/core/config/config.service';

@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);

  private transporter: Transporter | null = null;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const smtpUrl = this.configService.get('SMTP_URL');

    if (!smtpUrl) {
      this.logger.warn(
        'SMTP_URL not configured — MailService will log instead of sending',
      );
      return;
    }

    const transporter = nodemailer.createTransport(smtpUrl);

    try {
      await transporter.verify();
      this.transporter = transporter;
      this.logger.log('SMTP transport verified and ready');
    } catch (error) {
      // Mail delivery is not a critical dependency (unlike DB/JWT config) —
      // a bad SMTP setup should degrade to logging, not crash the app.
      this.logger.error(
        'SMTP verification failed — falling back to console logging',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async send(to: string, subject: string, body: string): Promise<void> {
    if (!this.transporter) {
      this.logger.log(
        `[MAIL STUB] to=${to} subject="${subject}" body="${body}"`,
      );
      return;
    }

    await this.transporter.sendMail({
      from: this.configService.get('MAIL_FROM'),
      to,
      subject,
      text: body,
    });
  }
}
