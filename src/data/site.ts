export const site = {
  name: 'Quinn Gao',
  title: 'Researcher',
  description:
    'Quinn Gao is a physics researcher with a background in software engineering.',
  url: 'https://supergrey.uk',
  email: 'gaoqz.cs@gmail.com',
  links: [
    { label: 'GitHub', href: 'https://github.com/QZGao' },
    { label: 'LinkedIn', href: 'https://www.linkedin.com/in/quinn-gao' },
    { label: 'English blog', href: 'https://quinn.supergrey.uk/' },
    { label: 'Chinese blog', href: 'https://blog.supergrey.uk/' },
  ],
} as const;

export const navigation = [
  { label: 'Research', href: '/research/' },
  { label: 'Projects', href: '/projects/' },
  { label: 'CV', href: '/cv/' },
] as const;
