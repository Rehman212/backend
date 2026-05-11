import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

@Entity('conversion_records')
export class ConversionRecord {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  toolSlug: string;

  @Column({ default: '' })
  originalFileName: string;

  @Column({ default: '' })
  outputFileName: string;

  @Column({ nullable: true })
  s3Key: string;

  @Column({ nullable: true })
  s3Url: string;

  @Column({ type: 'bigint', default: 0 })
  fileSize: number;

  @CreateDateColumn()
  createdAt: Date;
}
