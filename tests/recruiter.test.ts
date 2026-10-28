import { describe, expect, it } from 'vitest';
import { pickRecruiter } from '@/lib/recruiter';
import { renderColdEmail } from '@/lib/templates';
import { gmailCompose } from '@/components/job/gmail';

describe('pickRecruiter', () => {
  it('ranks a recruiting title above a higher confidence', () => {
    const r = pickRecruiter([
      { value: 'cto@a.test', type: 'personal', confidence: 99, first_name: 'Cy', last_name: 'Tee', position: 'CTO' },
      { value: 'mia@a.test', type: 'personal', confidence: 70, first_name: 'Mia', last_name: 'Fischer', position: 'Talent Acquisition Partner' },
    ]);
    expect(r?.email).toBe('mia@a.test');
  });
  it('skips generic addresses and rows with no name', () => {
    expect(pickRecruiter([{ value: 'jobs@a.test', type: 'generic', confidence: 90 }, { value: 'x@a.test', type: 'personal' }])).toBeNull();
  });
});

describe('renderColdEmail', () => {
  it('fills the frame and keeps the name in the subject', () => {
    const { subject, body } = renderColdEmail({ firstName: 'Mia', role: 'Engineer', company: 'Acme', jobRef: 'https://a.test/1', candidateName: 'Shivoy Arora', cv: 'my CV is at https://cv.test', highlight: 'Waypoint', hook: 'it asks for Kafka', proof: 'My work on Waypoint used Kafka' });
    expect(subject).toBe('Engineer at Acme: Shivoy Arora');
    expect(body).toContain('Hi Mia,');
    expect(body).toContain('https://a.test/1');
  });
});

describe('gmailCompose', () => {
  it('encodes the recipient, subject and text', () => {
    const url = new URL(gmailCompose({ email: 'a@b.test', subject: 'Hi there', body: 'Line 1\nLine 2' }));
    expect(url.searchParams.get('to')).toBe('a@b.test');
    expect(url.searchParams.get('su')).toBe('Hi there');
    expect(url.searchParams.get('body')).toBe('Line 1\nLine 2');
  });
});
