import { Resend } from 'resend';

export async function sendMagicLink(email: string, link: string) {
  const resend = new Resend(process.env.RESEND_API_KEY);
  await resend.emails.send({
    from: 'Finance Assistant <onboarding@resend.dev>',
    to: email,
    subject: 'Sign in to Finance Assistant',
    html: `<p>Click below to sign in. This link expires in 15 minutes.</p><p><a href="${link}">Sign in to Finance Assistant</a></p>`,
  });
}
