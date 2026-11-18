-- Arise Payroll: default settings and the default (generic) export layout.
-- These are configuration rows, not demo data. Edit the layout in Settings to match your provider.

insert into payroll.export_profiles (id, name, description, columns)
values (
  '00000000-0000-4000-8000-000000000001',
  'Generic review CSV',
  'Neutral layout for review. Map these columns to your payroll provider''s import template before use.',
  '[
    {"header": "Employee ID",         "field": "employee_code"},
    {"header": "Last Name",           "field": "last_name"},
    {"header": "First Name",          "field": "first_name"},
    {"header": "Worker Type",         "field": "worker_type"},
    {"header": "Period Start",        "field": "period_start"},
    {"header": "Period End",          "field": "period_end"},
    {"header": "Pay Date",            "field": "pay_date"},
    {"header": "Regular Hours",       "field": "regular_hours"},
    {"header": "Regular Rate",        "field": "regular_rate"},
    {"header": "Overtime Hours",      "field": "overtime_hours"},
    {"header": "Overtime Rate",       "field": "overtime_rate"},
    {"header": "Rate Effective",      "field": "rate_effective_date"},
    {"header": "Salary",              "field": "salary"},
    {"header": "Clergy Salary",       "field": "clergy_salary"},
    {"header": "Housing Allowance",   "field": "housing_allowance"},
    {"header": "Bonus",               "field": "bonus"},
    {"header": "Other Earnings",      "field": "other_earnings"},
    {"header": "Gross Earnings",      "field": "gross_earnings"},
    {"header": "Reimbursement",       "field": "reimbursement"},
    {"header": "Deduction",           "field": "deduction"},
    {"header": "Contractor Payment",  "field": "contractor_payment"}
  ]'::jsonb
)
on conflict (id) do nothing;

insert into payroll.settings (id, active_export_profile_id)
values (1, '00000000-0000-4000-8000-000000000001')
on conflict (id) do nothing;
