import { useEffect, useState, type ReactNode } from 'react';
import { ClerkProvider, Show, SignInButton, UserButton, useAuth } from '@clerk/react';
import { Cloud, Save, Download, CheckCircle2 } from 'lucide-react';
import { ProviderClient } from './world/provider';
import type { World } from './world/types';
import { validateWorld } from './world/model';
let tokenGetter: () => Promise<string | null> = async () => null;
export const getAuthToken = () => tokenGetter();
function Bridge() {
  const { getToken } = useAuth();
  useEffect(() => {
    tokenGetter = () => getToken();
    return () => {
      tokenGetter = async () => null;
    };
  }, [getToken]);
  return null;
}
export function AuthProvider({ children }: { children: ReactNode }) {
  const key = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
  return key ? (
    <ClerkProvider publishableKey={key}>
      <Bridge />
      {children}
    </ClerkProvider>
  ) : (
    <>{children}</>
  );
}
export function CloudWorkspace({ world, onLoad }: { world: World; onLoad: (w: World) => void }) {
  const [list, setList] = useState<any[]>([]),
    [link, setLink] = useState<{ id: string; head: string } | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [admin, setAdmin] = useState(false);
  const client = new ProviderClient(undefined, getAuthToken);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage('');
    try {
      await action();
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  };
  const refresh = async () => {
    await client.request('/api/me');
    setAdmin(true);
    setList(await client.request('/api/worlds'));
  };
  if (!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY)
    return (
      <>
        <h2>Connect your workspace.</h2>
        <p>
          Local editing, driving and exports work now. Shared storage requires an isolated World
          Worker, a Clerk application and a database administrator grant.
        </p>
        <p>
          Configure the publishable Clerk key and API URL from the supplied environment examples.
          Administrator membership is checked by the Worker on every request.
        </p>
      </>
    );
  return (
    <>
      <h2>A shared home for your worlds.</h2>
      <Show when="signed-out">
        <p>Sign in, then verify your administrator access.</p>
        <SignInButton mode="modal">
          <button className="primary">Sign in to SlayDrive World</button>
        </SignInButton>
      </Show>
      <Show when="signed-in">
        <UserButton />
        <button className="outline-button" disabled={busy} onClick={() => run(refresh)}>
          <Cloud size={15} />
          Verify admin access & load worlds
        </button>
        {admin && (
          <>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const saved = await client.request(
                    link ? '/api/worlds/' + link.id : '/api/worlds',
                    {
                      method: link ? 'PUT' : 'POST',
                      body: JSON.stringify({ world, expectedHead: link?.head }),
                    },
                  );
                  setLink(saved);
                  setMessage('Immutable cloud revision saved. Draft remains unpublished.');
                  await refresh();
                })
              }
            >
              <Save size={15} />
              {link ? 'Save new cloud revision' : 'Create cloud draft'}
            </button>
            {list.map((w) => (
              <button
                key={w.id}
                className="revision"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const data = await client.request('/api/worlds/' + w.id);
                    onLoad(validateWorld(data.document));
                    setLink({ id: w.id, head: w.head });
                  })
                }
              >
                <Download size={17} />
                <span>
                  <b>{w.title}</b>
                  <small>{w.author}</small>
                </span>
              </button>
            ))}
            {link && (
              <button
                className="outline-button"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await client.request('/api/worlds/' + link.id + '/publish', {
                      method: 'POST',
                      body: JSON.stringify({ revisionId: link.head }),
                    });
                    setMessage(
                      'Publication recorded for this immutable revision. No learner deployment was changed.',
                    );
                  })
                }
              >
                <CheckCircle2 size={15} />
                Record publication of saved revision
              </button>
            )}
          </>
        )}
      </Show>
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
    </>
  );
}
