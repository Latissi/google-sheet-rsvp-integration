export interface IApplicationService<TRequest, TResult> {
  execute(request: TRequest): TResult;
}