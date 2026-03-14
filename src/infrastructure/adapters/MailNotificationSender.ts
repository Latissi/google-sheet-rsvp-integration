import { INotificationSender } from '../../domain/ports/INotificationSender';
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

export interface IMailTransport {
  sendEmail(message: MailMessage): void;
}

export interface MailNotificationSenderOptions {
  senderName?: string;
}

export class MailAppTransport implements IMailTransport {
  constructor(private readonly senderName: string) {}

  sendEmail(message: MailMessage): void {
    MailApp.sendEmail(message.to, message.subject, message.body, {
      htmlBody: message.htmlBody,
      name: this.senderName,
      noReply: true,
    });
  }
}

export class MailNotificationSender implements INotificationSender {
  private readonly senderName: string;
  private readonly transport: IMailTransport;

  constructor(
    options: MailNotificationSenderOptions = {},
    transport?: IMailTransport,
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
    ].join('\n');
    const htmlBody = [
      `<p>Hallo ${this.escapeHtml(this.getRecipientLabel(notification.recipient))},</p>`,
      `<p>bitte gib deine Rückmeldung für <strong>${this.escapeHtml(trainingLabel)}</strong> ab.</p>`,
      '<ul>',
      ...detailLines.map(line => `<li>${this.escapeHtml(line)}</li>`),
      '</ul>',
      `<p><a href="${this.escapeHtml(acceptUrl)}">Teilnahme zusagen</a></p>`,
      `<p><a href="${this.escapeHtml(declineUrl)}">Teilnahme absagen</a></p>`,
    ].join('');

    this.dispatch(notification.recipient.email, {
      subject: `Erinnerung: ${trainingLabel} am ${notification.session.sessionDate}`,
      body: textBody,
      htmlBody,
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
    const htmlReason = reasonLine ? `<p>${this.escapeHtml(reasonLine)}</p>` : '';

    this.dispatch(notification.recipient.email, {
      subject: `Absage: ${trainingLabel} am ${notification.session.sessionDate}`,
      body: bodyLines.join('\n'),
      htmlBody: [
        `<p>Hallo ${this.escapeHtml(this.getRecipientLabel(notification.recipient))},</p>`,
        `<p>das Training <strong>${this.escapeHtml(trainingLabel)}</strong> am <strong>${this.escapeHtml(notification.session.sessionDate)}</strong> wurde abgesagt.</p>`,
        '<ul>',
        ...detailLines.map(line => `<li>${this.escapeHtml(line)}</li>`),
        '</ul>',
        htmlReason,
      ].join(''),
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
        `<p>Hallo ${this.escapeHtml(this.getRecipientLabel(notification.recipient))},</p>`,
        `<p>Trainingsbeteiligung für <strong>${this.escapeHtml(trainingLabel)}</strong> am <strong>${this.escapeHtml(notification.session.sessionDate)}</strong>:</p>`,
        '<ul>',
        `<li>Zusagen: ${counts.accepted}</li>`,
        `<li>Absagen: ${counts.declined}</li>`,
        `<li>Rückmeldungen gesamt: ${notification.attendance.length}</li>`,
        '</ul>',
      ].join(''),
    });
  }

  private dispatch(recipientEmail: string, message: Omit<MailMessage, 'to'>): void {
    this.transport.sendEmail({
      to: recipientEmail,
      ...message,
    });
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

    if (training?.audience) {
      lines.push(`Typ: ${training.audience}`);
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

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}