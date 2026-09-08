import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('site_settings')
export class SiteSettings {
  @PrimaryColumn()
  id: number;

  /** How many published posts to show per page on /blog */
  @Column({ default: 9 })
  blogPostsPerPage: number;
}
