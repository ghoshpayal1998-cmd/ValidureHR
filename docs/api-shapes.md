# API response shapes

Recorded live against the seeded Validure Solutions company.
Build screens against these, not against what a route name implies.


## employee

### `GET /dashboard`

```
{
  profile: {
    id: number (5)
    emp_code: string ("VS-0113")
    first_name: string ("Ananya")
    last_name: string ("Iyer")
    phone: string ("+91 98450 11724")
    emergency_contact: null
    email: string ("ananya.iyer@validuresolutions.com")
    doj: string ("2023-04-17")
    dob: string ("1993-06-24")
    status: string ("Active")
    probation_until: null
    photo_file: null
    department: string ("Engineering")
    designation: string ("Senior Software Engineer")
    reporting_manager: string ("Vikram Rao")
  }
  widgets: {
    presentDays: number (15)
    absentDays: number (0)
    wfhDays: number (0)
    lateDays: number (0)
    leaveBalance: number (31.5)
    month: string ("2026-09")
    periodLabel: string ("25 Aug – 24 Sep 2026")
    todayPunch: {
      checkIn: string ("19:00")
      checkOut: string ("04:00")
    }
  }
  leaveBalances: [7] of {
    name: string ("Unpaid Leave")
    code: string ("UL")
    monthly_accrual: number (0)
    accrued: number (0)
    used: number (0)
    balance: number (0)
  }
  upcomingHolidays: [4] of {
    date: string ("2026-09-25")
    name: string ("Ganesh Chaturthi")
  }
  upcomingBirthdays: [2] of {
    id: number (19)
    emp_code: string ("VS-0155")
    first_name: string ("Lakshmi")
    last_name: string ("Pillai")
    doj: string ("2024-04-15")
    photo_file: null
    email: string ("lakshmi.pillai@validuresolutions.com")
    phone: string ("+91 98450 17758")
    emergency_contact: null
    department: string ("People")
    designation: string ("Talent Acquisition")
    reporting_manager: string ("Sneha Nair")
    next_birthday: string ("2026-10-04")
  }
  announcements: [4] of {
    title: string ("Ganesh Chaturthi — office closed")
    body: string ("The Bengaluru and Pune offices will be…")
    date: string ("2026-09-14")
  }
  teamLeaves: [] (empty)
  activeEmployees: [24] of {
    id: number (22)
    emp_code: string ("VS-0164")
    first_name: string ("Abhishek")
    last_name: string ("Pandey")
    doj: string ("2025-05-26")
    photo_file: null
    email: string ("abhishek.pandey@validuresolutions.com")
    phone: string ("+91 98450 19051")
    emergency_contact: null
    department: string ("Support")
    designation: string ("Support Engineer")
    reporting_manager: string ("Rahul Chatterjee")
  }
}
```

### `GET /employees/me`

```
{
  id: number (5)
  emp_code: string ("VS-0113")
  first_name: string ("Ananya")
  last_name: string ("Iyer")
  phone: string ("+91 98450 11724")
  email: string ("ananya.iyer@validuresolutions.com")
  doj: string ("2023-04-17")
  dob: string ("1993-06-24")
  department_id: number (1)
  designation_id: number (2)
  reporting_manager_id: number (1)
  status: string ("Active")
  pan_no: null
  bank_name: null
  bank_account_no: null
  bank_ifsc: null
  emergency_contact: null
  probation_until: null
  photo_file: null
  department: string ("Engineering")
  designation: string ("Senior Software Engineer")
  reporting_manager: string ("Vikram Rao")
  user_id: number (5)
  is_active: bool
}
```

### `GET /attendance/me`

```
{
  year: number (2026)
  month: number (9)
  period: {
    from: string ("2026-09-01")
    to: string ("2026-09-30")
    label: string ("September 2026")
  }
  summary: {
    totalWorkingDays: number (21)
    presentDays: number (15)
    absentDays: number (0)
    halfDays: number (0)
    wfhDays: number (0)
    leaveDays: number (1)
    lateMarks: number (0)
  }
  records: [25] of {
    date: string ("2026-09-01")
    status: string ("Present")
    check_in: string ("19:00")
    check_out: string ("04:00")
    late_mark: bool
    remarks: null
    holiday_name: null
  }
}
```

### `GET /leaves/types`

```
[7] of {
  id: number (1)
  name: string ("Unpaid Leave")
  code: string ("UL")
  monthly_accrual: number (0)
}
```

### `GET /leaves/balance`

```
{
  balances: [7] of {
    leave_type_id: number (1)
    name: string ("Unpaid Leave")
    code: string ("UL")
    monthly_accrual: number (0)
    accrued: number (0)
    used: number (0)
    balance: number (0)
  }
  on_probation: bool
  probation_until: null
  ledger: [] (empty)
}
```

### `GET /leaves/history`

```
[1] of {
  id: number (4)
  employee_id: number (5)
  leave_type_id: number (2)
  from_date: string ("2026-09-11")
  to_date: string ("2026-09-11")
  days: number (1)
  reason: string ("Personal work")
  attachment_file: null
  status: string ("Approved")
  decided_by: null
  decided_at: null
  rejection_reason: null
  applied_at: string ("2026-09-22 13:53:04")
  is_unpaid: bool
  leave_type: string ("Casual Leave")
  leave_code: string ("CL")
  emp_code: string ("VS-0113")
  employee_name: string ("Ananya Iyer")
}
```

### `GET /leaves/pending`

```
[3] of {
  id: number (1)
  employee_id: number (8)
  leave_type_id: number (2)
  from_date: string ("2026-09-24")
  to_date: string ("2026-09-25")
  days: number (2)
  reason: string ("Family function in Mysuru")
  attachment_file: null
  status: string ("Pending")
  decided_by: null
  decided_at: null
  rejection_reason: null
  applied_at: string ("2026-09-22 13:53:04")
  is_unpaid: bool
  leave_type: string ("Casual Leave")
  leave_code: string ("CL")
  emp_code: string ("VS-0122")
  employee_name: string ("Arjun Kulkarni")
}
```

### `GET /documents/salary-slips`

```
[] (empty)
```

### `GET /documents/offer-letters`

```
[] (empty)
```

### `GET /documents/policies`

```
[] (empty)
```

### `GET /notifications`

```
[] (empty)
```


## admin

### `GET /admin/overview`

```
{
  totals: {
    employees: number (24)
    activeEmployees: number (24)
    departments: number (12)
    pendingLeaves: number (3)
  }
  todayAttendance: [1] of {
    status: string ("Present")
    c: number (24)
  }
  deptStrength: [12] of {
    name: string ("Engineering")
    c: number (7)
  }
  recentLeaves: [3] of {
    id: number (1)
    from_date: string ("2026-09-24")
    to_date: string ("2026-09-25")
    days: number (2)
    status: string ("Pending")
    leave_code: string ("CL")
    emp_code: string ("VS-0122")
    employee_name: string ("Arjun Kulkarni")
  }
  recentAudit: [5] of {
    actor: string ("VS-0113")
    action: string ("LOGIN")
    details: string ("EMPLOYEE login (VS-0113)")
    timestamp: string ("2026-09-22 17:04:13")
  }
  today: string ("2026-09-22")
}
```

### `GET /admin/analytics` — **403**

```
Missing permission: analytics.view
```

### `GET /admin/reports/attendance-summary?month=2026-09`

```
{
  year: number (2026)
  month: number (2026)
  period: {
    from: string ("2026-2025-25")
    to: string ("2026-2026-24")
  }
  rows: [24] of {
    emp_code: string ("VS-0101")
    name: string ("Vikram Rao")
    department: string ("Engineering")
    present: number (0)
    wfh: number (0)
    half_days: number (0)
    absent: number (0)
    leave: number (0)
    late_marks: number (0)
  }
}
```

### `GET /admin/reports/leave-summary?month=2026-09`

```
{
  rows: [24] of {
    emp_code: string ("VS-0101")
    name: string ("Vikram Rao")
    UL: {
      accrued: number (0)
      used: number (0)
      balance: number (0)
    }
    CL: {
      accrued: number (9)
      used: number (0)
      balance: number (9)
    }
    SL: {
      accrued: number (9)
      used: number (0)
      balance: number (9)
    }
    EL: {
      accrued: number (13.5)
      used: number (0)
      balance: number (13.5)
    }
    CO: {
      accrued: number (0)
      used: number (0)
      balance: number (0)
    }
    ML: {
      accrued: number (0)
      used: number (0)
      balance: number (0)
    }
    LOP: {
      accrued: number (0)
      used: number (0)
      balance: number (0)
    }
  }
}
```

### `GET /admin/departments`

```
[12] of {
  id: number (5)
  name: string ("Data")
}
```

### `GET /admin/designations`

```
[23] of {
  id: number (14)
  title: string ("Business Analyst")
}
```

### `GET /admin/holidays`

```
[10] of {
  id: number (1)
  date: string ("2026-01-26")
  name: string ("Republic Day")
}
```

### `GET /admin/announcements`

```
[4] of {
  id: number (1)
  title: string ("Ganesh Chaturthi — office closed")
  body: string ("The Bengaluru and Pune offices will be…")
  date: string ("2026-09-14")
}
```

### `GET /admin/org-settings`

```
{
  cycle_start_day: number (25)
  cycle_end_day: number (24)
  cycle_example: string ("25 Aug – 24 Sep 2026")
  accrual_day: number (24)
  default_probation_months: number (0)
}
```

### `GET /admin/audit-logs`

```
[5] of {
  id: number (5)
  user_id: number (5)
  actor: string ("VS-0113")
  action: string ("LOGIN")
  details: string ("EMPLOYEE login (VS-0113)")
  timestamp: string ("2026-09-22 17:04:13")
}
```

### `GET /admin/email-log?limit=20`

```
[] (empty)
```

### `GET /employees`

```
[24] of {
  id: number (1)
  emp_code: string ("VS-0101")
  first_name: string ("Vikram")
  last_name: string ("Rao")
  phone: string ("+91 98450 10000")
  email: string ("vikram.rao@validuresolutions.com")
  doj: string ("2021-02-08")
  dob: string ("1984-03-12")
  department_id: number (1)
  designation_id: number (4)
  reporting_manager_id: null
  status: string ("Active")
  pan_no: null
  bank_name: null
  bank_account_no: null
  bank_ifsc: null
  emergency_contact: null
  probation_until: null
  photo_file: null
  department: string ("Engineering")
  designation: string ("Engineering Manager")
  reporting_manager: null
  user_id: number (1)
  is_active: bool
}
```

### `GET /employees/meta`

```
{
  departments: [12] of {
    id: number (5)
    name: string ("Data")
  }
  designations: [23] of {
    id: number (14)
    title: string ("Business Analyst")
  }
  managers: [24] of {
    id: number (1)
    emp_code: string ("VS-0101")
    name: string ("Vikram Rao")
  }
  roles: [4] of {
    id: number (2)
    name: string ("DIRECTOR")
    is_system: bool
  }
}
```

### `GET /attendance/overview?month=2026-09`

```
{
  date: string ("2026-09-22")
  holiday_name: null
  rows: [24] of {
    employee_id: number (1)
    emp_code: string ("VS-0101")
    name: string ("Vikram Rao")
    department: string ("Engineering")
    status: string ("Present")
    late_mark: bool
    check_in: string ("19:00")
    check_out: string ("04:00")
  }
}
```

### `GET /attendance/device-map` — **403**

```
Platform admin access required
```

### `GET /leaves`

```
[8] of {
  id: number (1)
  employee_id: number (8)
  leave_type_id: number (2)
  from_date: string ("2026-09-24")
  to_date: string ("2026-09-25")
  days: number (2)
  reason: string ("Family function in Mysuru")
  attachment_file: null
  status: string ("Pending")
  decided_by: null
  decided_at: null
  rejection_reason: null
  applied_at: string ("2026-09-22 13:53:04")
  is_unpaid: bool
  leave_type: string ("Casual Leave")
  leave_code: string ("CL")
  emp_code: string ("VS-0122")
  employee_name: string ("Arjun Kulkarni")
}
```

### `GET /leaves/calendar?month=2026-09`

```
{
  year: number (2026)
  month: number (2026)
  period: {
    from: string ("2026-2025-25")
    to: string ("2026-2026-24")
  }
  leaves: [] (empty)
}
```

### `GET /balances`

```
{
  types: [7] of {
    id: number (1)
    name: string ("Unpaid Leave")
    code: string ("UL")
    monthly_accrual: number (0)
  }
  employees: [24] of {
    emp_code: string ("VS-0101")
    employee_id: number (1)
    name: string ("Vikram Rao")
    balances: {
      1: {
        accrued: number (0)
        used: number (0)
        balance: number (0)
        last_accrued: string ("2026-09")
      }
      2: {
        accrued: number (9)
        used: number (0)
        balance: number (9)
        last_accrued: string ("2026-09")
      }
      3: {
        accrued: number (9)
        used: number (0)
        balance: number (9)
        last_accrued: string ("2026-09")
      }
      4: {
        accrued: number (13.5)
        used: number (0)
        balance: number (13.5)
        last_accrued: string ("2026-09")
      }
      5: {
        accrued: number (0)
        used: number (0)
        balance: number (0)
        last_accrued: string ("2026-09")
      }
      6: {
        accrued: number (0)
        used: number (0)
        balance: number (0)
        last_accrued: string ("2026-09")
      }
      7: {
        accrued: number (0)
        used: number (0)
        balance: number (0)
        last_accrued: string ("2026-09")
      }
    }
  }
  current_period: string ("2026-09")
}
```

### `GET /balances/accrual-day`

```
{
  accrual_day: number (24)
}
```

### `GET /payroll/structures`

```
[24] of {
  employee_id: number (22)
  emp_code: string ("VS-0164")
  first_name: string ("Abhishek")
  last_name: string ("Pandey")
  department: string ("Support")
  designation: string ("Support Engineer")
  basic: number (0)
  hra: number (0)
  special_allowance: number (0)
  conveyance: number (1600)
  pf_deduction: number (0)
  esic_deduction: number (0)
  tax_deduction: number (0)
  bank_name: null
  bank_account_no: null
  bank_ifsc: null
  pan_no: null
}
```

### `GET /payroll/lop/2026/9`

```
{
  period: {
    from: string ("2026-08-25")
    to: string ("2026-09-24")
    days: number (31)
    label: string ("25 Aug – 24 Sep 2026")
  }
  rows: [24] of {
    employee_id: number (23)
    lop_days: number (0)
    el_days: number (0)
    sl_days: number (0)
    wfh_days: number (0)
  }
}
```

### `GET /access/permissions`

```
[12] of {
  key: string ("employees.view")
  label: string ("View employees")
}
```

### `GET /access/roles`

```
[4] of {
  id: number (2)
  name: string ("DIRECTOR")
  is_system: bool
  permissions: [12] of string ("employees.view")
}
```

### `GET /access/users` — **403**

```
Platform admin access required
```


## platform

### `GET /companies` — **403**

```
Platform admin access required
```

## platform admin only

These need `admin: true`. The HR role is refused, which is correct -- they are platform-level, not tenant-level.

### `GET /companies`

```
[1] of {
  id: number (2)
  name: string ("Validure Solutions Pvt. Ltd.")
  slug: string ("vs")
  schema_name: string ("c_vs")
  status: string ("Active")
  created_at: string ("2026-09-22 13:53:02")
  has_device_attendance: bool
  employees: number (24)
  pending_leaves: number (3)
}
```

### `GET /access/users`

```
[24] of {
  id: number (1)
  username: string ("VS-0101")
  email: string ("vikram.rao@validuresolutions.com")
  role: string ("OWNER")
  role_permissions: [12] of string ("employees.view")
  name: string ("Vikram Rao")
  extra_permissions: [] (empty)
}
```

### `GET /access/roles`

```
[4] of {
  id: number (2)
  name: string ("DIRECTOR")
  is_system: bool
  permissions: [12] of string ("employees.view")
}
```

### `GET /attendance/device-map` — **404**

```
Device attendance is not enabled for this company
```

### `GET /admin/analytics`

```
{
  attendanceTrend: [6] of {
    month: string ("2026-04")
    rate: number (0)
  }
  leaveByType: [7] of {
    name: string ("Unpaid Leave")
    code: string ("UL")
    days: number (0)
    applications: number (0)
  }
  deptHeadcount: [12] of {
    name: string ("Engineering")
    c: number (7)
  }
  lateTop: [5] of {
    emp_code: string ("VS-0152")
    name: string ("Manish Gupta")
    late_marks: number (4)
  }
  leaveStatusSplit: [3] of {
    status: string ("Pending")
    c: number (3)
  }
}
```
