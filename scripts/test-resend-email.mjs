import fs from 'node:fs';
import path from 'node:path';

// Load .env
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx !== -1) {
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

const apiKey = process.env.RESEND_API_KEY;
const fromEmail = process.env.EMAIL_FROM || 'Skelo <team@skelo.team>';
const targetEmail = process.argv[2];

console.log('\n=============================================');
console.log('   Skelo Resend Email Configuration Check    ');
console.log('=============================================\n');

console.log(`RESEND_API_KEY : ${apiKey ? `Configured (starts with ${apiKey.substring(0, 7)}...)` : '❌ NOT CONFIGURED (Empty in .env)'}`);
console.log(`EMAIL_FROM     : ${fromEmail}`);
console.log(`APP_URL        : ${process.env.NEXT_PUBLIC_APP_URL || 'https://app.skelo.team'}\n`);

if (!apiKey) {
  console.error('❌ Error: RESEND_API_KEY is empty or missing in .env.');
  console.log('👉 Please add your Resend API Key (starts with re_...) in skello/.env:');
  console.log('   RESEND_API_KEY=re_your_api_key_here\n');
  process.exit(1);
}

// Check Resend Domain Status via API
try {
  console.log('🔍 Checking domain status in Resend API...');
  const domainRes = await fetch('https://api.resend.com/domains', {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (domainRes.ok) {
    const domainData = await domainRes.json();
    console.log('✅ Resend API connected successfully!');
    console.log('\nDomains registered in Resend:');
    if (domainData.data && domainData.data.length > 0) {
      for (const d of domainData.data) {
        const statusBadge = d.status === 'verified' ? '✅ VERIFIED' : `⚠️ ${d.status?.toUpperCase()}`;
        console.log(`  • ${d.name} -> ${statusBadge} (Region: ${d.region})`);
      }
    } else {
      console.log('  ⚠️ No domains found in Resend account (using onboarding domain or needs creation)');
    }
  } else {
    const err = await domainRes.json();
    console.error('❌ Failed to authenticate with Resend API:', err);
    process.exit(1);
  }
} catch (e) {
  console.error('❌ Network error connecting to Resend:', e.message);
  process.exit(1);
}

// If destination email is provided as CLI argument, send a test email
if (targetEmail) {
  console.log(`\n📧 Sending test invitation email to: ${targetEmail}...`);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [targetEmail],
        subject: "Test Invite: You've been invited to join Demo Workspace on Skelo",
        html: `
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
              .cred-value { font-size: 15px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-weight: 600; color: #0f172a; word-break: break-all; }
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
                <span class="badge">Team Member</span>
                <h2 class="heading">Welcome to Demo Workspace</h2>
                <p class="subtext">
                  You have been invited to collaborate on <strong>Demo Workspace</strong> on Skelo.
                </p>
                <div class="creds-container">
                  <div class="cred-row">
                    <div class="cred-label">Login Email</div>
                    <div class="cred-value">${targetEmail}</div>
                  </div>
                  <div class="cred-row" style="margin-top: 14px; padding-top: 14px; border-top: 1px solid #e2e8f0;">
                    <div class="cred-label">Password</div>
                    <div class="cred-value">
                      <span class="password-badge">Sk8#mP29!q</span>
                    </div>
                  </div>
                </div>
                <div class="button-container">
                  <a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://app.skelo.team'}/login" class="button">Log In to Workspace</a>
                </div>
                <div class="footer">
                  If you did not expect this invitation, you can safely ignore this email.
                </div>
              </div>
            </div>
          </body>
          </html>
        `,
      }),
    });

    const result = await res.json();
    if (res.ok) {
      console.log(`\n🎉 Success! Email sent with ID: ${result.id}`);
      console.log(`📬 Check inbox for: ${targetEmail}`);
    } else {
      console.error('\n❌ Resend API delivery error:', result);
    }
  } catch (err) {
    console.error('\n❌ Network error while sending:', err.message);
  }
} else {
  console.log('\n💡 Tip: To send a real test email to an inbox, run:');
  console.log('   node scripts/test-resend-email.mjs your-email@domain.com\n');
}
