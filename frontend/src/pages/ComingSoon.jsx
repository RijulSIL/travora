import { Construction } from 'lucide-react';
import { Link } from 'react-router-dom';

import { useSetPageTitle } from '../context/PageTitleContext';

export default function ComingSoon({
  icon: Icon = Construction,
  title = 'Coming soon',
  description = 'This area will be enabled in a later phase.',
}) {
  useSetPageTitle(title);

  return (
    <div className="panel mx-auto max-w-lg rounded-lg p-8 text-center">
      <div className="flex justify-center text-slate-400" aria-hidden="true">
        <Icon size={40} />
      </div>
      <h2 className="mt-4 text-xl font-semibold text-ink">{title}</h2>
      <p className="mt-2 text-sm text-slate-600">{description}</p>
      <Link className="btn-primary mt-6 inline-flex" to="/dashboard">
        Back to home
      </Link>
    </div>
  );
}
