interface CustomerLastSeenTouchService {
  touchVisitorLastSeen(
    projectId: string,
    customerId: string,
    visitorId: string,
    occurredAt: Date,
  ): Promise<void>;
}

export async function touchLinkedCustomerAfterVisitorMessage(options: {
  projectId: string;
  customerId: string | null;
  visitorId: string;
  occurredAt: Date;
  identityService: CustomerLastSeenTouchService;
  logFailure: (error: unknown) => void;
  onTouched?: (customerId: string) => void;
}): Promise<void> {
  if (!options.customerId) return;
  try {
    await options.identityService.touchVisitorLastSeen(
      options.projectId,
      options.customerId,
      options.visitorId,
      options.occurredAt,
    );
    options.onTouched?.(options.customerId);
  } catch (error) {
    options.logFailure(error);
  }
}
