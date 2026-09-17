/* Contact enquiry endpoint — takes the form on contact.html and emails it to the company.
   Reached at /api/enquiry via the redirect in netlify.toml, never at its real path, so the
   frontend stays portable if the site moves host. */
import nodemailer from 'nodemailer';

/* Same rules the browser applies in js/main.js. Repeated here because anything can POST to
   this URL directly — the browser is a convenience, not a gatekeeper. */
const RULES = {
  name:    (v) => v.length >= 2,
  email:   (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v),
  phone:   (v) => /^(\+44\s?|0)[\d\s-]{9,14}$/.test(v),
  message: (v) => v.length >= 10
};

/* Long enough for a genuine enquiry, short enough that nobody can post a novel. */
const LIMITS = { name: 200, company: 200, email: 200, phone: 200, service: 200, from: 20, to: 20, message: 5000 };

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });

/* Header injection guard: a newline in a field would otherwise let someone add their own
   headers to the message. Only ever reached via the subject line, but cheap to be safe. */
const oneLine = (v) => String(v ?? '').replace(/[\r\n]+/g, ' ').trim();

export default async (req) => {
  if (req.method !== 'POST') return json(405, { ok: false, error: 'Method not allowed.' });

  let data;
  try {
    data = await req.json();
  } catch {
    return json(400, { ok: false, error: 'Expected a JSON body.' });
  }

  /* Honeypot: the field is hidden from people, so anything in it came from a bot.
     Answer 200 so it has nothing to learn from being blocked. */
  if (oneLine(data.website)) return json(200, { ok: true });

  const field = (key) => String(data[key] ?? '').trim().slice(0, LIMITS[key] ?? 200);
  const values = {
    name:    field('name'),
    company: field('company'),
    email:   field('email'),
    phone:   field('phone'),
    service: field('service'),
    from:    field('from'),
    to:      field('to'),
    message: field('message')
  };

  const invalid = Object.keys(RULES).filter((key) => !RULES[key](values[key]));
  if (invalid.length) {
    return json(400, { ok: false, error: `Please check these fields: ${invalid.join(', ')}.` });
  }
  if (data.consent !== true) {
    return json(400, { ok: false, error: 'Consent is required before we can reply.' });
  }

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_TO, MAIL_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !MAIL_TO || !MAIL_FROM) {
    console.error('Enquiry not sent: SMTP environment variables are missing.');
    return json(500, { ok: false, error: 'The contact form is not configured yet.' });
  }

  const port = Number(SMTP_PORT) || 465;
  const transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465,          // 465 is implicit TLS; 587 upgrades with STARTTLS
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });

  const lines = [
    `Name:       ${values.name}`,
    `Company:    ${values.company || '—'}`,
    `Email:      ${values.email}`,
    `Phone:      ${values.phone}`,
    `Service:    ${values.service || '—'}`,
    `Collection: ${values.from || '—'}`,
    `Delivery:   ${values.to || '—'}`,
    '',
    'What they are moving:',
    values.message,
    '',
    '—',
    `Consent to be contacted: yes, ticked ${new Date().toISOString()}`,
    'Sent from the contact form on jklogistics.co.uk'
  ];

  try {
    await transport.sendMail({
      /* From has to be the authenticated mailbox or SPF/DMARC drops the message.
         The visitor goes in Reply-To, so hitting Reply in the inbox reaches them. */
      from: MAIL_FROM,
      to: MAIL_TO,
      replyTo: `${oneLine(values.name)} <${values.email}>`,
      subject: `New enquiry — ${oneLine(values.service) || 'General'} — ${oneLine(values.name)}`,
      text: lines.join('\n')
    });
  } catch (err) {
    console.error('Enquiry not sent:', err);
    return json(502, { ok: false, error: 'We could not send that just now.' });
  }

  return json(200, { ok: true });
};
