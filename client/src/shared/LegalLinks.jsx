// "By ordering you agree to our Terms and Privacy Notice" - shown where
// personal information is collected. Opens in a new tab so a customer mid-order
// or mid-sign-in does not lose their place.
export default function LegalLinks({ lead = 'By continuing you agree to our', className = '' }) {
  const a = 'underline font-bold hover:text-fg';
  return (
    <p className={`text-fg/65 text-xs text-center leading-relaxed ${className}`}>
      {lead}{' '}
      <a className={a} href="/terms" target="_blank" rel="noopener">Terms of Use</a>
      {' '}and{' '}
      <a className={a} href="/privacy" target="_blank" rel="noopener">Privacy Notice</a>.
    </p>
  );
}
