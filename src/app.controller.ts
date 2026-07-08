import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from './auth/jwt-auth.guard';

type HealthResponse = {
  status: string;
  message: string;
  timestamp: string;
};

@Controller()
export class AppController {
  @Get('health')
  getHealth(): HealthResponse {
    return {
      status: 'ok',
      message: 'Server is running',
      timestamp: new Date().toISOString(),
    };
  }

  @UseGuards(JwtAuthGuard)
  @Get('hello-world')
  getHello(@Request() req): string {
    return `Hello World! Welcome, ${req.user.username}`;
  }
}
