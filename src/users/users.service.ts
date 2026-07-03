import { Injectable, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';
import * as bcrypt from 'bcrypt';

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
    let user = await this.repo.findOne({ where: { email } });
    if (user) {
      user.role = 'admin';
      return this.repo.save(user);
    }
    const password = await bcrypt.hash(plainPassword, 10);
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
}
