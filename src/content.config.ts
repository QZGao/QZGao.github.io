import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const linkSchema = z.object({
  label: z.string(),
  url: z.url(),
});

const research = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/research' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    kicker: z.string().default('Research direction'),
    year: z.number().optional(),
    order: z.number().default(99),
    featured: z.boolean().default(false),
    tags: z.array(z.string()).default([]),
    links: z.array(linkSchema).default([]),
    draft: z.boolean().default(false),
  }),
});

const projects = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/projects' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    year: z.number(),
    status: z.enum(['active', 'maintained', 'stable', 'archived']),
    kind: z.enum(['research software', 'open-source tool', 'web utility', 'community project']),
    order: z.number().default(99),
    featured: z.boolean().default(false),
    tags: z.array(z.string()).default([]),
    route: z.string().startsWith('/').optional(),
    links: z.array(linkSchema).default([]),
    draft: z.boolean().default(false),
  }),
});

const writing = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/writing' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    kind: z.enum(['technical notes', 'personal notebook']),
    externalUrl: z.url(),
    order: z.number().default(99),
    draft: z.boolean().default(false),
  }),
});

export const collections = { research, projects, writing };
