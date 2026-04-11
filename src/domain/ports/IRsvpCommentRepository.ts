export interface SaveRsvpCommentRequest {
  memberId: string;
  sessionId: string;
  comment: string;
}

export interface IRsvpCommentRepository {
  saveRsvpComment(request: SaveRsvpCommentRequest): void;
}