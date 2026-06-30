import { ConfigService } from '@nestjs/config';

export function getRequiredConfig(config: ConfigService, key: string): string {
  const value = config.get<string>(key);

  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}
