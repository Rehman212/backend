import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Request,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { GoogleOAuthGuard } from './google-oauth.guard';

class SignupDto {
  email!: string;
  username!: string;
  password!: string;
}

class LoginDto {
  email!: string; // accepts email OR username
  password!: string;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('signup')
  signup(@Body() body: SignupDto) {
    return this.authService.signup(body.email, body.username, body.password);
  }

  @Post('login')
  login(@Body() body: LoginDto) {
    return this.authService.login(body.email, body.password);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Request() req: any) {
    return req.user;
  }

  /** One-time bootstrap: create/promote admin using DESTROY_SECRET */
  @Post('bootstrap-admin')
  bootstrapAdmin(
    @Body()
    body: {
      email: string;
      username: string;
      password: string;
      secret: string;
    },
  ) {
    return this.authService.bootstrapAdmin(
      body.email,
      body.username,
      body.password,
      body.secret,
    );
  }

  /* ── Google OAuth ──────────────────────────────────────────────────────── */
  @Get('google')
  @UseGuards(GoogleOAuthGuard)
  googleAuth() {
    // Passport redirects to Google — nothing to do here
  }

  @Get('google/callback')
  @UseGuards(GoogleOAuthGuard)
  googleCallback(@Request() req: any, @Res() res: Response) {
    const { access_token, user } = this.authService.loginWithGoogle(req.user);
    const frontendUrl =
      this.config.get<string>('FRONTEND_URL') ?? 'https://www.godoclab.com';
    const params = new URLSearchParams({
      token: access_token,
      user: JSON.stringify(user),
    });
    res.redirect(`${frontendUrl}/auth/google/callback?${params.toString()}`);
  }
}
