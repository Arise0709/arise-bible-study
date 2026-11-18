/**
 * Settings to confirm with the payroll provider or a qualified payroll professional before
 * entering real staff or adding a live integration. Shown at /settings/checklist and mirrored
 * in docs/CONFIRM-BEFORE-LIVE.md. These are questions to confirm, not tax advice.
 */
export type ChecklistSection = { title: string; who: string; items: string[] };

export const CHECKLIST: ChecklistSection[] = [
  {
    title: '1. Worker classification',
    who: 'CPA or payroll professional, church leadership',
    items: [
      'Confirm each worker is correctly classified as an employee or an independent contractor (IRS common-law control test: behavioral, financial, relationship). Record the result on the staff record’s review flag.',
      'Confirm which staff qualify as ministers for tax purposes (ordained, commissioned or licensed, and performing ministerial duties). Only they should be set up as clergy.',
      'Confirm the current Form 1099-NEC reporting threshold for contractor payments (the threshold changed for payments made in 2026) and that the provider will issue 1099s.',
      'Collect each contractor’s W-9 through the provider or your accountant, never in this app.',
    ],
  },
  {
    title: '2. Clergy compensation',
    who: 'CPA familiar with church payroll, payroll provider',
    items: [
      'Confirm the provider treats ministerial wages as exempt from Social Security and Medicare (FICA) withholding, with no employer FICA match, and that the minister pays self-employment tax (SECA) unless an approved Form 4361 exemption is on file.',
      'Confirm whether each minister wants voluntary federal income tax withholding (a Form W-4 through the provider) to cover income tax and SECA.',
      'Confirm the housing allowance is designated in advance by official action (board resolution or minutes) each year, and record the reference in Arise Payroll.',
      'Confirm the provider excludes the designated housing allowance from federal taxable wages (W-2 Box 1) and how it reports the amount (often Box 14). The exclusion is limited to the least of the amount designated, the amount actually spent, and the fair rental value of the home plus utilities.',
      'Confirm how Alabama income tax treats the housing allowance and what Alabama withholding, if any, the provider applies for each minister.',
      'Confirm that the clergy pay split (total compensation with a designated housing portion) in Arise Payroll matches the earnings codes at the provider.',
    ],
  },
  {
    title: '3. Overtime and hours',
    who: 'Payroll professional or employment attorney',
    items: [
      'Confirm whether the Fair Labor Standards Act applies to each non-minister employee (individual coverage or enterprise coverage for any commercial activity). Ministers are generally outside it.',
      'Confirm the workweek definition (start day and time) and that overtime is 1.5x the regular rate for hours over 40 in a workweek. Alabama has no separate state overtime law. Arise Payroll uses the multiplier set in Settings and the overtime hours entered by the admin.',
      'Confirm which salaried staff are exempt, including the current federal salary threshold for the exemption.',
      'Confirm how bonuses affect the overtime regular rate for non-exempt staff, and how mid-period salary changes should be prorated.',
      'Confirm rounding rules for time and pay so Arise Payroll’s gross matches the provider to the cent.',
    ],
  },
  {
    title: '4. Federal requirements',
    who: 'Payroll provider, CPA',
    items: [
      'Confirm the church EIN and federal deposit schedule, and that the provider files Form 941 (or 944) and Forms W-2/W-3.',
      'Confirm FUTA status (churches are generally exempt) so the provider does not file Form 940 in error.',
      'Confirm whether Arise has ever filed Form 8274 (church election out of FICA for non-minister employees). This changes how non-minister staff are taxed.',
      'Confirm new-employee paperwork (Form I-9, Form W-4, direct deposit) is collected through the provider’s secure onboarding.',
      'Confirm record retention: keep payroll and tax records at least four years (IRS) and time and pay records at least three years (FLSA).',
    ],
  },
  {
    title: '5. Alabama requirements',
    who: 'Payroll provider, CPA',
    items: [
      'Confirm the church’s Alabama Department of Revenue withholding account and that the provider files the Alabama withholding returns and the annual reconciliation with W-2s.',
      'Confirm each employee completes Alabama Form A-4 through the provider.',
      'Confirm new-hire reporting to the state is handled (Alabama requires it within 7 days of hire).',
      'Confirm Alabama unemployment (state unemployment insurance) status for the church.',
      'Confirm whether any city or county occupational license tax applies to staff working in Decatur or Morgan County.',
      'Ask whether any temporary Alabama income tax exclusions (for example, for overtime pay) apply in the current year.',
    ],
  },
  {
    title: '6. Payroll provider mapping',
    who: 'Payroll admin with the provider',
    items: [
      'Map every Arise Payroll field to the provider’s import template or earnings codes: regular, overtime, salary, clergy salary, housing allowance, bonus, other earnings, reimbursement, deduction, contractor payment. Update Settings → Export layout to match.',
      'Make sure each person’s Staff ID in Arise Payroll matches their employee ID at the provider exactly.',
      'Confirm how contractor payments are processed (provider contractor payments, or accounts payable) and keep them separate from employee payroll.',
      'Confirm how the provider handles corrections and voids (off-cycle run, adjustment on the next run, or void and reissue) so correction runs here mirror it.',
      'Confirm the provider’s results report can be saved as CSV with the columns Arise Payroll imports, or plan a small mapping step.',
      'Confirm reimbursements are paid under an accountable plan (receipts, business purpose, timely) so they stay non-taxable.',
    ],
  },
  {
    title: '7. App security before real data',
    who: 'Payroll admin and whoever manages the Supabase project',
    items: [
      'Set DEMO_MODE=false and reset the database so no demo accounts or demo data remain.',
      'Set a strong APP_SECRET (at least 32 random characters) and keep it out of source control. Changing it later requires everyone to set up MFA again.',
      'Use a Supabase project dedicated to payroll, with a strong database password, point-in-time recovery or daily backups, and DATABASE_CA_CERT set so the database certificate is verified.',
      'Keep the Supabase anon and service_role API keys out of this app. It connects with the database connection string only, and the payroll schema is not exposed through the Supabase Data API.',
      'Decide who holds Payroll Admin and Payroll Approver, keep that list short, and keep “Require separate approval” on unless the team is too small.',
      'Host the app only on HTTPS (set APP_URL to the https:// address) so sign-in cookies are marked secure.',
      'Move the app to its own private repository if this repository is ever made public.',
    ],
  },
];
