import {
  ICancelTrainingSessionService,
  IRegisterMemberService,
  ISendCancellationNotificationService,
  ISendTrainerParticipationReportService,
  ISendTrainingReminderService,
  ISubmitRsvpService,
  ISyncAttendanceService,
  IUpdateSubscriptionPreferencesService,
  CancelTrainingSessionService,
  RegisterMemberService,
  SendCancellationNotificationService,
  SendTrainerParticipationReportService,
  SendTrainingReminderService,
  SubmitRsvpService,
  SyncAttendanceService,
  UpdateSubscriptionPreferencesService,
} from '../application';
import {
  IPreviewPublicSourceRegistrationMatchesService,
  PreviewPublicSourceRegistrationMatchesService,
} from '../application/registration/PreviewPublicSourceRegistrationMatchesService';
import { IConfigurationProvider } from '../domain/ports/IConfigurationProvider';
import { INotificationSender } from '../domain/ports/INotificationSender';
import { IPublicSourceRepository } from '../domain/ports/IPublicSourceRepository';
import { ITrainingDataRepository } from '../domain/ports/ITrainingDataRepository';
import { IUserRepository } from '../domain/ports/IUserRepository';
import { GoogleSheetPublicSourceRepository } from '../infrastructure/adapters/GoogleSheetPublicSourceRepository';
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
  publicSourceRepository: IPublicSourceRepository;
  notificationSender: INotificationSender;
  previewPublicSourceRegistrationMatchesService: IPreviewPublicSourceRegistrationMatchesService;
  registerMemberService: IRegisterMemberService;
  updateSubscriptionPreferencesService: IUpdateSubscriptionPreferencesService;
  submitRsvpService: ISubmitRsvpService;
  cancelTrainingSessionService: ICancelTrainingSessionService;
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
  const configurationProvider = new PrivateSheetConfigurationProvider(sheetGateway);
  const userRepository = new PrivateSheetUserRepository(sheetGateway);
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
  const publicSourceRepository = new GoogleSheetPublicSourceRepository(sheetGateway, configurationProvider);
  const previewPublicSourceRegistrationMatchesService = new PreviewPublicSourceRegistrationMatchesService(publicSourceRepository);
  const registerMemberService = new RegisterMemberService(userRepository);
  const updateSubscriptionPreferencesService = new UpdateSubscriptionPreferencesService(
    userRepository,
    trainingDataRepository,
  );
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
  const cancelTrainingSessionService = new CancelTrainingSessionService(
    trainingDataRepository,
    userRepository,
    sendCancellationNotificationService,
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
    publicSourceRepository,
    notificationSender,
    previewPublicSourceRegistrationMatchesService,
    registerMemberService,
    updateSubscriptionPreferencesService,
    submitRsvpService,
    cancelTrainingSessionService,
    syncAttendanceService,
    sendTrainingReminderService,
    sendCancellationNotificationService,
    sendTrainerParticipationReportService,
  };
}