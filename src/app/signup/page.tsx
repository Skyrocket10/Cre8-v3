'use client';

import { AuthForm, AuthShell } from '@/components/auth/auth-form';

export default function SignUpPage() {
  return (
    <AuthShell title="Create your account" subtitle="You get a workspace of your own, and can invite people to it whenever you like.">
      <AuthForm mode="signup" />
    </AuthShell>
  );
}
