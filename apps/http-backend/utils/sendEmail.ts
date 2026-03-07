import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendMagicLinkEmail(email: string, token: string) {
    const magicLinkUrl = `${process.env.API_BASE_URL}/api/v1/user/auth/verify?token=${token}`;

    await resend.emails.send({
        from: "Velox <noreply@mail.bihanbanerjee.com>",
        to: email,
        subject: "Sign in to Velox",
        html: `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f9fafb; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="padding: 40px 20px;">
        <tr>
            <td align="center">
                <table width="480" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden;">
                    <tr>
                        <td style="padding: 32px 32px 24px; border-bottom: 3px solid #FFB800;">
                            <span style="font-size: 24px; font-weight: 600; color: #141d22; letter-spacing: -0.03em;">velox</span>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 32px;">
                            <h1 style="margin: 0 0 16px; font-size: 20px; font-weight: 700; color: #141d22;">Sign in to your account</h1>
                            <p style="margin: 0 0 24px; font-size: 14px; color: #374151; line-height: 1.6;">Click the button below to sign in. This link expires in 15 minutes.</p>
                            <a href="${magicLinkUrl}" style="display: inline-block; background-color: #FFB800; color: #141d22; padding: 14px 32px; border-radius: 6px; font-size: 14px; font-weight: 600; text-decoration: none;">Sign in to Velox</a>
                            <p style="margin: 24px 0 0; font-size: 12px; color: #9ca3af; line-height: 1.5;">If you didn't request this link, you can safely ignore this email.</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
        `.trim(),
    });
}
