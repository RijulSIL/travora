import { Link } from 'react-router-dom';

export default function Breadcrumbs({ items }) {
  if (!items?.length) return null;
  return (
    <nav className="mb-3 text-xs text-slate-500" aria-label="Breadcrumb">
      {items.map((item, idx) => (
        <span key={`${item.href}-${item.label}`}>
          {idx > 0 ? ' > ' : ''}
          {idx === items.length - 1 ? (
            <span className="font-semibold text-slate-700">{item.label}</span>
          ) : (
            <Link to={item.href} className="hover:underline">
              {item.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
