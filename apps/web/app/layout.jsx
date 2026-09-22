import './globals.css';

export const metadata = {
  title: 'ValidureHR — HR that runs on time',
  description:
    'Attendance, leave, payroll and documents for the whole company, in one place. Built by Validure Solutions for teams that work real shifts.',
  icons: { icon: '/brand/validure-mark.svg' },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  // The theme colour follows the surface behind the status bar in each theme.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f9fb' },
    { media: '(prefers-color-scheme: dark)', color: '#0b1526' },
  ],
};

/* Pinning the theme before first paint is the only way to stop a dark-mode
 * visitor seeing a white flash. It has to run before the body renders, so it
 * cannot live in a component effect. */
const THEME_BOOT = `try{var t=localStorage.getItem('vhr.theme');if(t)document.documentElement.setAttribute('data-theme',t);}catch(e){}`;

export default function RootLayout({ children }) {
  return (
    /* suppressHydrationWarning: the boot script below sets data-theme on
       this element before React hydrates, so the server HTML deliberately
       differs from the client. Without this, that intent reads as a bug. */
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
