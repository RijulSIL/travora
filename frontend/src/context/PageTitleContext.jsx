import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const PageTitleContext = createContext({
  title: '',
  setTitle: () => {},
});

export function PageTitleProvider({ children }) {
  const [title, setTitle] = useState('');
  const value = useMemo(() => ({ title, setTitle }), [title]);

  useEffect(() => {
    document.title = title ? `${title} — Travora` : 'Travora';
  }, [title]);

  return <PageTitleContext.Provider value={value}>{children}</PageTitleContext.Provider>;
}

export function usePageTitle() {
  const ctx = useContext(PageTitleContext);
  return ctx;
}

export function useSetPageTitle(title) {
  const { setTitle } = usePageTitle();
  useEffect(() => {
    setTitle(title);
    return () => setTitle('');
  }, [title, setTitle]);
}
