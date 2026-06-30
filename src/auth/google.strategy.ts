import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import { getRequiredConfig } from '../config/required-config';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(
    config: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      clientID: getRequiredConfig(config, 'GOOGLE_CLIENT_ID'),
      clientSecret: getRequiredConfig(config, 'GOOGLE_CLIENT_SECRET'),
      callbackURL: `${config.get<string>('BACKEND_URL') ?? 'https://api.godoclab.com'}/api/auth/google/callback`,
      scope: ['email', 'profile'],
    });
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: any,
    done: VerifyCallback,
  ): Promise<void> {
    const email = profile.emails?.[0]?.value ?? '';
    const displayName =
      profile.displayName ?? profile.name?.givenName ?? 'user';
    const googleId = profile.id;

    try {
      const user = await this.usersService.findOrCreateGoogleUser(
        googleId,
        email,
        displayName,
      );
      done(null, user);
    } catch (err) {
      done(err as Error);
    }
  }
}
