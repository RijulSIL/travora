import { useEffect, useState } from 'react';

import BounceLoader from './BounceLoader';

// Most page chunks load in well under this, so the loader only appears when there's a real wait —
// and never flashes straight after the session loader's tick.
const SHOW_AFTER_MS = 250;

export default function PageLoader() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setVisible(true), SHOW_AFTER_MS);
    return () => clearTimeout(id);
  }, []);
  return visible ? <BounceLoader fullScreen={false} /> : <div className="h-screen w-full" />;
}
