import './site.css';
import Link from 'next/link';
import Logo from '@/components/Logo';
import ThemeToggle from '@/components/ThemeToggle';

const NAV = [
  ['What it does', '/#features'],
  ['How it works', '/#how'],
  ['Built for shifts', '/#shifts'],
  ['Security', '/#security'],
  ['Pricing', '/pricing'],
];

const FOOTER = [
  ['Product', [
    ['What it does', '/#features'],
    ['How it works', '/#how'],
    ['Built for shifts', '/#shifts'],
    ['Security', '/#security'],
  ]],
  ['Company', [
    ['Validure Solutions', 'https://www.validuresolutions.com/'],
    ['About', 'https://www.validuresolutions.com/#about'],
    ['Work', 'https://www.validuresolutions.com/#work'],
    ['Contact', 'https://www.validuresolutions.com/#contact'],
  ]],
  ['Get started', [
    ['Pricing', '/pricing'],
    ['Sign in', '/login'],
    ['Book a walkthrough', '/#contact'],
  ]],
];

export default function SiteLayout({ children }) {
  return (
    <div className="site">
      <a className="skip" href="#main">Skip to content</a>

      <header className="sitehead">
        <div className="wrap sitehead__in">
          <Link href="/" aria-label="ValidureHR home"><Logo size={28} /></Link>

          <nav className="sitenav" aria-label="Site">
            {NAV.map(([label, href]) => <Link key={href} href={href}>{label}</Link>)}
          </nav>

          <div className="sitehead__cta">
            <ThemeToggle />
            <Link className="btn btn--quiet" href="/login">Sign in</Link>
            <a className="btn btn--primary" href="/#contact">
              <span className="cta-long">Book a walkthrough</span>
              <span className="cta-short">Book a demo</span>
            </a>
          </div>
        </div>
      </header>

      <main id="main" tabIndex={-1}>{children}</main>

      <footer className="sitefoot">
        <div className="wrap">
          <div className="sitefoot__in">
            <div>
              <Logo size={28} />
              <p className="muted" style={{ fontSize: '.875rem', marginTop: 'var(--s4)', maxWidth: '30ch' }}>
                HR software from an engineering studio — built for the way
                Indian teams actually work.
              </p>
            </div>

            {FOOTER.map(([title, links]) => (
              <div key={title}>
                {/* h3, not h4: the last heading before this is the h2 in
                    the closing section, and jumping to h4 skips a level. */}
                <h3>{title}</h3>
                <ul>
                  {links.map(([label, href]) => (
                    <li key={label}>
                      {href.startsWith('http')
                        ? <a href={href}>{label}</a>
                        : <Link href={href}>{label}</Link>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="sitefoot__legal">
            <span>© 2026 Validure Solutions Pvt. Ltd. All rights reserved.</span>
            <span className="mono">ValidureHR v1.0</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
