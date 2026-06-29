import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('blog_posts')
export class BlogPost {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  title: string;

  @Column({ unique: true })
  slug: string;

  @Column({ type: 'text', default: '' })
  excerpt: string;

  @Column({ type: 'text', default: '' })
  content: string;

  @Column({ default: 'draft' })
  status: 'draft' | 'published';

  @Column({ default: 'Admin' })
  author: string;

  @Column({ default: '' })
  seoTitle: string;

  @Column({ type: 'text', default: '' })
  seoDescription: string;

  @Column({ default: '' })
  seoKeywords: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
