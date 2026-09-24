import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/** Editable sections for a public tool URL (/tool/:slug). */
@Entity('tool_pages')
export class ToolPage {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column()
  slug: string;

  @Column({ type: 'varchar', default: '' })
  heroTitle: string;

  @Column({ type: 'text', default: '' })
  heroDescription: string;

  /** Rich HTML: How it works + About body */
  @Column({ type: 'text', default: '' })
  content: string;

  /** JSON: { title: string; body: string }[] */
  @Column({ type: 'text', default: '[]' })
  featuresJson: string;

  /** JSON: { question: string; answer: string }[] */
  @Column({ type: 'text', default: '[]' })
  faqsJson: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
