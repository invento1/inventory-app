import { Link, useSearchParams } from 'react-router-dom'
import { LinkIcon } from 'lucide-react'
import { Card, CardBody } from '../components/ui/Card'

// Where an invite or password-reset link lands when it can't sign the person
// in (main.tsx routes here). Says why, and what to do next.
export function AuthLinkProblemPage() {
  const [params] = useSearchParams()
  const code = params.get('code')
  const description = params.get('description')
  const expired = code === 'otp_expired' || /expired|invalid/i.test(description ?? '')

  return (
    <div className="flex min-h-svh items-center justify-center bg-surface-muted px-4">
      <div className="w-full max-w-md">
        <Card>
          <CardBody className="flex flex-col items-center gap-3 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-warning-50 text-warning-600">
              <LinkIcon size={20} />
            </span>
            <h1 className="text-lg font-semibold text-text">
              {expired ? 'This link has expired or was already used' : "This link didn't work"}
            </h1>
            <p className="text-sm text-text-muted">
              {expired
                ? 'Invite and password-reset links work once, and expire after 24 hours. Opening the same link a second time, or an older email, shows this page.'
                : description || 'Something went wrong while signing you in from the email link.'}
            </p>
            <div className="w-full rounded-lg bg-surface-muted p-3 text-left text-sm text-text-secondary">
              <p className="font-medium text-text">What to do</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                <li>
                  If you already set a password, just <b>sign in</b>.
                </li>
                <li>
                  Otherwise use <b>Forgot password?</b> on the sign-in page to get a fresh link, or ask whoever added you to
                  press <b>Resend invite</b> (or set a password for you) in Settings → Users.
                </li>
                <li>Use only the newest email: each new link cancels the previous one.</li>
              </ul>
            </div>
            <Link
              to="/login"
              className="mt-1 inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-white hover:bg-primary-hover"
            >
              Go to sign in
            </Link>
            {code && <p className="text-xs text-text-subtle">Code: {code}</p>}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
