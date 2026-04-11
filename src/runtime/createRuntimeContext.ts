import {
  ICancelTrainingSessionService,
  IRegisterMemberService,
  ISendCancellationNotificationService,
  ISendTrainingReminderService,
  ISubmitRsvpService,
  ISyncAttendanceService,
  ISyncPublicSourceMembersOnOnboardingService,
  IUpdateSubscriptionPreferencesService,
  CancelTrainingSessionService,
  RegisterMemberService,
  SendCancellationNotificationService,
  SendTrainingReminderService,
  SubmitRsvpService,
  SyncAttendanceService,
  SyncPublicSourceMembersOnOnboardingService,
  UpdateSubscriptionPreferencesService,
} from '../application';
import {
  IUpdateRsvpCommentService,
  UpdateRsvpCommentService,
} from '../application/rsvp/UpdateRsvpCommentService';
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
import { SourceTableCache } from '../infrastructure/adapters/SourceTableCache';
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
  syncPublicSourceMembersOnOnboardingService: ISyncPublicSourceMembersOnOnboardingService;
  submitRsvpService: ISubmitRsvpService;
  updateRsvpCommentService: IUpdateRsvpCommentService;
  cancelTrainingSessionService: ICancelTrainingSessionService;
  syncAttendanceService: ISyncAttendanceService;
  sendTrainingReminderService: ISendTrainingReminderService;
  sendCancellationNotificationService: ISendCancellationNotificationService;
}

export interface RuntimeContextOptions {
  sheetGateway?: ISheetGateway;
}

export function createRuntimeContext(options: RuntimeContextOptions = {}): RuntimeContext {
  const sheetGateway = options.sheetGateway ?? new GoogleSheetGateway();
  const configurationProvider = new PrivateSheetConfigurationProvider(sheetGateway);
  const userRepository = new PrivateSheetUserRepository(sheetGateway);
  const sourceTableCache = new SourceTableCache(sheetGateway, configurationProvider);
  const trainingDataRepository = new GoogleSheetTrainingDataRepository(
    sheetGateway,
    configurationProvider,
    userRepository,
    undefined,
    getRuntimeLogger(),
    sourceTableCache,
  );
  const mailNotificationSender = new MailNotificationSender(
    {},
    new MailAppTransport('RSVP System'),
    getRuntimeLogger(),
  );
  const notificationSender = mailNotificationSender;
  const syncAttendanceService = new SyncAttendanceService(trainingDataRepository);
  const publicSourceRepository = new GoogleSheetPublicSourceRepository(sheetGateway, configurationProvider, sourceTableCache);
  const previewPublicSourceRegistrationMatchesService = new PreviewPublicSourceRegistrationMatchesService(publicSourceRepository);
  const registerMemberService = new RegisterMemberService(userRepository);
  const updateSubscriptionPreferencesService = new UpdateSubscriptionPreferencesService(
    userRepository,
    trainingDataRepository,
  );
  const syncPublicSourceMembersOnOnboardingService = new SyncPublicSourceMembersOnOnboardingService(
    configurationProvider,
    publicSourceRepository,
  );
  const submitRsvpService = new SubmitRsvpService(
    trainingDataRepository,
    userRepository,
    syncAttendanceService,
  );
  const updateRsvpCommentService = new UpdateRsvpCommentService(
    trainingDataRepository,
    trainingDataRepository,
    userRepository,
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

  return {
    configurationProvider,
    userRepository,
    trainingDataRepository,
    publicSourceRepository,
    notificationSender,
    previewPublicSourceRegistrationMatchesService,
    registerMemberService,
    updateSubscriptionPreferencesService,
    syncPublicSourceMembersOnOnboardingService,
    submitRsvpService,
    updateRsvpCommentService,
    cancelTrainingSessionService,
    syncAttendanceService,
    sendTrainingReminderService,
    sendCancellationNotificationService,
  };
}