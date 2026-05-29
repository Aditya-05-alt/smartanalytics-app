import AuthLayout from '@/components/auth/AuthLayout';
import LoginForm from '@/components/auth/LoginForm';
import { isDemoMode, DEMO_EMAIL, DEMO_PASSWORD } from '@/lib/auth/demo';

export const metadata = {
  title: 'Sign in · SmartAnalytics',
  description: 'Sign in to your SmartAnalytics dealer dashboard.',
};

export default function LoginPage() {
  const demo = isDemoMode();
  return (
    <AuthLayout>
      <LoginForm
        demoMode={demo}
        demoEmail={DEMO_EMAIL}
        demoPassword={DEMO_PASSWORD}
      />
    </AuthLayout>
  );
}
