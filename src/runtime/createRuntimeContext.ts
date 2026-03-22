import {
  IRegisterMemberService,
  ISendCancellationNotificationService,
  ISendTrainerParticipationReportService,
  ISendTrainingReminderService,
  ISubmitRsvpService,
  ISyncAttendanceService,
  IUpdateSubscriptionPreferencesService,
  RegisterMemberService,
  SendCancellationNotificationService,
  SendTrainerParticipationReportService,
  SendTrainingReminderService,
  SubmitRsvpService,
  SyncAttendanceService,
  UpdateSubscriptionPreferencesService,
} from '../application';
import { IConfigurationProvider } from '../domain/ports/IConfigurationProvider';
import { INotificationSender } from '../domain/ports/INotificationSender';
import { ITrainingDataRepository } from '../domain/ports/ITrainingDataRepository';
import { IUserRepository } from '../domain/ports/IUserRepository';
import { ConfigurationAdapter } from '../infrastructure/adapters/ConfigurationAdapter';
import { GoogleSheetTrainingDataRepository } from '../infrastructure/adapters/GoogleSheetTrainingDataRepository';
import { MailAppTransport, MailNotificationSender } from '../infrastructure/adapters/MailNotificationSender';
import { PrivateSheetConfigurationProvider } from '../infrastructure/adapters/PrivateSheetConfigurationProvider';
import { PrivateSheetUserRepository } from '../infrastructure/adapters/PrivateSheetUserRepository';
import { GoogleSheetGateway } from '../infrastructure/gateway/GoogleSheetGateway';
import { ISheetGateway } from '../infrastructure/gateway/ISheetGateway';
import { getRuntimeLogger } from './logging';

export interface RuntimeContext {
  configurationProvider: IConfigurationProvider;
  userRepository: IUserRepository;
  trainingDataRepository: ITrainingDataRepository;
  notificationSender: INotificationSender;
  registerMemberService: IRegisterMemberService;
  updateSubscriptionPreferencesService: IUpdateSubscriptionPreferencesService;
  submitRsvpService: ISubmitRsvpService;
  syncAttendanceService: ISyncAttendanceService;
  sendTrainingReminderService: ISendTrainingReminderService;
  sendCancellationNotificationService: ISendCancellationNotificationService;
  sendTrainerParticipationReportService: ISendTrainerParticipationReportService;
}

export interface RuntimeContextOptions {
  sheetGateway?: ISheetGateway;
}

export function createRuntimeContext(options: RuntimeContextOptions = {}): RuntimeContext {
  const sheetGateway = options.sheetGateway ?? new GoogleSheetGateway();
  const privateSheetConfigurationSource = new ConfigurationAdapter(sheetGateway);
  const privateSheetUserStore = new ConfigurationAdapter(sheetGateway);
  const configurationProvider = new PrivateSheetConfigurationProvider(privateSheetConfigurationSource);
  const userRepository = new PrivateSheetUserRepository(privateSheetUserStore);
  const trainingDataRepository = new GoogleSheetTrainingDataRepository(
    sheetGateway,
    configurationProvider,
    userRepository,
    undefined,
    getRuntimeLogger(),
  );
  const mailNotificationSender = new MailNotificationSender(
    {},
    new MailAppTransport('RSVP System'),
    getRuntimeLogger(),
  );
  const notificationSender = mailNotificationSender;
  const syncAttendanceService = new SyncAttendanceService(trainingDataRepository);
  const registerMemberService = new RegisterMemberService(userRepository);
  const updateSubscriptionPreferencesService = new UpdateSubscriptionPreferencesService(userRepository);
  const submitRsvpService = new SubmitRsvpService(
    trainingDataRepository,
    userRepository,
    syncAttendanceService,
  );
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
    updateSubscriptionPreferencesService,
    submitRsvpService,
    syncAttendanceService,
    sendTrainingReminderService,
    sendCancellationNotificationService,
    sendTrainerParticipationReportService,
  };
}