export function resetPasswordEmail(
  userName: string,
  resetLink: string,
  expiresInMinutes: number
): { html: string; text: string } {
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 0">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#141414;border:1px solid #262626;border-radius:12px;padding:40px">
        <tr><td>
          <h1 style="color:#e5e5e5;font-size:20px;margin:0 0 8px">dblumi</h1>
          <p style="color:#a3a3a3;font-size:14px;line-height:1.6;margin:0 0 24px">
            Bonjour ${userName},
          </p>
          <p style="color:#a3a3a3;font-size:14px;line-height:1.6;margin:0 0 24px">
            Vous avez demandé la réinitialisation de votre mot de passe. Cliquez sur le bouton ci-dessous pour en choisir un nouveau.
          </p>
          <table cellpadding="0" cellspacing="0" style="margin:0 0 24px">
            <tr><td style="background:#41cd2a;border-radius:8px;padding:12px 24px">
              <a href="${resetLink}" style="color:#0a0a0a;font-size:14px;font-weight:600;text-decoration:none">
                Réinitialiser le mot de passe
              </a>
            </td></tr>
          </table>
          <p style="color:#737373;font-size:12px;line-height:1.5;margin:0 0 16px">
            Ce lien expire dans ${expiresInMinutes} minutes. Si vous n'avez pas demandé cette réinitialisation, ignorez cet email.
          </p>
          <p style="color:#525252;font-size:11px;line-height:1.5;margin:0;word-break:break-all">
            Si le bouton ne fonctionne pas, copiez ce lien :<br>${resetLink}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  const text = `Bonjour ${userName},

Vous avez demandé la réinitialisation de votre mot de passe.

Cliquez sur ce lien pour en choisir un nouveau :
${resetLink}

Ce lien expire dans ${expiresInMinutes} minutes.

Si vous n'avez pas demandé cette réinitialisation, ignorez cet email.

— dblumi`

  return { html, text }
}
