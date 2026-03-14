import { IApplicationService } from '../IApplicationService';
import { ITrainingDataRepository } from '../../domain/ports/ITrainingDataRepository';
import { IUserRepository } from '../../domain/ports/IUserRepository';
import { INotificationSender } from '../../domain/ports/INotificationSender';
import { indexTrainingDefinitions } from './notificationUtils';

export interface SendTrainerParticipationReportRequest {
  sessionId: string;
}

export interface SendTrainerParticipationReportResult {
  trainerCount: number;
  attendanceCount: number;
  sentCount: number;
}

export interface ISendTrainerParticipationReportService extends IApplicationService<SendTrainerParticipationReportRequest, SendTrainerParticipationReportResult> {}

export class SendTrainerParticipationReportService implements ISendTrainerParticipationReportService {
  constructor(
    private readonly trainingDataRepository: ITrainingDataRepository,
    private readonly userRepository: IUserRepository,
    private readonly notificationSender: INotificationSender,
  ) {}

  execute(request: SendTrainerParticipationReportRequest): SendTrainerParticipationReportResult {
    const session = this.trainingDataRepository.getTrainingSessionById(request.sessionId);

    if (!session) {
      throw new Error(`Training session "${request.sessionId}" not found.`);
    }

    const attendance = this.trainingDataRepository.getAttendanceForSession(session.sessionId);
    const trainingDefinitions = indexTrainingDefinitions(this.trainingDataRepository.getTrainingDefinitions());
    const recipients = this.userRepository
      .getAllUsers()
      .filter(user => (
        user.roleDefinition.capabilities.receivesParticipationReportEmail
        && user.subscribedTrainingIds.includes(session.trainingId)
      ));

    for (const recipient of recipients) {
      this.notificationSender.sendTrainerParticipationReport({
        recipient,
        session,
        training: trainingDefinitions.get(session.trainingId),
        attendance,
      });
    }

    return {
      trainerCount: recipients.length,
      attendanceCount: attendance.length,
      sentCount: recipients.length,
    };
  }
}