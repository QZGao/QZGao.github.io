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
    citation: z.string(),
    order: z.number(),
    links: z.array(linkSchema).default([]),
  }),
});

const projects = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/projects' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    year: z.string(),
    archived: z.boolean().default(false),
    category: z.enum(['academic', 'toolkit', 'wikipedia']),
    order: z.number(),
    links: z.array(linkSchema).default([]),
  }),
});

export const collections = { research, projects };
