// Thin Resend email sender for magic-link auth. Send-only (no inbound/MX needed).
// No-ops with a console.warn when unconfigured, mirroring the isPodpingConfigured() gate
// in feedUtils.ts so local dev without keys doesn't throw.
const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export interface SendEmailResult {
  ok: boolean;
  status?: number;
  error?: string;
}

/**
 * True when both RESEND_API_KEY and MSP_EMAIL_FROM are set. Callers short-circuit otherwise.
 */
export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.MSP_EMAIL_FROM);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderMagicLinkEmail(link: string, ctx: { feedTitle?: string; purpose: 'login' | 'claim' }): { subject: string; html: string; text: string } {
  const safeLink = escapeHtml(link);
  const action = ctx.purpose === 'claim'
    ? `claim ${ctx.feedTitle ? `"${escapeHtml(ctx.feedTitle)}"` : 'your feed'}`
    : 'sign in to Music Side Project';
  const subject = ctx.purpose === 'claim'
    ? `Claim your MSP feed`
    : `Sign in to Music Side Project`;
  const text = `Click to ${action}:\n\n${link}\n\nThis link expires shortly and can only be used once. If you didn't request it, you can ignore this email.`;
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5">
<p>Click the button below to ${action}.</p>
<p><a href="${safeLink}" style="display:inline-block;padding:10px 18px;background:#7c3aed;color:#fff;border-radius:6px;text-decoration:none">Continue</a></p>
<p style="color:#666;font-size:13px">Or paste this URL into your browser:<br>${safeLink}</p>
<p style="color:#999;font-size:12px">This link expires shortly and can only be used once. If you didn't request it, ignore this email.</p>
</body></html>`;
  return { subject, html, text };
}

/**
 * Send a magic-link email via Resend. Returns ok:false (no throw) when unconfigured or on failure,
 * so callers can decide how to surface it without leaking whether an address exists.
 */
export async function sendMagicLinkEmail(
  to: string,
  link: string,
  ctx: { feedTitle?: string; purpose: 'login' | 'claim' }
): Promise<SendEmailResult> {
  if (!isEmailConfigured()) {
    console.warn('sendMagicLinkEmail: RESEND_API_KEY/MSP_EMAIL_FROM not configured — skipping send');
    return { ok: false, error: 'Email not configured' };
  }

  const { subject, html, text } = renderMagicLinkEmail(link, ctx);

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: process.env.MSP_EMAIL_FROM,
        to,
        subject,
        html,
        text
      })
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.warn(`Resend send failed: ${response.status} ${body}`);
      return { ok: false, status: response.status, error: body || response.statusText };
    }

    return { ok: true, status: response.status };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('Failed to send magic-link email:', message);
    return { ok: false, error: message };
  }
}
