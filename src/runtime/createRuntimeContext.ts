import {
  ICancelTrainingService,
  IRegisterMemberService,
  ISendCancellationNotificationService,
  ISendTrainerParticipationReportService,
  ISendTrainingReminderService,
  ISubmitRsvpService,
  ISyncAttendanceService,
  CancelTrainingService,
  RegisterMemberService,
  SendCancellationNotificationService,
  SendTrainerParticipationReportService,
  SendTrainingReminderService,
  SubmitRsvpService,
  SyncAttendanceService,
} from '../application';
import { getSystemConfig, SystemConfig } from '../config';
import { IConfigurationProvider } from '../domain/ports/IConfigurationProvider';
import { INotificationSender } from '../domain/ports/INotificationSender';
import { ITrainingDataRepository } from '../domain/ports/ITrainingDataRepository';
import { IUserRepository } from '../domain/ports/IUserRepository';
import { ConfigurationAdapter } from '../infrastructure/adapters/ConfigurationAdapter';
import { EnvironmentAwareNotificationSender } from '../infrastructure/adapters/EnvironmentAwareNotificationSender';
import { GoogleSheetTrainingDataRepository } from '../infrastructure/adapters/GoogleSheetTrainingDataRepository';
import { MailAppTransport, MailNotificationSender } from '../infrastructure/adapters/MailNotificationSender';
import { PrivateSheetConfigurationProvider } from '../infrastructure/adapters/PrivateSheetConfigurationProvider';
import { PrivateSheetUserRepository } from '../infrastructure/adapters/PrivateSheetUserRepository';
import { GoogleSheetGateway } from '../infrastructure/gateway/GoogleSheetGateway';
import { ISheetGateway } from '../infrastructure/gateway/ISheetGateway';

export interface RuntimeContext {
  configurationProvider: IConfigurationProvider;
  userRepository: IUserRepository;
  trainingDataRepository: ITrainingDataRepository;
  notificationSender: INotificationSender;
  registerMemberService: IRegisterMemberService;
  submitRsvpService: ISubmitRsvpService;
  syncAttendanceService: ISyncAttendanceService;
  cancelTrainingService: ICancelTrainingService;
  sendTrainingReminderService: ISendTrainingReminderService;
  sendCancellationNotificationService: ISendCancellationNotificationService;
  sendTrainerParticipationReportService: ISendTrainerParticipationReportService;
}

export interface RuntimeContextOptions {
  systemConfig?: SystemConfig;
  sheetGateway?: ISheetGateway;
}

export function createRuntimeContext(options: RuntimeContextOptions = {}): RuntimeContext {
  const systemConfig = options.systemConfig ?? getSystemConfig();
  const sheetGateway = options.sheetGateway ?? new GoogleSheetGateway();
  const privateSheetConfigurationSource = new ConfigurationAdapter(sheetGateway);
  const privateSheetUserStore = new ConfigurationAdapter(sheetGateway);
  const configurationProvider = new PrivateSheetConfigurationProvider(privateSheetConfigurationSource);
  const userRepository = new PrivateSheetUserRepository(privateSheetUserStore);
  const trainingDataRepository = new GoogleSheetTrainingDataRepository(
    sheetGateway,
    configurationProvider,
    userRepository,
  );
  const mailNotificationSender = new MailNotificationSender(
    {},
    new MailAppTransport('RSVP System'),
  );
  const notificationSender = new EnvironmentAwareNotificationSender(systemConfig, mailNotificationSender);
  const syncAttendanceService = new SyncAttendanceService(trainingDataRepository);
  const registerMemberService = new RegisterMemberService(userRepository);
  const submitRsvpService = new SubmitRsvpService(
    userRepository,
    syncAttendanceService,
  );
  const cancelTrainingService = new CancelTrainingService(trainingDataRepository, userRepository);
  const sendTrainingReminderService = new SendTrainingReminderService(
    trainingDataRepository,
    userRepository,
    configurationProvider,
    notificationSender,
  );
  const sendCancellationNotificationService = new SendCancellationNotificationService(
    trainingDataRepository,
    userRepository,
    notificationSender,
  );
  const sendTrainerParticipationReportService = new SendTrainerParticipationReportService(
    trainingDataRepository,
    userRepository,
    notificationSender,
  );

  return {
    configurationProvider,
    userRepository,
    trainingDataRepository,
    notificationSender,
    registerMemberService,
    submitRsvpService,
    syncAttendanceService,
    cancelTrainingService,
    sendTrainingReminderService,
    sendCancellationNotificationService,
    sendTrainerParticipationReportService,
  };
}