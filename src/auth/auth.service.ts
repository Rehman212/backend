import { Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { getRequiredConfig } from '../config/required-config';

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
      ...this.generateTokens(user.id, user.username, user.role),
      user: { id: user.id, email: user.email, username: user.username, role: user.role },
    };
  }

  async login(emailOrUsername: string, password: string) {
    const user = await this.usersService.findByEmailOrUsername(emailOrUsername);
    if (!user) throw new UnauthorizedException('Invalid credentials');
    if (!user.password) throw new UnauthorizedException('This account uses Google sign-in. Please use "Continue with Google".');

    const match = await bcrypt.compare(password, user.password);
    if (!match) throw new UnauthorizedException('Invalid credentials');

    return {
      ...this.generateTokens(user.id, user.username, user.role),
      user: { id: user.id, email: user.email, username: user.username, role: user.role },
    };
  }

  async bootstrapAdmin(email: string, username: string, password: string, secret: string) {
    const expected = this.config.get<string>('DESTROY_SECRET');
    if (!expected || secret !== expected) throw new ForbiddenException('Invalid secret');
    const user = await this.usersService.createOrPromoteAdmin(email, username, password);
    return {
      ...this.generateTokens(user.id, user.username, user.role),
      user: { id: user.id, email: user.email, username: user.username, role: user.role },
    };
  }

  loginWithGoogle(user: { id: number; email: string; username: string; role: string }) {
    return {
      ...this.generateTokens(user.id, user.username, user.role),
      user: { id: user.id, email: user.email, username: user.username, role: user.role },
    };
  }

  private generateTokens(userId: number, username: string, role: string) {
    const payload = { username, sub: userId, role };
    return {
      access_token: this.jwtService.sign(payload),
      refresh_token: this.jwtService.sign(payload, {
        secret: getRequiredConfig(this.config, 'REFRESH_TOKEN_SECRET'),
        expiresIn: (this.config.get<string>('JWT_REFRESH_EXPIRATION') ?? '7d') as any,
      }),
    };
  }
}
