import { Field } from '@/components/ui';
import { WORKER_TYPES, type Employee } from '@/lib/services/staff';

export function EmployeeFields({ e, readOnly }: { e?: Partial<Employee>; readOnly?: boolean }) {
  const d = e ?? {};
  return (
    <fieldset disabled={readOnly} style={{ border: 'none', padding: 0, margin: 0 }}>
      <div className="form-grid">
        <Field label="First name"><input type="text" name="first_name" required defaultValue={d.first_name} /></Field>
        <Field label="Last name"><input type="text" name="last_name" required defaultValue={d.last_name} /></Field>
        <Field label="Staff ID" hint="Must match the ID used at your payroll provider."><input type="text" name="employee_code" required defaultValue={d.employee_code} placeholder="AR-1005" /></Field>
        <Field label="Job title / role"><input type="text" name="job_title" defaultValue={d.job_title} /></Field>
        <Field label="Email"><input type="email" name="email" required defaultValue={d.email} /></Field>
        <Field label="Phone"><input type="tel" name="phone" defaultValue={d.phone} /></Field>
        <Field label="Street address"><input type="text" name="address_line" defaultValue={d.address_line} /></Field>
        <Field label="City"><input type="text" name="city" defaultValue={d.city ?? 'Decatur'} /></Field>
        <Field label="State"><input type="text" name="state" maxLength={2} defaultValue={d.state ?? 'AL'} /></Field>
        <Field label="ZIP"><input type="text" name="postal_code" defaultValue={d.postal_code} /></Field>
        <Field label="Worker type" hint="Changing this reopens the classification review.">
          <select name="worker_type" defaultValue={d.worker_type ?? 'employee'}>
            {WORKER_TYPES.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
          </select>
        </Field>
        <Field label="Pay type" hint="Clergy: salary. Contractors: contract.">
          <select name="pay_type" defaultValue={d.pay_type ?? 'hourly'}>
            <option value="hourly">Hourly</option>
            <option value="salary">Salary</option>
            <option value="contract">Contract (contractor)</option>
          </select>
        </Field>
        <Field label="Overtime status">
          <select name="flsa_status" defaultValue={d.flsa_status ?? 'nonexempt'}>
            <option value="nonexempt">Non-exempt (overtime eligible)</option>
            <option value="exempt">Exempt</option>
            <option value="not_applicable">Not applicable (contractor)</option>
          </select>
        </Field>
        <Field label="Start date"><input type="date" name="start_date" required defaultValue={d.start_date} /></Field>
      </div>
      <label className="check" style={{ marginTop: '0.75rem' }}>
        <input type="checkbox" name="active" defaultChecked={d.active ?? true} /> Active (included in new pay runs)
      </label>
    </fieldset>
  );
}
