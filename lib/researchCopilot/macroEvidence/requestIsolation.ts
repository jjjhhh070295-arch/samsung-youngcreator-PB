export function macroRequestIdentity(pbId: string, clientId: string) {
  return `${encodeURIComponent(pbId.trim())}:${encodeURIComponent(clientId.trim())}`;
}
export function canApplyMacroResponse(input: {
  aborted: boolean;
  expectedGeneration: number;
  actualGeneration: number;
  expectedIdentity: string;
  actualIdentity: string;
}) {
  return !input.aborted
    && input.expectedGeneration === input.actualGeneration
    && input.expectedIdentity === input.actualIdentity;
}
