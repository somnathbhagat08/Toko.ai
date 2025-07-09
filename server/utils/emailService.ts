import nodemailer from 'nodemailer';
import { log } from '../vite.js';
import { getEmailConfig } from './config.js';
import { cacheService } from './cache.js';
import fs from 'fs';
import path from 'path';

export interface EmailTemplate {
  name: string;
  subject: string;
  html: string;
  text?: string;
  variables?: Record<string, any>;
}

export interface EmailOptions {
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  html?: string;
  text?: string;
  template?: string;
  variables?: Record<string, any>;
  attachments?: Array<{
    filename: string;
    content: Buffer | string;
    contentType?: string;
  }>;
  priority?: 'high' | 'normal' | 'low';
  replyTo?: string;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
  recipients: string[];
}

class EmailService {
  private transporter: nodemailer.Transporter | null = null;
  private templates = new Map<string, EmailTemplate>();
  private isInitialized = false;
  private emailQueue: EmailOptions[] = [];
  private isProcessing = false;

  constructor() {
    this.initialize();
    this.loadTemplates();
    this.startProcessing();
  }

  private async initialize(): Promise<void> {
    const config = getEmailConfig();
    
    if (!config.enabled) {
      log('Email service disabled', 'email');
      return;
    }

    try {
      if (config.provider === 'smtp' && config.smtp) {
        this.transporter = nodemailer.createTransporter({
          host: config.smtp.host,
          port: config.smtp.port,
          secure: config.smtp.secure,
          auth: {
            user: config.smtp.auth.user,
            pass: config.smtp.auth.pass
          },
          pool: true,
          maxConnections: 5,
          maxMessages: 100,
          rateLimit: 10, // 10 emails per second
          tls: {
            rejectUnauthorized: false
          }
        });

        // Verify connection
        await this.transporter.verify();
        this.isInitialized = true;
        log('Email service initialized with SMTP', 'email');
      }
    } catch (error) {
      log(`Failed to initialize email service: ${error}`, 'email');
    }
  }

  // Load email templates
  private async loadTemplates(): Promise<void> {
    const templatesDir = path.join(process.cwd(), 'templates', 'email');
    
    try {
      if (!fs.existsSync(templatesDir)) {
        fs.mkdirSync(templatesDir, { recursive: true });
        this.createDefaultTemplates();
        return;
      }

      const files = fs.readdirSync(templatesDir);
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          const templatePath = path.join(templatesDir, file);
          const templateData = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
          const templateName = path.basename(file, '.json');
          
          this.templates.set(templateName, templateData);
          log(`Email template loaded: ${templateName}`, 'email');
        }
      }
    } catch (error) {
      log(`Failed to load email templates: ${error}`, 'email');
      this.createDefaultTemplates();
    }
  }

  // Create default templates
  private createDefaultTemplates(): void {
    const defaultTemplates: Record<string, EmailTemplate> = {
      welcome: {
        name: 'welcome',
        subject: 'Welcome to Toko!',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #333;">Welcome to Toko, {{name}}!</h1>
            <p>Thank you for joining our anonymous video chat platform.</p>
            <p>You can start connecting with people from around the world right away.</p>
            <div style="text-align: center; margin: 20px 0;">
              <a href="{{appUrl}}" style="background: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px;">
                Start Chatting
              </a>
            </div>
            <p>Best regards,<br>The Toko Team</p>
          </div>
        `,
        text: 'Welcome to Toko, {{name}}! Thank you for joining our platform. Start chatting at {{appUrl}}'
      },
      
      passwordReset: {
        name: 'passwordReset',
        subject: 'Reset Your Toko Password',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #333;">Password Reset Request</h1>
            <p>Hi {{name}},</p>
            <p>You requested to reset your password. Click the button below to reset it:</p>
            <div style="text-align: center; margin: 20px 0;">
              <a href="{{resetUrl}}" style="background: #dc3545; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px;">
                Reset Password
              </a>
            </div>
            <p>This link will expire in 1 hour.</p>
            <p>If you didn't request this, please ignore this email.</p>
            <p>Best regards,<br>The Toko Team</p>
          </div>
        `,
        text: 'Password reset requested for {{name}}. Reset at: {{resetUrl}}'
      },

      reportNotification: {
        name: 'reportNotification',
        subject: 'User Report Notification',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #dc3545;">User Report Alert</h1>
            <p>A user has been reported on the platform:</p>
            <ul>
              <li><strong>Reported User:</strong> {{reportedUser}}</li>
              <li><strong>Reporter:</strong> {{reporter}}</li>
              <li><strong>Reason:</strong> {{reason}}</li>
              <li><strong>Time:</strong> {{timestamp}}</li>
            </ul>
            <p>Please review this report in the admin panel.</p>
          </div>
        `,
        text: 'User report: {{reportedUser}} reported by {{reporter}} for {{reason}}'
      }
    };

    for (const [name, template] of Object.entries(defaultTemplates)) {
      this.templates.set(name, template);
    }

    log('Default email templates created', 'email');
  }

  // Send email
  async sendEmail(options: EmailOptions): Promise<EmailResult> {
    if (!this.isInitialized || !this.transporter) {
      return {
        success: false,
        error: 'Email service not initialized',
        recipients: Array.isArray(options.to) ? options.to : [options.to]
      };
    }

    try {
      let html = options.html;
      let text = options.text;
      let subject = options.subject;

      // Use template if specified
      if (options.template) {
        const template = this.templates.get(options.template);
        if (template) {
          html = this.renderTemplate(template.html, options.variables || {});
          text = template.text ? this.renderTemplate(template.text, options.variables || {}) : undefined;
          subject = this.renderTemplate(template.subject, options.variables || {});
        }
      }

      const mailOptions = {
        from: process.env.EMAIL_FROM || 'noreply@toko.chat',
        to: options.to,
        cc: options.cc,
        bcc: options.bcc,
        subject,
        html,
        text,
        replyTo: options.replyTo,
        attachments: options.attachments,
        priority: options.priority || 'normal'
      };

      const result = await this.transporter.sendMail(mailOptions);
      
      log(`Email sent successfully: ${result.messageId}`, 'email');
      
      return {
        success: true,
        messageId: result.messageId,
        recipients: Array.isArray(options.to) ? options.to : [options.to]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log(`Failed to send email: ${errorMessage}`, 'email');
      
      return {
        success: false,
        error: errorMessage,
        recipients: Array.isArray(options.to) ? options.to : [options.to]
      };
    }
  }

  // Queue email for later sending
  async queueEmail(options: EmailOptions): Promise<void> {
    this.emailQueue.push(options);
    log(`Email queued for ${Array.isArray(options.to) ? options.to.join(', ') : options.to}`, 'email');
  }

  // Send templated email
  async sendTemplateEmail(
    template: string,
    to: string | string[],
    variables: Record<string, any> = {}
  ): Promise<EmailResult> {
    return this.sendEmail({
      to,
      template,
      variables,
      subject: '', // Will be overridden by template
    });
  }

  // Bulk email sending
  async sendBulkEmail(
    recipients: string[],
    options: Omit<EmailOptions, 'to'>
  ): Promise<EmailResult[]> {
    const results: EmailResult[] = [];
    const batchSize = 10;
    
    for (let i = 0; i < recipients.length; i += batchSize) {
      const batch = recipients.slice(i, i + batchSize);
      const batchPromises = batch.map(recipient => 
        this.sendEmail({ ...options, to: recipient })
      );
      
      const batchResults = await Promise.allSettled(batchPromises);
      
      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          results.push({
            success: false,
            error: result.reason,
            recipients: ['unknown']
          });
        }
      }
      
      // Rate limiting delay between batches
      if (i + batchSize < recipients.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    return results;
  }

  // Template rendering
  private renderTemplate(template: string, variables: Record<string, any>): string {
    let rendered = template;
    
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`{{${key}}}`, 'g');
      rendered = rendered.replace(regex, String(value));
    }
    
    return rendered;
  }

  // Process email queue
  private startProcessing(): void {
    setInterval(async () => {
      if (this.isProcessing || this.emailQueue.length === 0) return;
      
      this.isProcessing = true;
      
      try {
        while (this.emailQueue.length > 0) {
          const email = this.emailQueue.shift();
          if (email) {
            await this.sendEmail(email);
            // Small delay between emails
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
      } catch (error) {
        log(`Error processing email queue: ${error}`, 'email');
      } finally {
        this.isProcessing = false;
      }
    }, 5000); // Process every 5 seconds
  }

  // Get email statistics
  getStats() {
    return {
      isInitialized: this.isInitialized,
      queueLength: this.emailQueue.length,
      templatesLoaded: this.templates.size,
      templateNames: Array.from(this.templates.keys())
    };
  }

  // Test email configuration
  async testConfiguration(): Promise<boolean> {
    if (!this.transporter) return false;
    
    try {
      await this.transporter.verify();
      return true;
    } catch (error) {
      log(`Email configuration test failed: ${error}`, 'email');
      return false;
    }
  }

  // Add new template
  addTemplate(name: string, template: EmailTemplate): void {
    this.templates.set(name, template);
    
    // Save to file
    const templatesDir = path.join(process.cwd(), 'templates', 'email');
    const templatePath = path.join(templatesDir, `${name}.json`);
    
    try {
      fs.writeFileSync(templatePath, JSON.stringify(template, null, 2));
      log(`Email template saved: ${name}`, 'email');
    } catch (error) {
      log(`Failed to save email template: ${error}`, 'email');
    }
  }

  // Get template
  getTemplate(name: string): EmailTemplate | null {
    return this.templates.get(name) || null;
  }

  // List all templates
  getTemplates(): EmailTemplate[] {
    return Array.from(this.templates.values());
  }

  // Shutdown
  async shutdown(): Promise<void> {
    if (this.transporter) {
      this.transporter.close();
    }
    log('Email service shutdown', 'email');
  }
}

// Create singleton instance
export const emailService = new EmailService();

// Convenience functions
export const sendWelcomeEmail = (to: string, name: string) => {
  return emailService.sendTemplateEmail('welcome', to, {
    name,
    appUrl: process.env.APP_URL || 'https://toko.chat'
  });
};

export const sendPasswordResetEmail = (to: string, name: string, resetUrl: string) => {
  return emailService.sendTemplateEmail('passwordReset', to, {
    name,
    resetUrl
  });
};

export const sendReportNotification = (to: string, reportData: any) => {
  return emailService.sendTemplateEmail('reportNotification', to, reportData);
};
