import { createTransport, type Transporter } from 'nodemailer'
import { config } from '../config.js'

let transporter: Transporter | null = null

export function isSmtpConfigured(): boolean {
  return !!(config.SMTP_HOST && config.SMTP_FROM)
}

function getTransporter(): Transporter {
  if (!transporter) {
    if (!isSmtpConfigured()) {
      throw new Error('SMTP is not configured')
    }
    transporter = createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_PORT === 465,
      auth: config.SMTP_USER
        ? { user: config.SMTP_USER, pass: config.SMTP_PASS }
        : undefined,
    })
  }
  return transporter
}

export async function sendMail(
  to: string,
  subject: string,
  html: string,
  text: string
): Promise<void> {
  await getTransporter().sendMail({
    from: config.SMTP_FROM,
    to,
    subject,
    html,
    text,
  })
}
