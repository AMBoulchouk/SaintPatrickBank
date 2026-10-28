export interface InternalTransferRequestDto {
  readonly sourceAccountId: string;
  readonly destinationIdentifier: string; // Account UUID, 22-digit CVU, or Alias
  readonly amountCents: string; // Serialized integer string cents
  readonly currency: 'ARS';
  readonly clientReferenceId: string;
  readonly description: string;
  readonly metadata?: Record<string, unknown> | undefined;
}
