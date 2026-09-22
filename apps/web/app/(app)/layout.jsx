import AppShell from '@/components/AppShell';
import { ToastProvider } from '@/components/ui';

/*
 * Everything behind the sign-in lives in this route group: the shell renders
 * once and survives navigation between screens, so the sidebar does not
 * re-mount and the idle timer is not restarted on every page change.
 */
export default function AppLayout({ children }) {
  return (
    <ToastProvider>
      <AppShell>{children}</AppShell>
    </ToastProvider>
  );
}
