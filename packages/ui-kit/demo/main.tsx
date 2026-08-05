import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import '@gears-frontx/ui-kit/theme.css';
import { Button, Toaster } from '@gears-frontx/ui-kit';

import { ComponentsPage } from './components-page';
import { Row } from './shared';
import { TokensPage } from './tokens-page';

const PAGES = [
  { route: 'tokens', label: 'Tokens' },
  { route: 'components', label: 'Components' },
] as const;

type Route = (typeof PAGES)[number]['route'];

function parseHash(hash: string): Route {
  return hash.replace(/^#\/?/, '') === 'components' ? 'components' : 'tokens';
}

/** Two-way binding to location.hash, so back/forward and deep links work. */
function useHashRoute(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const follow = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, []);
  useEffect(() => {
    window.location.hash = `/${route}`;
  }, [route]);
  return [route, setRoute];
}

function App() {
  const [theme, setTheme] = useState('auto');
  const [route, setRoute] = useHashRoute();
  useEffect(() => {
    if (theme === 'auto') {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = theme;
    }
  }, [theme]);
  return (
    <main
      style={{
        maxWidth: 960,
        margin: '0 auto',
        padding: 'var(--space-8) var(--space-6)',
        display: 'grid',
        gap: 'var(--space-8)',
        alignContent: 'start',
      }}
    >
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 'var(--space-4)',
          flexWrap: 'wrap',
        }}
      >
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 600 }}>ui-kit demo</h1>
        <nav>
          <Row>
            {PAGES.map((page) => (
              <Button
                key={page.route}
                size="sm"
                variant={route === page.route ? 'secondary' : 'ghost'}
                aria-current={route === page.route ? 'page' : undefined}
                onClick={() => setRoute(page.route)}
              >
                {page.label}
              </Button>
            ))}
          </Row>
        </nav>
        <Row>
          {['auto', 'light', 'dark'].map((mode) => (
            <Button
              key={mode}
              size="sm"
              variant={theme === mode ? 'default' : 'outline'}
              onClick={() => setTheme(mode)}
            >
              {mode}
            </Button>
          ))}
        </Row>
      </header>

      {route === 'tokens' ? <TokensPage /> : <ComponentsPage />}

      <Toaster />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
