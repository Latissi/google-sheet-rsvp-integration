import { INotificationSender } from '../../domain/ports/INotificationSender';
import { escapeHtml } from './htmlEscape';
import {
  AttendanceRecord,
  TrainerParticipationReportNotification,
  TrainingCancellationNotification,
  TrainingReminderNotification,
} from '../../domain/types';

export interface MailMessage {
  to: string;
  subject: string;
  body: string;
  htmlBody?: string;
}

export interface MailDispatchResult {
  remainingQuota?: number;
}

export interface IMailTransport {
  sendEmail(message: MailMessage): MailDispatchResult;
}

export interface MailNotificationSenderOptions {
  senderName?: string;
}

interface NotificationLogger {
  info(operation: string, event: string, context?: Record<string, unknown>, message?: string): void;
}

export class MailAppTransport implements IMailTransport {
  constructor(private readonly senderName: string) {}

  sendEmail(message: MailMessage): MailDispatchResult {
    if (MailApp.getRemainingDailyQuota() <= 0) {
      throw new Error('Daily email quota exhausted.');
    }

    MailApp.sendEmail(message.to, message.subject, message.body, {
      htmlBody: message.htmlBody,
      name: this.senderName,
      noReply: true,
    });

    return {
      remainingQuota: MailApp.getRemainingDailyQuota(),
    };
  }
}

export class MailNotificationSender implements INotificationSender {
  private readonly senderName: string;
  private readonly transport: IMailTransport;

  constructor(
    options: MailNotificationSenderOptions = {},
    transport?: IMailTransport,
    private readonly logger?: NotificationLogger,
  ) {
    this.senderName = options.senderName?.trim() || 'RSVP System';
    this.transport = transport ?? new MailAppTransport(this.senderName);
  }

  sendTrainingReminder(notification: TrainingReminderNotification): void {
    const acceptUrl = this.buildUrl(notification.webAppUrl, {
      action: 'rsvp',
      memberId: notification.recipient.memberId,
      sessionId: notification.session.sessionId,
      response: 'Accepted',
    });
    const declineUrl = this.buildUrl(notification.webAppUrl, {
      action: 'rsvp',
      memberId: notification.recipient.memberId,
      sessionId: notification.session.sessionId,
      response: 'Declined',
    });
    const preferencesUrl = this.buildUrl(notification.webAppUrl, {
      action: 'preferences',
      memberId: notification.recipient.memberId,
    });
    const cancelUrl = notification.recipient.roleDefinition.capabilities.canCancelTraining
      ? this.buildUrl(notification.webAppUrl, {
        action: 'cancel-training',
        memberId: notification.recipient.memberId,
        sessionId: notification.session.sessionId,
      })
      : null;
    const trainingLabel = this.getTrainingLabel(notification.training?.title, notification.session.trainingId);
    const detailLines = this.getSessionDetailLines(notification.session, notification.training);
    const textBody = [
      `Hallo ${this.getRecipientLabel(notification.recipient)},`,
      '',
      `bitte gib deine Rückmeldung für ${trainingLabel} ab.`,
      ...detailLines,
      '',
      `Zusagen: ${acceptUrl}`,
      `Absagen: ${declineUrl}`,
      `Benachrichtigungseinstellungen aktualisieren: ${preferencesUrl}`,
      ...(cancelUrl ? [`Training absagen: ${cancelUrl}`] : []),
    ].join('\n');
    const htmlBody = [
      `<p>Hallo ${escapeHtml(this.getRecipientLabel(notification.recipient))},</p>`,
      `<p>bitte gib deine Rückmeldung für <strong>${escapeHtml(trainingLabel)}</strong> ab.</p>`,
      '<ul>',
      ...detailLines.map(line => `<li>${escapeHtml(line)}</li>`),
      '</ul>',
      '<p style="margin-top:1.5rem">',
      `<a href="${escapeHtml(acceptUrl)}" style="display:inline-block;background:#2d7a3a;color:#ffffff;text-decoration:none;padding:0.65rem 1.4rem;border-radius:999px;font-weight:600;margin-right:0.75rem">&#10003;&nbsp;Zusagen</a>`,
      `<a href="${escapeHtml(declineUrl)}" style="display:inline-block;background:#f0f0f0;color:#1A1A2E;text-decoration:none;padding:0.65rem 1.4rem;border-radius:999px;font-weight:600">&#10005;&nbsp;Absagen</a>`,
      '</p>',
      `<p style="margin-top:1.5rem;font-size:0.88rem;color:#6b7280"><a href="${escapeHtml(preferencesUrl)}" style="color:#6b7280">Benachrichtigungseinstellungen aktualisieren</a></p>`,
      ...(cancelUrl ? [
        '<hr style="border:none;border-top:1px solid #e5e5e5;margin:1.5rem 0" />',
        `<p style="font-size:0.88rem"><a href="${escapeHtml(cancelUrl)}" style="color:#C41230">Training absagen</a></p>`,
      ] : []),
    ].join('');

    this.dispatch(notification.recipient.email, {
      subject: `Erinnerung: ${trainingLabel} am ${notification.session.sessionDate}`,
      body: textBody,
      htmlBody,
    }, {
      notificationType: 'training-reminder',
      sessionId: notification.session.sessionId,
      trainingId: notification.session.trainingId,
    });
  }

  sendTrainingCancellation(notification: TrainingCancellationNotification): void {
    const trainingLabel = this.getTrainingLabel(notification.training?.title, notification.session.trainingId);
    const detailLines = this.getSessionDetailLines(notification.session, notification.training);
    const reasonLine = notification.cancellation.reason
      ? `Grund: ${notification.cancellation.reason}`
      : undefined;
    const bodyLines = [
      `Hallo ${this.getRecipientLabel(notification.recipient)},`,
      '',
      `das Training ${trainingLabel} am ${notification.session.sessionDate} wurde abgesagt.`,
      ...detailLines,
      ...(reasonLine ? ['', reasonLine] : []),
    ];
    const htmlReason = reasonLine ? `<p>${escapeHtml(reasonLine)}</p>` : '';

    this.dispatch(notification.recipient.email, {
      subject: `Absage: ${trainingLabel} am ${notification.session.sessionDate}`,
      body: bodyLines.join('\n'),
      htmlBody: [
        `<p>Hallo ${escapeHtml(this.getRecipientLabel(notification.recipient))},</p>`,
        `<div style="border-left:4px solid #C41230;background:#FFF4F4;padding:0.85rem 1rem;border-radius:0 8px 8px 0;margin:1rem 0">`,
        `<strong>Das Training <em>${escapeHtml(trainingLabel)}</em> am ${escapeHtml(notification.session.sessionDate)} wurde abgesagt.</strong>`,
        `</div>`,
        '<ul>',
        ...detailLines.map(line => `<li>${escapeHtml(line)}</li>`),
        '</ul>',
        htmlReason,
      ].join(''),
    }, {
      notificationType: 'training-cancellation',
      sessionId: notification.session.sessionId,
      trainingId: notification.session.trainingId,
    });
  }

  sendTrainerParticipationReport(notification: TrainerParticipationReportNotification): void {
    const trainingLabel = this.getTrainingLabel(notification.training?.title, notification.session.trainingId);
    const counts = this.getAttendanceCounts(notification.attendance);
    const bodyLines = [
      `Hallo ${this.getRecipientLabel(notification.recipient)},`,
      '',
      `Trainingsbeteiligung für ${trainingLabel} am ${notification.session.sessionDate}:`,
      `Zusagen: ${counts.accepted}`,
      `Absagen: ${counts.declined}`,
      `Rückmeldungen gesamt: ${notification.attendance.length}`,
    ];

    this.dispatch(notification.recipient.email, {
      subject: `Beteiligungsreport: ${trainingLabel} am ${notification.session.sessionDate}`,
      body: bodyLines.join('\n'),
      htmlBody: [
        `<p>Hallo ${escapeHtml(this.getRecipientLabel(notification.recipient))},</p>`,
        `<p>Trainingsbeteiligung für <strong>${escapeHtml(trainingLabel)}</strong> am <strong>${escapeHtml(notification.session.sessionDate)}</strong>:</p>`,
        '<ul>',
        `<li>Zusagen: ${counts.accepted}</li>`,
        `<li>Absagen: ${counts.declined}</li>`,
        `<li>Rückmeldungen gesamt: ${notification.attendance.length}</li>`,
        '</ul>',
      ].join(''),
    }, {
      notificationType: 'trainer-participation-report',
      sessionId: notification.session.sessionId,
      trainingId: notification.session.trainingId,
    });
  }

  private dispatch(
    recipientEmail: string,
    message: Omit<MailMessage, 'to'>,
    context: Record<string, unknown>,
  ): void {
    const result = this.transport.sendEmail({
      to: recipientEmail,
      ...message,
    });

    this.logger?.info(
      'mail-notification-sender',
      'email-sent',
      {
        ...context,
        remainingQuota: result.remainingQuota,
      },
    );
  }

  private getRecipientLabel(notificationRecipient: TrainingReminderNotification['recipient']): string {
    return notificationRecipient.personName.firstName || notificationRecipient.name || notificationRecipient.memberId;
  }

  private getTrainingLabel(trainingTitle: string | undefined, trainingId: string): string {
    return trainingTitle?.trim() || trainingId;
  }

  private getSessionDetailLines(
    session: TrainingReminderNotification['session'],
    training?: TrainingReminderNotification['training'],
  ): string[] {
    const lines = [
      `Datum: ${session.sessionDate}`,
      `Start: ${session.startTime}`,
    ];

    if (session.endTime || training?.endTime) {
      lines.push(`Ende: ${session.endTime ?? training?.endTime}`);
    }

    if (session.location || training?.location) {
      lines.push(`Ort: ${session.location ?? training?.location}`);
    }

    if (training?.environment) {
      lines.push(`Umgebung: ${training.environment}`);
    }

    if (session.additionalInfo) {
      lines.push(`Info: ${session.additionalInfo}`);
    }

    return lines;
  }

  private getAttendanceCounts(attendance: AttendanceRecord[]): { accepted: number; declined: number } {
    return attendance.reduce((counts, record) => {
      if (record.rsvpStatus === 'Accepted') {
        counts.accepted += 1;
      }

      if (record.rsvpStatus === 'Declined') {
        counts.declined += 1;
      }

      return counts;
    }, { accepted: 0, declined: 0 });
  }

  private buildUrl(baseUrl: string, params: Record<string, string>): string {
    const separator = baseUrl.includes('?') ? '&' : '?';
    const query = Object.entries(params)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join('&');
    return `${baseUrl}${separator}${query}`;
  }

}