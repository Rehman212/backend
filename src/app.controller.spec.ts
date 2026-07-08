import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('health', () => {
    it('should return server running status', () => {
      expect(appController.getHealth()).toEqual({
        status: 'ok',
        message: 'Server is running',
        timestamp: expect.any(String),
      });
    });
  });
});
