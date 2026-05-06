import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from './auth/jwt-auth.guard';

@Controller()
export class AppController {
  @UseGuards(JwtAuthGuard)
  @Get('hello-world')
  getHello(@Request() req): string {
    return `Hello World! Welcome, ${req.user.username}`;
  }
}
