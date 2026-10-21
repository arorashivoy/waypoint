import { plainText } from './sections';

/** The avatar, the name and the company line of a contact. */
export default function Person({ init, who, org }: { init: string; who: string; org: string }) {
  return (
    <div className="pn-person">
      <span className="avatar avatar-light avatar-sm" aria-hidden="true">{init}</span>
      <div className="pn-who">
        <strong>{who}</strong>
        <span>{plainText(org)}</span>
      </div>
    </div>
  );
}
