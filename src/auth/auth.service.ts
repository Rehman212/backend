import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

// Demo users — replace with a real DB/user service later
const USERS = [
  { id: 1, username: 'admin', password: 'password123' },
  { id: 2, username: 'alice', password: 'alice123' },
];

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    private config: ConfigService,
  ) {}

  login(username: string, password: string) {
    const user = USERS.find(
      (u) => u.username === username && u.password === password,
    );
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const payload = { username: user.username, sub: user.id };

    const access_token = this.jwtService.sign(payload);

    const refresh_token = this.jwtService.sign(payload, {
      secret: this.config.get<string>('REFRESH_TOKEN_SECRET'),
      expiresIn: this.config.get('JWT_REFRESH_EXPIRATION') as any,
    });

    return { access_token, refresh_token };
  }
}
