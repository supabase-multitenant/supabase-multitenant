import nodemailer from 'nodemailer'

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
})

export async function sendPasswordResetEmail(email: string, resetToken: string) {
  const resetUrl = `${process.env.APP_URL}/auth/reset-password?token=${resetToken}`
  
  const mailOptions = {
    from: process.env.SMTP_USER,
    to: email,
    subject: `Password Reset - ${process.env.APP_NAME}`,
    html: `
      <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif;">
        <h1 style="color: #006239;">Password Reset Request</h1>
        <p>You requested a password reset for your ${process.env.APP_NAME} account.</p>
        <p>Click the link below to reset your password:</p>
        <a href="${resetUrl}" style="background-color: #006239; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Reset Password</a>
        <p style="margin-top: 20px; color: #666;">This link will expire in 1 hour.</p>
        <p style="color: #666;">If you didn't request this reset, please ignore this email.</p>
      </div>
    `,
  }
  
  await transporter.sendMail(mailOptions)
}

export async function sendTeamInviteEmail(email: string, inviterName: string) {
  const inviteUrl = `${process.env.APP_URL}/auth/signup`
  
  const mailOptions = {
    from: process.env.SMTP_USER,
    to: email,
    subject: `Team Invitation - ${process.env.APP_NAME}`,
    html: `
      <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif;">
        <h1 style="color: #006239;">Team Invitation</h1>
        <p>${inviterName} has invited you to join their team on ${process.env.APP_NAME}.</p>
        <p>Click the link below to accept the invitation:</p>
        <a href="${inviteUrl}" style="background-color: #006239; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Join Team</a>
        <p style="margin-top: 20px; color: #666;">If you don't want to join this team, please ignore this email.</p>
      </div>
    `,
  }
  
  await transporter.sendMail(mailOptions)
}