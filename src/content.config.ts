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
    order: z.number().default(99),
    featured: z.boolean().default(false),
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
    order: z.number().default(99),
    featured: z.boolean().default(false),
    route: z.string().startsWith('/').optional(),
    links: z.array(linkSchema).default([]),
    draft: z.boolean().default(false),
  }),
});

export const collections = { research, projects };
