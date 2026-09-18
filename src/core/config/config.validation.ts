import Joi from 'joi';

import { Config } from './config.types';

export const configValidationSchema = Joi.object<Config>({
  PORT: Joi.number().port().required(),
  NODE_ENV: Joi.string().valid('development', 'production', 'test').required(),

  /**
   * Cookie secret
   */
  COOKIE_SECRET: Joi.string().required(),

  /**
   * Health check options
   */
  HEALTH_CHECK_ENABLED: Joi.boolean().optional().default(false),

  /**
   * Throttler options
   */
  THROTTLE_GLOBAL_TTL: Joi.number().optional().default(10000),
  THROTTLE_GLOBAL_LIMIT: Joi.number().optional().default(10),

  /**
   * PostgreSQL database options
   */
  POSTGRES_HOST: Joi.string().hostname().required(),
  POSTGRES_PORT: Joi.number().port().required(),
  POSTGRES_USER: Joi.string().required(),
  POSTGRES_PASSWORD: Joi.string().required(),
  POSTGRES_DB: Joi.string().required(),
  POSTGRES_SYNCHRONIZE: Joi.boolean().optional().default(false),
  POSTGRES_LOGGING: Joi.boolean().optional().default(false),
  POSTGRES_MIGRATIONS_RUN: Joi.boolean().optional().default(false),

  /**
   * JWT auth options
   */
  JWT_SECRET: Joi.string().required(),
  JWT_EXPIRES_IN: Joi.string().optional().default('15m'),
  JWT_REFRESH_SECRET: Joi.string().required(),
  JWT_REFRESH_EXPIRES_IN: Joi.string().optional().default('30d'),

  /**
   * OTP (login confirmation) options
   */
  OTP_LENGTH: Joi.number().optional().default(6),
  OTP_TTL_MINUTES: Joi.number().optional().default(10),
  OTP_MAX_ATTEMPTS: Joi.number().optional().default(5),
  OTP_RESEND_COOLDOWN_SECONDS: Joi.number().optional().default(60),

  /**
   * SMTP (mail sending) options
   */
  SMTP_URL: Joi.string().optional(),
  MAIL_FROM: Joi.string().optional(),

  /**
   * File transformation (CSV/JSON/XML/YAML) size limits, bytes
   */
  CONVERT_MAX_SIZE_CSV: Joi.number().optional().default(5_000_000),
  CONVERT_MAX_SIZE_JSON: Joi.number().optional().default(5_000_000),
  CONVERT_MAX_SIZE_XML: Joi.number().optional().default(5_000_000),
  CONVERT_MAX_SIZE_YAML: Joi.number().optional().default(5_000_000),
});
