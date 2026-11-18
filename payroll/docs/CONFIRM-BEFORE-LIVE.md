# Confirm before going live

Work through this list with your payroll provider or a qualified payroll professional **before entering real staff or adding any live integration**. It is a set of questions to confirm, not tax or legal advice. The same list appears in the app at **Settings → confirmation checklist** (`/settings/checklist`), sourced from `src/lib/checklist.ts`.

## 1. Worker classification
*With: CPA or payroll professional, church leadership*
- Confirm each worker is correctly classified as an employee or an independent contractor (IRS common-law control test). Record the result on the staff record's review flag.
- Confirm which staff qualify as ministers for tax purposes (ordained, commissioned or licensed, and performing ministerial duties). Only they should be set up as clergy.
- Confirm the current Form 1099-NEC reporting threshold for contractor payments (it changed for payments made in 2026) and that the provider issues 1099s.
- Collect contractor W-9s through the provider or your accountant, never in this app.

## 2. Clergy compensation
*With: CPA familiar with church payroll, payroll provider*
- Ministerial wages: no Social Security/Medicare (FICA) withholding and no employer match; the minister pays self-employment tax (SECA) unless an approved Form 4361 exemption is on file. Confirm the provider is set up this way.
- Voluntary federal income tax withholding (Form W-4 through the provider) to cover income tax and SECA: does each minister want it?
- Housing allowance designated in advance by official action every year; record the reference in Arise Payroll.
- Provider excludes the designated housing allowance from federal taxable wages (W-2 Box 1) and reports it (often Box 14). The exclusion is limited to the least of: amount designated, amount actually spent, fair rental value plus utilities.
- How Alabama income tax treats the housing allowance, and what Alabama withholding the provider applies.
- The clergy split in Arise Payroll (total compensation with a designated housing portion) matches the provider's earnings codes.

## 3. Overtime and hours
*With: payroll professional or employment attorney*
- Whether the FLSA applies to each non-minister employee (individual or enterprise coverage). Ministers are generally outside it.
- Workweek definition, and overtime at 1.5x the regular rate over 40 hours per workweek. Alabama has no separate state overtime law. The app uses the Settings multiplier and the overtime hours the admin enters.
- Which salaried staff are exempt, including the current federal salary threshold.
- How bonuses affect the overtime regular rate, and how mid-period salary changes should be prorated (the app flags these).
- Rounding rules, so Arise Payroll's gross matches the provider to the cent.

## 4. Federal requirements
*With: payroll provider, CPA*
- EIN and deposit schedule; provider files Form 941 (or 944) and W-2/W-3.
- FUTA status (churches are generally exempt) so Form 940 is not filed in error.
- Whether Arise ever filed Form 8274 (church election out of FICA for non-minister employees).
- I-9, W-4 and direct deposit collected through the provider's secure onboarding.
- Record retention: payroll and tax records at least 4 years (IRS); time and pay records at least 3 years (FLSA).

## 5. Alabama requirements
*With: payroll provider, CPA*
- Alabama Department of Revenue withholding account; provider files Alabama withholding returns and the annual reconciliation with W-2s.
- Alabama Form A-4 for each employee through the provider.
- State new-hire reporting (within 7 days of hire).
- Alabama unemployment insurance status for the church.
- Any city or county occupational license tax for Decatur or Morgan County.
- Any temporary Alabama income tax exclusions (for example, overtime) in the current year.

## 6. Payroll provider mapping
*With: payroll admin and the provider*
- Map each field (regular, overtime, salary, clergy salary, housing allowance, bonus, other earnings, reimbursement, deduction, contractor payment) to the provider's import template; update **Settings → Export layout**.
- Staff IDs in Arise Payroll match the provider's employee IDs exactly.
- How contractor payments are processed (provider contractor payments or accounts payable); keep them separate from payroll.
- How the provider handles corrections and voids (off-cycle, next-run adjustment, void and reissue).
- The provider's results report can be saved as CSV with the columns Arise Payroll imports.
- Reimbursements are paid under an accountable plan so they stay non-taxable.

## 7. App security before real data
*With: payroll admin and whoever manages Supabase*
- `DEMO_MODE=false`, and reset the database so no demo accounts or data remain.
- Strong `APP_SECRET` (32+ random characters) kept out of source control. Changing it later forces everyone to re-enroll MFA.
- A Supabase project dedicated to payroll: strong DB password, backups or point-in-time recovery, `DATABASE_CA_CERT` set.
- No Supabase anon or service_role keys in this app; the `payroll` schema is not exposed through the Data API.
- Short list of Payroll Admins and Approvers; keep "Require separate approval" on unless the team is too small.
- HTTPS only (`APP_URL=https://...`).
- Move the app to its own private repository if this repository is ever made public.
