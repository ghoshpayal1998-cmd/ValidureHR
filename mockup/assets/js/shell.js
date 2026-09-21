/* ============================================================
   ValidureHR — application shell
   Every page ships only its <main> content; the rail, topbar,
   notification drawer and modals are rendered from here so the
   navigation has exactly one definition.

   This is a MOCKUP. There is no backend and no auth: the "login"
   simply sets a role in localStorage and every screen renders
   from assets/js/data.js.
   ============================================================ */
(function () {
  'use strict';

  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };

  /* ---------------------------------------------------------- icons
     Lucide paths, inlined. One stroke width (2), one visual family. */
  var I = {
    home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
    grid: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
    calendarCheck: '<path d="M8 2v4M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18M9 16l2 2 4-4"/>',
    scale: '<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1"/><path d="M7 21h10M12 3v18M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>',
    filePlus: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v5h5M12 11v6M9 14h6"/>',
    history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5M12 7v5l4 2"/>',
    clipboardCheck: '<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
    folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    fileText: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v5h5M16 13H8M16 17H8M10 9H8"/>',
    badge: '<path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><path d="m9 12 2 2 4-4"/>',
    book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    calendarClock: '<path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5M16 2v4M8 2v4M3 10h18"/><circle cx="18" cy="18" r="4"/><path d="M18 16.5V18l1 1"/>',
    calculator: '<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M8 6h8M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01"/>',
    wallet: '<path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
    barChart: '<path d="M3 3v16a2 2 0 0 0 2 2h16M8 17V9M13 17V5M18 17v-3"/>',
    lineChart: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="m19 9-5 5-4-4-3 3"/>',
    settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    building: '<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M9 22v-4h6v4M9 6h.01M15 6h.01M9 10h.01M15 10h.01M9 14h.01M15 14h.01"/>',
    key: '<path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/><path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    bell: '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
    plus: '<path d="M5 12h14M12 5v14"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4M12 17h.01"/>',
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    eye: '<path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.5 13.5 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61M2 2l20 20"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
    filter: '<path d="M22 3H2l8 9.46V19l4 2v-8.54z"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>'
  };

  function icon(name, size) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + (size || 18) + '" height="' + (size || 18) +
      '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
      'stroke-linejoin="round" aria-hidden="true">' + (I[name] || '') + '</svg>';
  }

  /* ---------------------------------------------------------- theme
     The pre-paint half of this lives inline in each page's <head>
     (see boot()); this only handles the toggle. */
  function applyTheme(t) {
    if (t === 'system') { document.documentElement.removeAttribute('data-theme'); LS.del('vhr.theme'); }
    else { document.documentElement.setAttribute('data-theme', t); LS.set('vhr.theme', t); }
  }
  function currentTheme() {
    var pinned = LS.get('vhr.theme', null);
    if (pinned) return pinned;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function toggleTheme() { applyTheme(currentTheme() === 'dark' ? 'light' : 'dark'); }

  /* ---------------------------------------------------------- role */
  function role() { return LS.get('vhr.role', 'employee'); }
  function setRole(r) { LS.set('vhr.role', r); }

  /* base path back to the site root, from any nesting depth */
  function root() {
    var d = document.currentScript && document.currentScript.getAttribute('data-root');
    return d || document.body.getAttribute('data-root') || '';
  }

  /* ---------------------------------------------------------- nav
     Mirrors F1HR's permission-gated menu. In the mockup the role
     picker in the topbar stands in for the permission set. */
  function menuFor(r) {
    var R = root();
    var employee = [
      { items: [
        { label: 'Home', href: R + 'employee/index.html', icon: 'home' },
        { label: 'My Profile', href: R + 'employee/profile.html', icon: 'badge' }
      ] },
      { group: 'Attendance & Leave', icon: 'calendarCheck', items: [
        { label: 'Attendance', href: R + 'employee/attendance.html', icon: 'calendarCheck' },
        { label: 'Leave Balance', href: R + 'employee/leave/balance.html', icon: 'scale' },
        { label: 'Apply Leave', href: R + 'employee/leave/apply.html', icon: 'filePlus' },
        { label: 'Leave History', href: R + 'employee/leave/history.html', icon: 'history' },
        { label: 'Approvals', href: R + 'employee/leave/approvals.html', icon: 'clipboardCheck' }
      ] },
      { group: 'Documents', icon: 'folder', items: [
        { label: 'Salary Slips', href: R + 'employee/documents/salary-slips.html', icon: 'fileText' },
        { label: 'Offer Letter', href: R + 'employee/documents/offer-letter.html', icon: 'badge' },
        { label: 'Company Policies', href: R + 'employee/documents/policies.html', icon: 'book' }
      ] }
    ];

    var management = { section: 'Management', items: [
      { label: 'Overview', href: R + 'admin/index.html', icon: 'grid' },
      { label: 'Employees', href: R + 'admin/employees.html', icon: 'users' },
      { label: 'Attendance', href: R + 'admin/attendance.html', icon: 'calendarClock' },
      { label: 'Leave Management', href: R + 'admin/leaves.html', icon: 'clipboardCheck' },
      { label: 'Leave Balances', href: R + 'admin/balances.html', icon: 'calculator' },
      { label: 'Payroll', href: R + 'admin/payroll.html', icon: 'wallet' },
      { label: 'Documents', href: R + 'admin/documents.html', icon: 'folder' },
      { label: 'Reports', href: R + 'admin/reports.html', icon: 'barChart' },
      { label: 'Analytics', href: R + 'admin/analytics.html', icon: 'lineChart' },
      { label: 'Settings', href: R + 'admin/settings.html', icon: 'settings' },
      { label: 'Email Log', href: R + 'admin/emails.html', icon: 'mail' }
    ] };

    var m = [];
    if (r === 'platform') {
      m.push({ items: [{ label: 'Companies', href: R + 'platform/index.html', icon: 'building' }] });
      var mgmtPlus = JSON.parse(JSON.stringify(management));
      mgmtPlus.items.push({ label: 'Roles & Access', href: R + 'admin/access.html', icon: 'shield' });
      m.push(mgmtPlus);
    } else if (r === 'hr') {
      m = m.concat(employee);
      m.push(management);
    } else {
      m = employee;
    }
    m.push({ items: [{ label: 'Change Password', href: R + 'change-password.html', icon: 'key' }] });
    return m;
  }

  function isActive(href) {
    var here = location.pathname.replace(/\\/g, '/');
    var target = href.split('/').slice(-2).join('/');
    return here.indexOf(target) !== -1;
  }

  function navLink(item) {
    var active = isActive(item.href);
    return '<a class="navlink" href="' + item.href + '"' + (active ? ' aria-current="page"' : '') + '>' +
      icon(item.icon, 17) + '<span>' + item.label + '</span></a>';
  }

  function renderNav(r) {
    return menuFor(r).map(function (block) {
      if (block.group) {
        var open = block.items.some(function (i) { return isActive(i.href); });
        var id = 'g-' + block.group.replace(/\W+/g, '');
        return '<div class="navsec"><button class="navgroup__btn" aria-expanded="' + open + '" aria-controls="' + id + '">' +
          '<span class="row" style="gap:var(--s3)">' + icon(block.icon, 17) + block.group + '</span>' +
          '<span class="chev">' + icon('chevron', 15) + '</span></button>' +
          '<div class="navgroup__items" id="' + id + '"' + (open ? '' : ' hidden') + '>' +
          block.items.map(navLink).join('') + '</div></div>';
      }
      var head = block.section ? '<p class="navsec__label">' + block.section + '</p>' : '';
      return '<div class="navsec">' + head + '<div style="display:grid;gap:2px">' +
        block.items.map(navLink).join('') + '</div></div>';
    }).join('');
  }

  /* ---------------------------------------------------------- logo
     Two <img> rather than one recoloured file: the master logo is a
     traced 18-step gradient, so there is no single fill to swap and
     a CSS filter would muddy the teal. CSS shows whichever variant
     suits the active theme. */
  function logo(size) {
    var s = size || 28, R = root();
    return '<span class="brandlock">' +
      '<img class="brandmark brandmark--light" src="' + R + 'assets/brand/validure-mark.svg"' +
        ' alt="" width="' + s + '" height="' + s + '">' +
      '<img class="brandmark brandmark--dark" src="' + R + 'assets/brand/validure-mark-dark.svg"' +
        ' alt="" width="' + s + '" height="' + s + '">' +
      '<span class="brandword" style="font-size:' + (s > 30 ? '1.1rem' : '.95rem') + '">' +
      'VALIDURE<em>HR</em></span></span>';
  }

  /* ---------------------------------------------------------- shell */
  function build() {
    var r = role();
    var me = window.VHR_DATA ? window.VHR_DATA.me : { name: 'Ananya Iyer', code: 'VS-0142', role: 'Employee', company: 'Validure Solutions Pvt. Ltd.' };
    var main = document.querySelector('[data-page]');
    if (!main) return;

    var roleLabel = { employee: 'Employee', hr: 'HR Manager', platform: 'Platform Admin' }[r];
    var displayName = r === 'platform' ? 'Rahul Paul' : me.name;
    var initials = displayName.split(' ').map(function (w) { return w[0]; }).slice(0, 2).join('').toUpperCase();

    var notifs = (window.VHR_DATA && window.VHR_DATA.notifications) || [];
    var unread = notifs.filter(function (n) { return !n.read; }).length;

    var rail =
      '<aside class="rail" id="rail">' +
        '<div class="rail__brand">' + logo(26) + '</div>' +
        '<div class="rail__co">' +
          '<p class="eyebrow eyebrow--plain" style="font-size:9px">Company</p>' +
          '<p style="font-size:.8125rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' +
          me.company + '</p>' +
        '</div>' +
        '<nav class="rail__nav" aria-label="Main">' + renderNav(r) + '</nav>' +
        '<div class="rail__foot">' +
          '<a class="navlink" href="' + root() + 'index.html" style="color:var(--err-text)">' +
          icon('logout', 17) + 'Sign out</a>' +
        '</div>' +
      '</aside>' +
      '<div class="railscrim" id="railscrim"></div>';

    var topbar =
      '<header class="topbar">' +
        '<div class="row" style="gap:var(--s3);min-width:0">' +
          '<button class="iconbtn" id="railtoggle" aria-label="Open navigation" aria-expanded="false" ' +
            'style="display:none">' + icon('menu', 20) + '</button>' +
          '<p class="faint" style="font-size:.8125rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' +
            (r === 'platform' ? 'Platform Console' : me.company) + '</p>' +
        '</div>' +
        '<div class="row" style="gap:var(--s2)">' +
          '<label class="sr" for="rolepick">View as role</label>' +
          '<select class="select" id="rolepick" style="width:auto;height:2.25rem;min-height:2.25rem;font-size:.8125rem">' +
            '<option value="employee"' + (r === 'employee' ? ' selected' : '') + '>View as: Employee</option>' +
            '<option value="hr"' + (r === 'hr' ? ' selected' : '') + '>View as: HR Manager</option>' +
            '<option value="platform"' + (r === 'platform' ? ' selected' : '') + '>View as: Platform Admin</option>' +
          '</select>' +
          '<button class="iconbtn themetoggle" id="themebtn" aria-label="Switch theme">' +
            '<span class="i-moon">' + icon('moon', 19) + '</span>' +
            '<span class="i-sun">' + icon('sun', 19) + '</span>' +
          '</button>' +
          '<div style="position:relative" id="bellwrap">' +
            '<button class="iconbtn" id="bell" aria-label="Notifications' + (unread ? ', ' + unread + ' unread' : '') + '" aria-expanded="false">' +
              icon('bell', 19) + (unread ? '<span class="count">' + unread + '</span>' : '') +
            '</button>' +
          '</div>' +
          '<div class="row" style="gap:var(--s3);margin-left:var(--s2)">' +
            '<div style="text-align:right" class="hide-sm">' +
              '<p style="font-size:.8125rem;font-weight:600;line-height:1.3">' + displayName + '</p>' +
              '<p class="faint" style="font-size:.6875rem;line-height:1.3">' + roleLabel +
                (r !== 'platform' ? ' · <span class="mono">' + me.code + '</span>' : '') + '</p>' +
            '</div>' +
            '<span class="avatar">' + initials + '</span>' +
          '</div>' +
        '</div>' +
      '</header>';

    var mockbar = '<div class="mockbar">' + icon('alert', 13) +
      'Interactive mockup — no backend, no authentication. All data is sample data.</div>';

    var wrap = document.createElement('div');
    wrap.className = 'shell';
    wrap.innerHTML = rail + '<div class="main">' + topbar + mockbar + '</div>';
    document.body.insertBefore(wrap, document.body.firstChild);
    wrap.querySelector('.main').appendChild(main);

    var skip = document.createElement('a');
    skip.className = 'skip'; skip.href = '#main'; skip.textContent = 'Skip to content';
    document.body.insertBefore(skip, document.body.firstChild);
    main.id = 'main'; main.setAttribute('tabindex', '-1');

    wire(notifs);
  }

  function wire(notifs) {
    document.getElementById('themebtn').addEventListener('click', toggleTheme);

    document.getElementById('rolepick').addEventListener('change', function (e) {
      setRole(e.target.value);
      location.reload();
    });

    // collapsible nav groups
    Array.prototype.forEach.call(document.querySelectorAll('.navgroup__btn'), function (b) {
      b.addEventListener('click', function () {
        var open = b.getAttribute('aria-expanded') === 'true';
        b.setAttribute('aria-expanded', String(!open));
        document.getElementById(b.getAttribute('aria-controls')).hidden = open;
      });
    });

    // mobile rail
    var rail = document.getElementById('rail'), scrim = document.getElementById('railscrim'),
        toggle = document.getElementById('railtoggle');
    function setRail(open) {
      rail.setAttribute('data-open', String(open));
      scrim.setAttribute('data-open', String(open));
      toggle.setAttribute('aria-expanded', String(open));
    }
    toggle.addEventListener('click', function () { setRail(rail.getAttribute('data-open') !== 'true'); });
    scrim.addEventListener('click', function () { setRail(false); });
    function syncRail() { toggle.style.display = window.innerWidth <= 900 ? 'inline-flex' : 'none'; }
    syncRail(); window.addEventListener('resize', syncRail);

    // notifications
    var bell = document.getElementById('bell'), bellwrap = document.getElementById('bellwrap'), pop = null;
    bell.addEventListener('click', function (e) {
      e.stopPropagation();
      if (pop) { pop.remove(); pop = null; bell.setAttribute('aria-expanded', 'false'); return; }
      pop = document.createElement('div');
      pop.className = 'pop';
      pop.innerHTML =
        '<div class="pop__head"><span style="font-size:.75rem;font-weight:700">Notifications</span>' +
        '<button class="btn btn--quiet btn--sm" id="markall">Mark all read</button></div>' +
        '<div class="pop__list">' + (notifs.length ? notifs.map(function (n) {
          return '<button class="notif' + (n.read ? '' : ' notif--unread') + '">' +
            '<span class="notif__top"><span class="notif__title">' + n.title + '</span>' +
            (n.read ? '' : '<span class="dot"></span>') + '</span>' +
            '<span class="notif__body">' + n.body + '</span>' +
            '<span class="notif__time">' + n.time + '</span></button>';
        }).join('') : '<div class="empty"><p class="faint" style="font-size:.8125rem">No notifications yet.</p></div>') +
        '</div>';
      bellwrap.appendChild(pop);
      bell.setAttribute('aria-expanded', 'true');
      pop.addEventListener('click', function (ev) { ev.stopPropagation(); });
      var ma = pop.querySelector('#markall');
      if (ma) ma.addEventListener('click', function () {
        notifs.forEach(function (n) { n.read = true; });
        var c = bell.querySelector('.count'); if (c) c.remove();
        Array.prototype.forEach.call(pop.querySelectorAll('.notif'), function (el) {
          el.classList.remove('notif--unread');
          var d = el.querySelector('.dot'); if (d) d.remove();
        });
        VHR.toast('All notifications marked read');
      });
    });
    document.addEventListener('click', function () {
      if (pop) { pop.remove(); pop = null; bell.setAttribute('aria-expanded', 'false'); }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && pop) { pop.remove(); pop = null; bell.setAttribute('aria-expanded', 'false'); bell.focus(); }
    });
  }

  /* ---------------------------------------------------------- helpers */
  var VHR = {
    icon: icon,
    logo: logo,
    role: role,
    setRole: setRole,
    theme: { apply: applyTheme, current: currentTheme, toggle: toggleTheme },

    money: function (n) {
      // Indian grouping: 12,34,567
      var s = Math.round(Math.abs(n)).toString(), last3 = s.slice(-3), rest = s.slice(0, -3);
      if (rest) last3 = ',' + last3;
      return (n < 0 ? '-' : '') + '₹' + rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + last3;
    },

    toast: function (msg, kind) {
      var box = document.querySelector('.toasts');
      if (!box) { box = document.createElement('div'); box.className = 'toasts';
        box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
      var t = document.createElement('div');
      t.className = 'toast' + (kind ? ' toast--' + kind : '');
      t.innerHTML = (kind === 'ok' ? icon('check', 16) : kind === 'err' ? icon('alert', 16) : '') +
        '<span>' + msg + '</span>';
      box.appendChild(t);
      setTimeout(function () { t.remove(); }, 4000);
    },

    /* Focus-trapped modal. Returns a close() so callers can drive it. */
    modal: function (opts) {
      var prev = document.activeElement;
      var scrim = document.createElement('div');
      scrim.className = 'scrim';
      scrim.innerHTML =
        '<div class="modal' + (opts.wide ? ' modal--wide' : '') + '" role="dialog" aria-modal="true" aria-labelledby="mt">' +
          '<div class="modal__head"><div><h2 id="mt" style="font-size:1.125rem">' + opts.title + '</h2>' +
          (opts.sub ? '<p class="muted" style="font-size:.8125rem;margin-top:.15rem">' + opts.sub + '</p>' : '') +
          '</div><button class="iconbtn" data-close aria-label="Close">' + icon('x', 18) + '</button></div>' +
          '<div class="modal__body">' + opts.body + '</div>' +
          (opts.foot === null ? '' : '<div class="modal__foot">' + (opts.foot ||
            '<button class="btn btn--ghost" data-close>Cancel</button>' +
            '<button class="btn btn--primary" data-ok>Confirm</button>') + '</div>') +
        '</div>';
      document.body.appendChild(scrim);

      function close() {
        scrim.remove();
        document.removeEventListener('keydown', onKey);
        if (prev && prev.focus) prev.focus();
      }
      function onKey(e) {
        if (e.key === 'Escape') { close(); return; }
        if (e.key !== 'Tab') return;
        var f = scrim.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
      document.addEventListener('keydown', onKey);
      scrim.addEventListener('click', function (e) { if (e.target === scrim) close(); });
      Array.prototype.forEach.call(scrim.querySelectorAll('[data-close]'), function (b) {
        b.addEventListener('click', close);
      });
      var ok = scrim.querySelector('[data-ok]');
      if (ok) ok.addEventListener('click', function () {
        if (opts.onOk) opts.onOk(scrim);
        else { close(); VHR.toast(opts.okToast || 'Saved', 'ok'); }
      });
      var focusTarget = scrim.querySelector('input,select,textarea,[data-ok]') || scrim.querySelector('[data-close]');
      if (focusTarget) focusTarget.focus();
      return close;
    },

    /* Every form in the mockup submits to nothing — intercept and
       confirm, so the screens still demonstrate their feedback. */
    fakeSubmit: function (form, msg) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var btn = form.querySelector('[type=submit]');
        if (btn) {
          var txt = btn.innerHTML;
          btn.disabled = true;
          btn.innerHTML = '<span class="spin">' + icon('clock', 15) + '</span> Working…';
          setTimeout(function () { btn.disabled = false; btn.innerHTML = txt; VHR.toast(msg || 'Saved', 'ok'); }, 700);
        } else VHR.toast(msg || 'Saved', 'ok');
      });
    }
  };

  window.VHR = VHR;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
