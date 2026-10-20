export interface WayInProps {
  contact: string;
  company: string;
  you?: string;
}

/** "You, contact, company" as small lavender stops on one line. */
export function WayIn({ contact, company, you = 'You' }: WayInProps) {
  return (
    <ol className="ui-wayin" aria-label="Your way in">
      {[you, contact, company].map((name, i) => (
        <li key={i}>{name}</li>
      ))}
    </ol>
  );
}
