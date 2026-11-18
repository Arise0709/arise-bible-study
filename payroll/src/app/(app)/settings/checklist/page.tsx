import { Card, PageHeader } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { CHECKLIST } from '@/lib/checklist';

export default async function ChecklistPage() {
  await requireUser(['admin', 'approver']);
  return (
    <>
      <PageHeader
        crumb={{ href: '/settings', label: 'Settings' }}
        title="Confirm before going live"
        subtitle="Work through these with your payroll provider or a qualified payroll professional before entering real staff or adding a live integration. This list is a set of questions to confirm, not tax or legal advice."
      />
      {CHECKLIST.map((section) => (
        <Card key={section.title} title={section.title} actions={<span className="small muted">{section.who}</span>}>
          <ul className="stack" style={{ margin: 0, paddingLeft: '1.2rem' }}>
            {section.items.map((item) => (
              <li key={item} style={{ marginTop: '0.5rem' }}>{item}</li>
            ))}
          </ul>
        </Card>
      ))}
    </>
  );
}
