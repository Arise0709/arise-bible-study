/** Demo-mode constants. All accounts on this domain are fictional. */
export const DEMO_DOMAIN = 'arise-demo.test';
export const DEMO_PASSWORD = 'AriseDemo2026';

// Fixed MFA secrets for the fictional demo accounts only, so the demo can show live codes.
export const DEMO_MFA = {
  admin: 'JBSWY3DPEHPK3PXPAAAADEMOADMN',
  approver: 'JBSWY3DPEHPK3PXPAAAADEMOAPPR',
  exec: 'JBSWY3DPEHPK3PXPAAAADEMOEXEC',
};

export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === 'true';
}

export const DEMO_ACCOUNTS = [
  { email: `admin@${DEMO_DOMAIN}`, name: 'Dana Whitfield', role: 'Payroll Admin', mfa: DEMO_MFA.admin },
  { email: `approver@${DEMO_DOMAIN}`, name: 'Marcus Bell', role: 'Payroll Approver', mfa: DEMO_MFA.approver },
  { email: `exec@${DEMO_DOMAIN}`, name: 'Ruth Okafor', role: 'Admin + Approver (small team)', mfa: DEMO_MFA.exec },
  { email: `grace@${DEMO_DOMAIN}`, name: 'Grace Holloway', role: 'Staff: salaried', mfa: null },
  { email: `tyrese@${DEMO_DOMAIN}`, name: 'Tyrese Lambert', role: 'Staff: hourly', mfa: null },
  { email: `nathaniel@${DEMO_DOMAIN}`, name: 'Nathaniel Brooks', role: 'Staff: clergy', mfa: null },
  { email: `simone@${DEMO_DOMAIN}`, name: 'Simone Reyes', role: 'Contractor', mfa: null },
];
