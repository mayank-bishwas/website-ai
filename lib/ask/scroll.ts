export function shouldAutoScrollToLatest(isNearBottom: boolean, hasNewUserMessage: boolean): boolean {
  return isNearBottom || hasNewUserMessage;
}

