import { ConfigService } from '@nestjs/config';

export function isGoogleOAuthConfigured(config: ConfigService): boolean {
  return Boolean(
    config.get<string>('GOOGLE_CLIENT_ID') &&
    config.get<string>('GOOGLE_CLIENT_SECRET'),
  );
}
