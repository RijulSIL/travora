import { Link } from 'react-router-dom';

import { useSetPageTitle } from '../context/PageTitleContext';

export default function ComingSoon({
  emoji = '🚧',
  title = 'Coming soon',
  description = 'This area will be enabled in a later phase.',
}) {
  useSetPageTitle(title);

  return (
    <div className="panel mx-auto max-w-lg rounded-lg p-8 text-center">
      <div className="text-4xl" aria-hidden="true">
        {emoji}
      </div>
      <h2 className="mt-4 text-xl font-semibold text-ink">{title}</h2>
      <p className="mt-2 text-sm text-slate-600">{description}</p>
      <Link className="btn-primary mt-6 inline-flex" to="/dashboard">
        Back to home
      </Link>
    </div>
  );
}
