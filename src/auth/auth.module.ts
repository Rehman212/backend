import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { GoogleStrategy } from './google.strategy';
import { AuthController } from './auth.controller';
import { UsersModule } from '../users/users.module';
import { getRequiredConfig } from '../config/required-config';
import { UsersService } from '../users/users.service';
import { GoogleOAuthGuard } from './google-oauth.guard';
import { isGoogleOAuthConfigured } from './google-oauth.config';

@Module({
  imports: [
    ConfigModule,
    PassportModule,
    UsersModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: getRequiredConfig(config, 'ACCESS_TOKEN_SECRET'),
        signOptions: {
          expiresIn: (config.get<string>('JWT_EXPIRATION') ?? '15m') as any,
        },
      }),
    }),
  ],
  providers: [
    AuthService,
    JwtStrategy,
    GoogleOAuthGuard,
    {
      provide: GoogleStrategy,
      inject: [ConfigService, UsersService],
      useFactory: (config: ConfigService, usersService: UsersService) => {
        if (!isGoogleOAuthConfigured(config)) {
          return null;
        }

        return new GoogleStrategy(config, usersService);
      },
    },
  ],
  controllers: [AuthController],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
