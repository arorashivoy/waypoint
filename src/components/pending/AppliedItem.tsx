import type { AppliedItem as Item } from './sections';

/** An application that went out, with the CV that the company read. */
export default function AppliedItem({ item }: { item: Item }) {
  return (
    <li className="pn-item pn-applied">
      <strong>{item.role}</strong>
      <span className="pn-role">{[item.company, item.city].filter(Boolean).join(', ')}</span>
      {item.cvUrl && (
        <span className="pn-when">
          <a href={item.cvUrl} target="_blank" rel="noreferrer" aria-label={`The CV ${item.company} read`}>The CV they read</a>
          {item.cvLead ? `. It leads with ${item.cvLead}` : ''}
          {item.cvSent ? `. Sent ${item.cvSent}` : ''}
        </span>
      )}
    </li>
  );
}
