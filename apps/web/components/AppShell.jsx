'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Home, BadgeCheck, CalendarCheck, Scale, FilePlus2, History, ClipboardCheck,
  FolderOpen, FileText, BookOpen, LayoutGrid, Users, CalendarClock, Calculator,
  Wallet, BarChart3, LineChart, Settings, Mails, ShieldCheck, Building2,
  KeyRound, LogOut, Bell, Menu, X, ChevronDown,
} from 'lucide-react';
import Logo from './Logo';
import ThemeToggle from './ThemeToggle';
import { api, clearSession, fmtDateTime, getSelectedCompany, getToken, getUser, initials } from '@/lib/api';

/* SRS 10.1: HR screens get left open on shared desks, so the session ends
 * after fifteen minutes without input. */
const IDLE_MS = 15 * 60 * 1000;

/*
 * The menu is built from the user's permissions. Anything they have not been
 * granted is ABSENT, not disabled -- a locked door still tells you the room
 * exists, and on an HR system that is itself a disclosure.
 */
function buildMenu(user, company) {
  const has = (k) => user.admin || (user.permissions || []).includes(k);
  const menu = [];

  if (user.admin) {
    menu.push({ items: [{ label: 'Companies', href: '/platform', icon: Building2 }] });
  }

  if (!user.admin) {
    menu.push({ items: [
      { label: 'Home', href: '/home', icon: Home },
      { label: 'My Profile', href: '/profile', icon: BadgeCheck },
    ] });
    menu.push({
      group: 'Attendance & Leave', icon: CalendarCheck, items: [
        { label: 'Attendance', href: '/attendance', icon: CalendarCheck },
        { label: 'Leave Balance', href: '/leave/balance', icon: Scale },
        { label: 'Apply Leave', href: '/leave/apply', icon: FilePlus2 },
        { label: 'Leave History', href: '/leave/history', icon: History },
        ...(has('leaves.approve')
          ? [{ label: 'Approvals', href: '/leave/approvals', icon: ClipboardCheck }] : []),
      ],
    });
    menu.push({
      group: 'Documents', icon: FolderOpen, items: [
        { label: 'Salary Slips', href: '/documents/salary-slips', icon: FileText },
        { label: 'Offer Letter', href: '/documents/offer-letter', icon: BadgeCheck },
        { label: 'Company Policies', href: '/documents/policies', icon: BookOpen },
      ],
    });
  }

  /* A platform admin sees management only once they have opened a company;
   * before that there is no tenant to manage. */
  const inCompany = !user.admin || !!company;
  const mgmt = [];
  if (inCompany) {
    if (has('employees.view')) mgmt.push({ label: 'Overview', href: '/admin', icon: LayoutGrid });
    if (has('employees.view')) mgmt.push({ label: 'Employees', href: '/admin/employees', icon: Users });
    if (has('attendance.view_all')) mgmt.push({ label: 'Attendance', href: '/admin/attendance', icon: CalendarClock });
    if (has('leaves.view_all')) mgmt.push({ label: 'Leave Management', href: '/admin/leaves', icon: ClipboardCheck });
    if (has('balances.manage')) mgmt.push({ label: 'Leave Balances', href: '/admin/balances', icon: Calculator });
    if (has('payroll.view')) mgmt.push({ label: 'Payroll', href: '/admin/payroll', icon: Wallet });
    if (has('documents.manage')) mgmt.push({ label: 'Documents', href: '/admin/documents', icon: FolderOpen });
    if (has('reports.view')) mgmt.push({ label: 'Reports', href: '/admin/reports', icon: BarChart3 });
    if (has('analytics.view')) mgmt.push({ label: 'Analytics', href: '/admin/analytics', icon: LineChart });
    if (has('settings.manage')) mgmt.push({ label: 'Settings', href: '/admin/settings', icon: Settings });
    if (has('settings.manage')) mgmt.push({ label: 'Email Log', href: '/admin/emails', icon: Mails });
    if (user.admin) mgmt.push({ label: 'Roles & Access', href: '/admin/access', icon: ShieldCheck });
  }
  if (mgmt.length) menu.push({ section: 'Management', items: mgmt });

  menu.push({ items: [{ label: 'Change Password', href: '/change-password', icon: KeyRound }] });
  return menu;
}

/* /admin and /platform are deliberately excluded from prefix matching: every
 * management route starts with /admin, so a prefix rule would light up
 * "Overview" on all of them. */
function isActive(pathname, href) {
  if (pathname === href) return true;
  if (href === '/admin' || href === '/platform') return false;
  return pathname.startsWith(href + '/');
}

function NavLink({ item, pathname, onNavigate }) {
  const Icon = item.icon;
  const active = isActive(pathname, item.href);
  return (
    <Link
      className="navlink"
      href={item.href}
      onClick={onNavigate}
      {...(active ? { 'aria-current': 'page' } : {})}
    >
      <Icon size={17} aria-hidden="true" />
      <span>{item.label}</span>
    </Link>
  );
}

function NavGroup({ block, pathname, onNavigate }) {
  const [open, setOpen] = useState(() => block.items.some((i) => isActive(pathname, i.href)));
  const id = 'g-' + block.group.replace(/\W+/g, '');
  const Icon = block.icon;
  return (
    <div className="navsec">
      <button className="navgroup__btn" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <span className="row" style={{ gap: 'var(--s3)' }}>
          <Icon size={17} aria-hidden="true" />{block.group}
        </span>
        <span className="chev"><ChevronDown size={15} aria-hidden="true" /></span>
      </button>
      <div className="navgroup__items" id={id} hidden={!open}>
        {block.items.map((i) => (
          <NavLink key={i.href} item={i} pathname={pathname} onNavigate={onNavigate} />
        ))}
      </div>
    </div>
  );
}

export default function AppShell({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState(null);
  const [company, setCompany] = useState(null);
  const [ready, setReady] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [notifs, setNotifs] = useState([]);
  const [bellOpen, setBellOpen] = useState(false);
  const bellRef = useRef(null);
  const idleTimer = useRef(null);

  /* Gate on the client: the token lives in localStorage, so the server cannot
   * know whether this request is authenticated. Nothing renders until it is. */
  useEffect(() => {
    const u = getUser();
    if (!getToken() || !u) { router.replace('/login'); return; }
    setUser(u);
    setCompany(u.admin ? getSelectedCompany() : u.company);
    setReady(true);
  }, [router, pathname]);

  const loadNotifs = () => {
    if (!user || user.admin) return;
    api('/notifications').then(setNotifs).catch(() => { /* non-critical */ });
  };

  useEffect(() => {
    if (!ready || !user || user.admin) return;
    loadNotifs();
    const t = setInterval(loadNotifs, 30000);
    const onFocus = () => loadNotifs();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, user]);

  useEffect(() => {
    if (!bellOpen) return;
    const away = (e) => { if (bellRef.current && !bellRef.current.contains(e.target)) setBellOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setBellOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [bellOpen]);

  useEffect(() => {
    if (!ready) return;
    const reset = () => {
      clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => {
        clearSession();
        router.replace('/login?timeout=1');
      }, IDLE_MS);
    };
    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(idleTimer.current);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [ready, router]);

  if (!ready || !user) return null;

  const displayName = user.admin
    ? user.username
    : user.employee ? `${user.employee.first_name} ${user.employee.last_name}` : user.username;
  const roleLine = user.admin
    ? 'Platform Admin'
    : `${user.role}${user.employee ? ' · ' + user.employee.emp_code : ''}`;
  const unread = notifs.filter((n) => !n.is_read).length;
  const menu = buildMenu(user, company);
  const close = () => setRailOpen(false);

  const markAllRead = async () => {
    setNotifs((prev) => prev.map((n) => ({ ...n, is_read: true })));
    try { await api('/notifications/read-all', { method: 'PUT' }); } catch { /* optimistic */ }
  };

  const openNotif = async (n) => {
    setBellOpen(false);
    if (!n.is_read) {
      setNotifs((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
      try { await api(`/notifications/${n.id}/read`, { method: 'PUT' }); } catch { /* optimistic */ }
    }
    if (n.link) router.push(n.link);
  };

  const logout = () => { clearSession(); router.replace('/login'); };

  return (
    <div className="shell">
      <a className="skip" href="#main">Skip to content</a>

      <aside className="rail" data-open={railOpen}>
        <div className="rail__brand">
          <Logo size={28} />
          <button className="iconbtn" onClick={close} aria-label="Close navigation"
                  style={{ marginLeft: 'auto' }} data-mobile-only>
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {(company || user.company) && (
          <div className="rail__co">
            <p className="eyebrow eyebrow--plain" style={{ fontSize: 9 }}>Company</p>
            <p style={{ fontSize: '.8125rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {(company || user.company)?.name}
            </p>
          </div>
        )}

        <nav className="rail__nav" aria-label="Main">
          {menu.map((block, i) =>
            block.group ? (
              <NavGroup key={block.group} block={block} pathname={pathname} onNavigate={close} />
            ) : (
              <div className="navsec" key={block.section || i}>
                {block.section && <p className="navsec__label">{block.section}</p>}
                <div style={{ display: 'grid', gap: 2 }}>
                  {block.items.map((item) => (
                    <NavLink key={item.href} item={item} pathname={pathname} onNavigate={close} />
                  ))}
                </div>
              </div>
            )
          )}
        </nav>

        <div className="rail__foot">
          <button className="navlink" onClick={logout} style={{ color: 'var(--err-text)', width: '100%' }}>
            <LogOut size={17} aria-hidden="true" />Sign out
          </button>
        </div>
      </aside>

      <div className="railscrim" data-open={railOpen} onClick={close} />

      <div className="main">
        <header className="topbar">
          <div className="row" style={{ gap: 'var(--s3)', minWidth: 0 }}>
            <button className="iconbtn" onClick={() => setRailOpen(true)} aria-label="Open navigation"
                    aria-expanded={railOpen} data-mobile-only>
              <Menu size={20} aria-hidden="true" />
            </button>
            <p className="faint" style={{ fontSize: '.8125rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {user.admin
                ? (company ? `Managing: ${company.name}` : 'Platform Console')
                : user.company?.name}
            </p>
          </div>

          <div className="row" style={{ gap: 'var(--s2)' }}>
            <ThemeToggle />

            {!user.admin && (
              <div style={{ position: 'relative' }} ref={bellRef}>
                <button
                  className="iconbtn"
                  onClick={() => { const next = !bellOpen; setBellOpen(next); if (next) loadNotifs(); }}
                  aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
                  aria-expanded={bellOpen}
                >
                  <Bell size={19} aria-hidden="true" />
                  {unread > 0 && <span className="count">{unread}</span>}
                </button>

                {bellOpen && (
                  <div className="pop">
                    <div className="pop__head">
                      <span style={{ fontSize: '.75rem', fontWeight: 700 }}>Notifications</span>
                      {unread > 0 && (
                        <button className="btn btn--quiet btn--sm" onClick={markAllRead}>Mark all read</button>
                      )}
                    </div>
                    <div className="pop__list">
                      {notifs.length === 0 ? (
                        <div className="empty" style={{ padding: 'var(--s8) var(--s5)' }}>
                          <p className="faint" style={{ fontSize: '.8125rem' }}>No notifications yet.</p>
                        </div>
                      ) : notifs.map((n) => (
                        <button key={n.id} className={`notif${n.is_read ? '' : ' notif--unread'}`}
                                onClick={() => openNotif(n)}>
                          <span className="notif__top">
                            <span className="notif__title">{n.title}</span>
                            {!n.is_read && <span className="dot" />}
                          </span>
                          <span className="notif__body">{n.body}</span>
                          <span className="notif__time">{fmtDateTime(n.created_at)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="row" style={{ gap: 'var(--s3)', marginLeft: 'var(--s2)' }}>
              <div style={{ textAlign: 'right' }} className="hide-sm">
                <p style={{ fontSize: '.8125rem', fontWeight: 600, lineHeight: 1.3 }}>{displayName}</p>
                <p className="faint" style={{ fontSize: '.6875rem', lineHeight: 1.3 }}>{roleLine}</p>
              </div>
              <span className="avatar">{initials(displayName)}</span>
            </div>
          </div>
        </header>

        <main id="main" tabIndex={-1}>{children}</main>
      </div>
    </div>
  );
}
