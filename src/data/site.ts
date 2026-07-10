export const site = {
  name: 'Quinn Gao',
  title: 'Physics researcher',
  description:
    'Quinn Gao works on computational astrophysics, Bayesian inference, and scientific software.',
  url: 'https://supergrey.uk',
  email: 'gaoqz.cs@gmail.com',
  affiliation: 'Northeastern University',
  links: [
    { label: 'GitHub', href: 'https://github.com/QZGao' },
    { label: 'LinkedIn', href: 'https://www.linkedin.com/in/quinn-gao' },
    { label: 'Technical notes', href: 'https://quinns.bearblog.dev/' },
    { label: 'Personal notebook', href: 'https://supergrey.bearblog.dev/' },
  ],
} as const;

export const navigation = [
  { label: 'Research', href: '/research/' },
  { label: 'Projects', href: '/projects/' },
  { label: 'CV', href: '/cv/' },
] as const;
