'use client';

import { AuthForm, AuthShell } from '@/components/auth/auth-form';

export default function SignInPage() {
  return (
    <AuthShell title="Sign in to Cre8" subtitle="Pick up where your team left off.">
      <AuthForm mode="signin" />
    </AuthShell>
  );
}
