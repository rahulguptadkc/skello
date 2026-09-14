import "server-only";

import crypto from "crypto";

/**
 * Generate a secure, human-readable temporary password.
 * Format: 10-12 characters with uppercase, lowercase, digits, and safe symbols.
 */
export function generateRandomPassword(): string {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz";
  const numbers = "23456789";
  const symbols = "!@#$%&*";

  let password = "";
  // Ensure at least 1 uppercase, 1 lowercase, 1 number, 1 symbol
  password += letters[Math.floor(Math.random() * 24)]; // uppercase
  password += letters[24 + Math.floor(Math.random() * 24)]; // lowercase
  password += numbers[Math.floor(Math.random() * numbers.length)];
  password += symbols[Math.floor(Math.random() * symbols.length)];

  const allChars = letters + numbers + symbols;
  for (let i = 0; i < 8; i++) {
    const randomByte = crypto.randomBytes(1)[0];
    password += allChars[randomByte % allChars.length];
  }

  // Shuffle the password characters
  return password
    .split("")
    .sort(() => 0.5 - Math.random())
    .join("");
}

interface SendInviteEmailParams {
  toEmail: string;
  temporaryPassword?: string;
  orgName: string;
  inviterEmail?: string;
  role: "admin" | "member";
  loginUrl?: string;
}

/**
 * Send an onboarding email with credentials to the invited team member.
 * Dispatches via Resend if RESEND_API_KEY is available, or logs safely.
 */
export async function sendTeamInviteEmail(
  params: SendInviteEmailParams,
): Promise<{ success: boolean; error?: string }> {
  const {
    toEmail,
    temporaryPassword,
    orgName,
    inviterEmail,
    role,
    loginUrl = process.env.NEXT_PUBLIC_APP_URL
      ? `${process.env.NEXT_PUBLIC_APP_URL}/login`
      : "https://app.skelo.ai/login",
  } = params;

  const roleTitle = role === "admin" ? "Workspace Admin" : "Team Member";
  const subject = `You've been invited to join ${orgName} on Skelo`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 32px 16px; color: #1e293b; }
    .container { max-width: 520px; margin: 0 auto; }
    .card { background: #ffffff; border-radius: 14px; border: 1px solid #e2e8f0; padding: 36px 32px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.04); }
    .logo { font-size: 22px; font-weight: 800; letter-spacing: -0.5px; color: #164e52; margin-bottom: 20px; }
    .badge { display: inline-block; padding: 4px 12px; background-color: #e6f4f1; color: #164e52; font-size: 12px; font-weight: 600; border-radius: 9999px; letter-spacing: 0.2px; }
    .heading { font-size: 22px; font-weight: 700; color: #0f172a; margin: 16px 0 8px 0; line-height: 1.3; }
    .subtext { font-size: 14px; line-height: 1.6; color: #475569; margin: 0 0 24px 0; }
    
    .creds-container { background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 18px 20px; margin: 20px 0 24px 0; }
    .cred-row { margin-bottom: 14px; }
    .cred-row:last-child { margin-bottom: 0; }
    .cred-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: #64748b; margin-bottom: 5px; }
    .cred-value { font-size: 15px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-weight: 600; color: #0f172a; word-break: break-all; text-decoration: none !important; }
    .cred-value a { color: #0f172a !important; text-decoration: none !important; }
    .password-badge { display: inline-block; background-color: #ecfdf5; border: 1px solid #a7f3d0; color: #047857; padding: 4px 10px; border-radius: 6px; font-size: 15px; font-weight: 700; letter-spacing: 0.5px; }
    
    .button-container { text-align: center; margin: 28px 0 16px 0; }
    .button { display: inline-block; background-color: #164e52; color: #ffffff !important; text-decoration: none; padding: 12px 28px; font-size: 14px; font-weight: 600; border-radius: 8px; box-shadow: 0 2px 4px rgba(22, 78, 82, 0.2); }
    .footer { font-size: 12px; color: #94a3b8; text-align: center; margin-top: 24px; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="logo">SKELO</div>
      <span class="badge">${roleTitle}</span>
      <h2 class="heading">Welcome to ${orgName}</h2>
      <p class="subtext">
        ${inviterEmail ? `<strong>${inviterEmail}</strong> has invited you` : "You have been invited"} to collaborate on <strong>${orgName}</strong> on Skelo.
      </p>

      <div class="creds-container">
        <div class="cred-row">
          <div class="cred-label">Login Email</div>
          <div class="cred-value">${toEmail}</div>
        </div>
        ${
          temporaryPassword
            ? `
        <div class="cred-row" style="margin-top: 14px; padding-top: 14px; border-top: 1px solid #e2e8f0;">
          <div class="cred-label">Password</div>
          <div class="cred-value">
            <span class="password-badge">${temporaryPassword}</span>
          </div>
        </div>
        `
            : ""
        }
      </div>

      <div class="button-container">
        <a href="${loginUrl}" class="button">Log In to Workspace</a>
      </div>

      <div class="footer">
        If you did not expect this invitation, you can safely ignore this email.
      </div>
    </div>
  </div>
</body>
</html>
  `;

  const resendApiKey = process.env.RESEND_API_KEY;

  if (resendApiKey) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM || "Skelo <team@skelo.ai>",
          to: [toEmail],
          subject,
          html,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        console.error("[email] Resend API error:", data);
        return { success: false, error: data.message || "Email delivery failed" };
      }

      console.log(`[email] Invite sent to ${toEmail} for ${orgName}`);
      return { success: true };
    } catch (err) {
      console.error("[email] Network error sending invite:", err);
      return { success: false, error: "Network error sending email" };
    }
  }

  // If no Resend API key is set, log credentials cleanly on server for testing
  console.log("=================================================");
  console.log(`[DEV INVITE EMAIL]`);
  console.log(`To: ${toEmail}`);
  console.log(`Workspace: ${orgName}`);
  console.log(`Role: ${role}`);
  console.log(`Temporary Password: ${temporaryPassword ?? "(Existing User)"}`);
  console.log(`Login URL: ${loginUrl}`);
  console.log("=================================================");

  return { success: true };
}
