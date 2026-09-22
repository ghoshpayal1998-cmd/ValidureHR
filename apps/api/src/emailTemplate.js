function generateWelcomeEmail({ name, username, email, password, companyName, loginUrl }) {
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Welcome to ${companyName}</title>
    <style>
      body {
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
        background-color: #f4f7f6;
        margin: 0;
        padding: 0;
        color: #333333;
      }
      .container {
        max-width: 600px;
        margin: 40px auto;
        background-color: #ffffff;
        border-radius: 8px;
        overflow: hidden;
        box-shadow: 0 4px 12px rgba(0,0,0,0.05);
      }
      .header {
        background-color: #0a192f;
        color: #ffffff;
        padding: 30px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .header h1 {
        margin: 0;
        font-size: 24px;
        font-weight: 600;
        letter-spacing: -0.5px;
      }
      .header .sub-brand {
        font-size: 14px;
        color: #8892b0;
      }
      .content {
        padding: 40px 30px;
      }
      .content h2 {
        font-size: 20px;
        margin-top: 0;
        color: #0a192f;
      }
      .content p {
        font-size: 15px;
        line-height: 1.6;
        color: #4a5568;
      }
      .credentials-box {
        background-color: #f0f7ff;
        border-radius: 6px;
        padding: 20px;
        margin: 25px 0;
        border-left: 4px solid #3182ce;
      }
      .credentials-box p {
        margin: 8px 0;
        color: #2b6cb0;
        font-size: 14px;
      }
      .credentials-box strong {
        color: #1a365d;
        display: inline-block;
        width: 140px;
      }
      .warning-box {
        background-color: #fffaf0;
        border-radius: 6px;
        padding: 15px;
        margin-bottom: 25px;
        border-left: 4px solid #dd6b20;
        font-size: 14px;
        color: #c05621;
      }
      .responsibilities {
        margin-bottom: 30px;
      }
      .responsibilities ul {
        padding-left: 20px;
        color: #4a5568;
      }
      .responsibilities li {
        margin-bottom: 8px;
        font-size: 15px;
      }
      .actions {
        margin-top: 35px;
        display: flex;
        align-items: center;
        gap: 20px;
      }
      .btn-primary {
        background-color: #008080;
        color: #ffffff !important;
        text-decoration: none;
        padding: 12px 24px;
        border-radius: 4px;
        font-weight: 600;
        font-size: 15px;
        display: inline-block;
        transition: background-color 0.2s;
      }
      .btn-primary:hover {
        background-color: #006666;
      }
      .btn-secondary {
        color: #3182ce;
        text-decoration: none;
        font-weight: 500;
        font-size: 15px;
      }
      .btn-secondary:hover {
        text-decoration: underline;
      }
      .footer {
        padding: 20px 30px;
        background-color: #f8fafc;
        border-top: 1px solid #e2e8f0;
        font-size: 13px;
        color: #a0aec0;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1>${companyName} HR</h1>
        <div class="sub-brand">Internal Work-Management Platform</div>
      </div>
      <div class="content">
        <h2>Welcome to ${companyName}, ${name}</h2>
        <p>Your HR administrator has added you to the ${companyName} HR Portal. This is your central hub for managing your employment information, leaves, and attendance.</p>
        
        <div class="credentials-box">
          <p><strong>Login Address:</strong> <a href="${loginUrl}" style="color: #3182ce;">${loginUrl}</a></p>
          <p><strong>Username/Emp Code:</strong> ${username}</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>System Password:</strong> <span style="background: #e2e8f0; padding: 2px 6px; border-radius: 3px; font-family: monospace;">${password}</span></p>
        </div>

        <div class="warning-box">
          <strong>Important:</strong> Change this password right after your first sign-in. Click your avatar (top-right) → Change password.
        </div>

        <div class="responsibilities">
          <strong>START HERE</strong>
          <ul>
            <li>Log in using the credentials provided above.</li>
            <li>Review and update your profile information.</li>
            <li>Check the HR policies and your leave balances.</li>
            <li>Use the portal for daily attendance and leave requests.</li>
          </ul>
        </div>

        <div class="actions">
          <a href="${loginUrl}" class="btn-primary">Open HR Portal</a>

        </div>
      </div>
      <div class="footer">
        This email was sent automatically by the ${companyName} HR system. If it doesn't concern you, you can safely ignore it.
      </div>
    </div>
  </body>
  </html>
  `;
}

module.exports = { generateWelcomeEmail };
