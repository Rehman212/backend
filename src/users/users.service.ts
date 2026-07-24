import { Injectable, ConflictException, NotFoundException, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not } from 'typeorm';
import { User } from './user.entity';
import * as bcrypt from 'bcrypt';

export type UpdateProfileDto = {
  username?: string;
  email?: string;
  currentPassword?: string;
  newPassword?: string;
};

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly repo: Repository<User>,
  ) {}

  findById(id: number): Promise<User | null> {
    return this.repo.findOne({ where: { id } });
  }

  findByEmailOrUsername(emailOrUsername: string): Promise<User | null> {
    return this.repo.findOne({
      where: [{ email: emailOrUsername }, { username: emailOrUsername }],
    });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.repo.findOne({ where: { email } });
  }

  findByEmailCaseInsensitive(email: string): Promise<User | null> {
    return this.repo
      .createQueryBuilder('user')
      .where('LOWER(user.email) = LOWER(:email)', { email })
      .getOne();
  }

  async create(email: string, username: string, plainPassword: string): Promise<User> {
    const existing = await this.repo.findOne({
      where: [{ email }, { username }],
    });
    if (existing) {
      if (existing.email === email) throw new ConflictException('Email already in use');
      throw new ConflictException('Username already in use');
    }
    const password = await bcrypt.hash(plainPassword, 10);
    const user = this.repo.create({ email, username, password });
    return this.repo.save(user);
  }

  /** Find existing user by email and set admin role, or create fresh admin account */
  async createOrPromoteAdmin(email: string, username: string, plainPassword: string): Promise<User> {
    let user = await this.findByEmailCaseInsensitive(email);
    const password = await bcrypt.hash(plainPassword, 10);
    if (user) {
      user.role = 'admin';
      user.username = username;
      user.password = password;
      return this.repo.save(user);
    }
    user = this.repo.create({ email, username, password, role: 'admin' });
    return this.repo.save(user);
  }

  async findOrCreateGoogleUser(googleId: string, email: string, displayName: string): Promise<User> {
    // 1. Already linked to this Google account
    let user = await this.repo.findOne({ where: { googleId } });
    if (user) return user;

    // 2. Existing account with same email → link it
    user = await this.repo.findOne({ where: { email } });
    if (user) {
      user.googleId = googleId;
      return this.repo.save(user);
    }

    // 3. Brand new user — derive a unique username from displayName
    const base = displayName.replace(/\s+/g, '').toLowerCase().slice(0, 20) || 'user';
    let username = base;
    let attempt = 0;
    while (await this.repo.findOne({ where: { username } })) {
      attempt++;
      username = `${base}${attempt}`;
    }

    const newUser = this.repo.create({ email, username, googleId });
    return this.repo.save(newUser);
  }

  async updateProfile(userId: number, dto: UpdateProfileDto): Promise<User> {
    const user = await this.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    if (dto.username !== undefined) {
      const username = dto.username.trim();
      if (!username) throw new BadRequestException('Name is required');
      if (username !== user.username) {
        const taken = await this.repo.findOne({
          where: { username, id: Not(userId) },
        });
        if (taken) throw new ConflictException('Username already in use');
        user.username = username;
      }
    }

    if (dto.email !== undefined) {
      const email = dto.email.trim().toLowerCase();
      if (!email) throw new BadRequestException('Email is required');
      if (email !== user.email.toLowerCase()) {
        const taken = await this.findByEmailCaseInsensitive(email);
        if (taken && taken.id !== userId) {
          throw new ConflictException('Email already in use');
        }
        user.email = email;
      }
    }

    if (dto.newPassword) {
      if (dto.newPassword.length < 6) {
        throw new BadRequestException('New password must be at least 6 characters');
      }
      if (!user.password) {
        throw new BadRequestException(
          'This account uses Google sign-in and has no password to change',
        );
      }
      if (!dto.currentPassword) {
        throw new BadRequestException('Current password is required to set a new password');
      }
      const match = await bcrypt.compare(dto.currentPassword, user.password);
      if (!match) throw new UnauthorizedException('Current password is incorrect');
      user.password = await bcrypt.hash(dto.newPassword, 10);
    }

    return this.repo.save(user);
  }
}
