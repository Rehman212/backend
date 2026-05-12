import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly usersService: UsersService,
  ) {}

  async signup(email: string, username: string, password: string) {
    const user = await this.usersService.create(email, username, password);
    return {
      ...this.generateTokens(user.id, user.username),
      user: { id: user.id, email: user.email, username: user.username },
    };
  }

  async login(emailOrUsername: string, password: string) {
    const user = await this.usersService.findByEmailOrUsername(emailOrUsername);
    if (!user) throw new UnauthorizedException('Invalid credentials');
    if (!user.password) throw new UnauthorizedException('This account uses Google sign-in. Please use "Continue with Google".');

    const match = await bcrypt.compare(password, user.password);
    if (!match) throw new UnauthorizedException('Invalid credentials');

    return {
      ...this.generateTokens(user.id, user.username),
      user: { id: user.id, email: user.email, username: user.username },
    };
  }

  loginWithGoogle(user: { id: number; email: string; username: string }) {
    return {
      ...this.generateTokens(user.id, user.username),
      user: { id: user.id, email: user.email, username: user.username },
    };
  }

  private generateTokens(userId: number, username: string) {
    const payload = { username, sub: userId };
    return {
      access_token: this.jwtService.sign(payload),
      refresh_token: this.jwtService.sign(payload, {
        secret: this.config.get<string>('REFRESH_TOKEN_SECRET'),
        expiresIn: this.config.get('JWT_REFRESH_EXPIRATION') as any,
      }),
    };
  }
}
