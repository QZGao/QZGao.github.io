export const site = {
  name: 'Quinn Gao',
  shortName: 'QG',
  title: 'Researcher and scientific software builder',
  description:
    'Quinn Gao is a physics researcher and software engineer working across computational astrophysics, scientific software, and open knowledge.',
  url: 'https://supergrey.uk',
  email: 'gaoqz.cs@gmail.com',
  affiliation: 'Northeastern University',
  location: 'San Jose, California',
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
  { label: 'Writing', href: '/writing/' },
] as const;
