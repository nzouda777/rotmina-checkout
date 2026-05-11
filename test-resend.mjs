import { Resend } from 'resend';

const resend = new Resend('re_jQjM2LeD_7YQDVZSBka8skoSDF5DZMu45');

resend.emails.send({
  from: 'rotmina Store <noreply@tondomaine.xyz>',
  to: 'test@example.com',
  subject: 'Test',
  html: '<p>Test</p>'
}).then(console.log).catch(console.error);
