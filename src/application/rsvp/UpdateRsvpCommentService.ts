import { IApplicationService } from '../IApplicationService';
import { IRsvpCommentRepository } from '../../domain/ports/IRsvpCommentRepository';
import { ITrainingDefinitionRepository } from '../../domain/ports/ITrainingDefinitionRepository';
import { IUserRepository } from '../../domain/ports/IUserRepository';

const MAX_RSVP_COMMENT_LENGTH = 300;

export interface UpdateRsvpCommentRequest {
  memberId: string;
  sessionId: string;
  comment: string;
}

export interface UpdateRsvpCommentResult {
  saved: true;
}

export interface IUpdateRsvpCommentService extends IApplicationService<UpdateRsvpCommentRequest, UpdateRsvpCommentResult> {}

export class UpdateRsvpCommentService implements IUpdateRsvpCommentService {
  constructor(
    private readonly commentRepository: IRsvpCommentRepository,
    private readonly trainingDataRepository: ITrainingDefinitionRepository,
    private readonly userRepository: IUserRepository,
  ) {}

  execute(request: UpdateRsvpCommentRequest): UpdateRsvpCommentResult {
    const user = this.userRepository.getUserByMemberId(request.memberId);
    if (!user) {
      throw new Error(`User with memberId "${request.memberId}" not found.`);
    }
    if (!user.roleDefinition.capabilities.canRsvpToTraining) {
      throw new Error(`User with memberId "${request.memberId}" is not allowed to RSVP.`);
    }

    const session = this.trainingDataRepository.getTrainingSessionById(request.sessionId);
    if (!session) {
      throw new Error(`Training session "${request.sessionId}" not found.`);
    }
    if (session.status === 'Cancelled') {
      throw new Error(`Training session "${request.sessionId}" is cancelled.`);
    }

    const trimmedComment = request.comment.trim();
    if (!trimmedComment) {
      throw new Error('RSVP comment must not be empty.');
    }
    if (trimmedComment.length > MAX_RSVP_COMMENT_LENGTH) {
      throw new Error(`RSVP comment must not exceed ${MAX_RSVP_COMMENT_LENGTH} characters.`);
    }

    this.commentRepository.saveRsvpComment({
      memberId: request.memberId,
      sessionId: request.sessionId,
      comment: trimmedComment,
    });

    return { saved: true };
  }
}

export { MAX_RSVP_COMMENT_LENGTH };