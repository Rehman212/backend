import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('cms_pages')
export class CmsPage {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  title: string;

  @Column({ unique: true })
  slug: string;

  @Column({ type: 'text', default: '' })
  content: string;

  @Column({ default: 'draft' })
  status: 'draft' | 'published';

  @Column({ default: 'public' })
  visibility: 'public' | 'private';

  @Column({ type: 'varchar', nullable: true })
  parentId: string | null;

  @Column({ default: 'default' })
  template: string;

  @Column({ default: 0 })
  order: number;

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
