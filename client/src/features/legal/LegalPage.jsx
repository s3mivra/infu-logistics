import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

// The public Customer Privacy Notice (/privacy) and Terms of Use (/terms).
// RA 10173 expects the notice where the information is collected, so both are
// readable without a login and linked from the QR menu, the client portal and
// the staff login. The business's own details come from Settings → Privacy
// contact; everything is rendered as text, never markup.

const API_URL = import.meta.env.VITE_API_URL ?? '';
const BIZ_NAME = import.meta.env.VITE_BUSINESS_NAME || 'this business';
const IS_LOG = (import.meta.env.VITE_BUSINESS_TYPE || 'fb').toLowerCase() === 'log';

function usePrivacyContact() {
  const [contact, setContact] = useState(null);
  useEffect(() => {
    let alive = true;
    fetch(`${API_URL}/api/settings/privacy`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (alive) setContact(d?.privacy || {}); })
      .catch(() => { if (alive) setContact({}); });
    return () => { alive = false; };
  }, []);
  return contact;
}

function formatDate(iso) {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
}

function Section({ title, children }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-black text-fg mb-2">{title}</h2>
      <div className="space-y-3 text-fg/80 text-sm leading-relaxed">{children}</div>
    </section>
  );
}

function List({ items }) {
  return <ul className="list-disc pl-5 space-y-1.5">{items.filter(Boolean).map((t, i) => <li key={i}>{t}</li>)}</ul>;
}

function ContactBlock({ c, name }) {
  const hasDpo = c.dpoName || c.dpoEmail || c.dpoPhone;
  return (
    <div className="rounded-xl border border-fg/15 bg-fg/5 p-4 text-sm text-fg/85 space-y-1">
      <p className="font-bold text-fg">{name}</p>
      {c.tradeName && c.registeredName && c.tradeName !== c.registeredName && <p>Trading as {c.tradeName}</p>}
      {c.address && <p>{c.address}</p>}
      {hasDpo ? (
        <>
          <p className="pt-2 font-bold text-fg">Data Protection Officer{c.dpoName ? `: ${c.dpoName}` : ''}</p>
          {c.dpoEmail && <p>Email: <a className="underline" href={`mailto:${c.dpoEmail}`}>{c.dpoEmail}</a></p>}
          {c.dpoPhone && <p>Phone: {c.dpoPhone}</p>}
        </>
      ) : (
        <p className="pt-2 text-fg/65">Privacy contact details are being set up. Until then, please ask for the manager at the counter.</p>
      )}
    </div>
  );
}

function PrivacyBody({ name }) {
  return (
    <>
      <p className="text-fg/80 text-sm leading-relaxed">
        This notice explains what personal information {name} collects when you order from us or use our {IS_LOG ? 'client portal' : 'table QR menu'},
        why, and what you can do about it. It is given to you under the Data Privacy Act of 2012 (Republic Act No. 10173).
      </p>

      <Section title="1. What we collect">
        <List items={[
          !IS_LOG && 'When you order from a table QR code: the name or nickname you type (so we can call your order), your table, and what you ordered.',
          'When you order at the counter, by phone or for delivery: your name, and where needed your phone number and delivery address.',
          'If you claim a senior citizen or PWD discount: your name and your OSCA or PWD ID number. The law requires us to record these to grant and document the discount. This is sensitive personal information, and we use it for nothing else.',
          IS_LOG && 'If you have a client account: your username and a password (which we store only as a one-way hash that nobody can read), your contact person, phone and email, your registered name, address and TIN for invoices, and your credit terms, orders and payments.',
          'Your receipts and order history, which we must keep as part of our books.',
        ]} />
        <p>We do not use advertising or tracking cookies, and we do not build profiles of you. Your device keeps a small record of your current order in its own storage, so a refresh does not lose it{IS_LOG ? ', and of your sign-in so you stay signed in' : ''}.</p>
      </Section>

      <Section title="2. Why we use it">
        <List items={[
          'To take, prepare, deliver and bill your order - necessary to fulfil what you asked for.',
          'To issue receipts and keep the books tax law requires, and to grant the senior citizen and PWD discounts the law provides.',
          IS_LOG && 'To run your client account: credit, statements, collection and delivery.',
          'To keep our system secure and investigate mistakes or misuse.',
        ]} />
        <p>We do not sell your information, and we do not use it for marketing unless you separately agree.</p>
      </Section>

      <Section title="3. Who we share it with">
        <List items={[
          'Our staff, only as far as their job needs it.',
          'Semivra, the provider of our point-of-sale system, which stores the information for us under a written data processing agreement and may use it only to run the system. Its hosting providers keep the data encrypted in transit and hold it on our behalf.',
          'Government agencies, such as the BIR, when the law requires it.',
        ]} />
      </Section>

      <Section title="4. How long we keep it">
        <p>
          Receipts and the records behind them - including senior citizen and PWD discount details - are kept for as long as tax law requires us to keep
          our books, then deleted. {IS_LOG ? 'Client account details are kept while the account is active and then for the same period as the records they support. ' : ''}
          Information we no longer need is deleted.
        </p>
      </Section>

      <Section title="5. How we protect it">
        <p>
          Access is by individual staff login with permissions, every change is logged against the person who made it, connections are encrypted,
          and passwords are stored only as one-way hashes. {IS_LOG ? 'A client account can see only its own orders. ' : ''}If a breach ever puts your
          information at real risk, we will tell you and the National Privacy Commission as the law requires.
        </p>
      </Section>

      <Section title="6. Your rights">
        <p>Under the Data Privacy Act you may:</p>
        <List items={[
          'be informed of how your information is used - this notice;',
          'ask for a copy of the information we hold about you;',
          'have it corrected if it is wrong;',
          'object to its use, or ask for it to be deleted or blocked, where we have no legal duty to keep it;',
          'receive it in a portable format;',
          'claim damages if you are harmed by its misuse; and',
          'complain to the National Privacy Commission (privacy.gov.ph).',
        ]} />
        <p>Contact us below. We will answer within fifteen (15) working days, and may ask you to confirm who you are first.</p>
      </Section>
    </>
  );
}

function TermsBody({ name }) {
  return (
    <>
      <p className="text-fg/80 text-sm leading-relaxed">
        These terms apply when you order from {name} through our {IS_LOG ? 'client portal' : 'table QR menu'} or at our counter.
        By placing an order you agree to them.
      </p>

      <Section title="1. Orders and prices">
        <List items={[
          'Prices are in Philippine pesos and include VAT where it applies. The receipt shows the final amount.',
          'An order is accepted when we confirm it. We may decline or cancel an order - for example if an item runs out - and will refund anything already paid for it.',
          IS_LOG ? 'Quotations are valid for the period stated on them. Deliveries are made to the address on your account or order.' : 'Please check your order before sending it. Once it is being prepared it may not be possible to change it.',
          'Senior citizen and PWD discounts are granted on presenting a valid ID, as the law provides.',
        ]} />
      </Section>

      <Section title="2. Payment">
        <List items={[
          'Payment is due when the order is served or released, unless you have credit terms with us.',
          IS_LOG && 'On a credit account, invoices are due within your agreed terms. We may pause new orders on an account that is over its limit or overdue.',
          'We issue an official receipt or invoice for every sale.',
        ]} />
      </Section>

      <Section title="3. Your part">
        <List items={[
          IS_LOG ? 'Keep your portal password to yourself. Orders placed under your account are treated as yours.' : 'Use the QR code only for the table you are seated at. A table session ends when the table is closed.',
          'Do not use the system to place false orders, or try to access information that is not yours.',
          !IS_LOG && 'Tell us about allergies or dietary needs before ordering; ingredient information on the menu is a guide only.',
        ]} />
      </Section>

      <Section title="4. Problems and refunds">
        <p>
          If something is wrong with your order, tell us straight away and we will put it right, replace it or refund it. Nothing here limits your
          rights under the Consumer Act of the Philippines (Republic Act No. 7394).
        </p>
      </Section>

      <Section title="5. Your personal information">
        <p>How we handle it is explained in our <Link className="underline font-bold" to="/privacy">Privacy Notice</Link>.</p>
      </Section>

      <Section title="6. Changes and governing law">
        <p>We may update these terms; the version on this page applies to orders placed while it is shown. They are governed by the laws of the Republic of the Philippines.</p>
      </Section>
    </>
  );
}

export default function LegalPage({ doc }) {
  const contact = usePrivacyContact();
  const c = contact || {};
  const name = c.registeredName || c.tradeName || BIZ_NAME;
  const isPrivacy = doc !== 'terms';
  const effective = formatDate(c.effectiveDate);

  useEffect(() => {
    document.title = `${isPrivacy ? 'Privacy Notice' : 'Terms of Use'} · ${name}`;
  }, [isPrivacy, name]);

  return (
    <div className="min-h-[100dvh] bg-page-bg text-fg">
      <main className="max-w-2xl mx-auto px-4 py-10">
        <nav className="flex gap-4 text-xs font-bold uppercase tracking-widest text-fg/65 mb-8">
          <Link to="/privacy" className={isPrivacy ? 'text-brand-text' : 'hover:text-fg'}>Privacy Notice</Link>
          <Link to="/terms" className={!isPrivacy ? 'text-brand-text' : 'hover:text-fg'}>Terms of Use</Link>
        </nav>
        <h1 className="text-3xl font-black text-fg">{isPrivacy ? 'Privacy Notice' : 'Terms of Use'}</h1>
        <p className="text-fg/65 text-sm mt-1 mb-6">{name}{effective ? ` · Effective ${effective}` : ''}</p>

        {contact === null
          ? <p className="text-fg/65 text-sm">Loading…</p>
          : isPrivacy ? <PrivacyBody name={name} /> : <TermsBody name={name} />}

        <Section title="7. Contact us">
          <ContactBlock c={c} name={name} />
        </Section>
      </main>
    </div>
  );
}
