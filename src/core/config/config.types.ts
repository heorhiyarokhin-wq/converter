export interface Config {
  PORT: number;
  NODE_ENV: 'development' | 'production';

  /**
   * Cookie secret
   */
  COOKIE_SECRET: string;

  /**
   * Health check options
   */
  HEALTH_CHECK_ENABLED?: boolean;

  /**
   * Throttler options
   */
  THROTTLE_GLOBAL_TTL?: number;
  THROTTLE_GLOBAL_LIMIT?: number;

  /**
   * PostgreSQL database options
   */
  POSTGRES_HOST: string;
  POSTGRES_PORT: number;
  POSTGRES_USER: string;
  POSTGRES_PASSWORD: string;
  POSTGRES_DB: string;
  POSTGRES_SYNCHRONIZE?: boolean;
  POSTGRES_LOGGING?: boolean;
  POSTGRES_MIGRATIONS_RUN?: boolean;

  /**
   * JWT auth options
   */
  JWT_SECRET: string;
  JWT_EXPIRES_IN?: string;
  JWT_REFRESH_SECRET: string;
  JWT_REFRESH_EXPIRES_IN?: string;

  /**
   * OTP (login confirmation) options
   */
  OTP_LENGTH?: number;
  OTP_TTL_MINUTES?: number;
  OTP_MAX_ATTEMPTS?: number;
  OTP_RESEND_COOLDOWN_SECONDS?: number;

  /**
   * SMTP (mail sending) options — optional; MailService falls back to
   * console logging when SMTP_URL is not set.
   */
  SMTP_URL?: string;
  MAIL_FROM?: string;

  /**
   * File transformation (CSV/JSON/XML/YAML) size limits, bytes
   */
  CONVERT_MAX_SIZE_CSV?: number;
  CONVERT_MAX_SIZE_JSON?: number;
  CONVERT_MAX_SIZE_XML?: number;
  CONVERT_MAX_SIZE_YAML?: number;
}
