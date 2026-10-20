import { EmptyState } from '../ui';
import type { EmptyCause } from './filters';

interface Props {
  cause: EmptyCause;
  onSettings: () => void;
  onRefresh: () => void;
  onClearFilters: () => void;
  onClearSearch: () => void;
}

/** The empty list, by its real cause. Each cause has one action. */
export default function JobsEmpty({ cause, onSettings, onRefresh, onClearFilters, onClearSearch }: Props) {
  switch (cause.kind) {
    case 'no-country':
      return <EmptyState cause="Turn on a country to see jobs." detail="Waypoint lists jobs only in the countries that you turn on in Settings." action={{ label: 'Open Settings', onClick: onSettings }} />;
    case 'none-fetched':
      return <EmptyState cause="Waypoint has not fetched any jobs yet." detail="Refresh pulls the jobs from the company boards and the job feeds." action={{ label: 'Refresh', onClick: onRefresh }} />;
    case 'filters':
      return (
        <EmptyState
          cause={`Your filters hide all ${cause.total} ${cause.total === 1 ? 'job' : 'jobs'}.`}
          detail={cause.culprit?.text}
          action={{ label: 'Clear the filters', onClick: onClearFilters }}
        />
      );
    case 'search':
      return <EmptyState cause={`No job matches “${cause.query}”.`} detail="The search looks at the role, the company and the city." action={{ label: 'Clear the search', onClick: onClearSearch }} />;
  }
}
