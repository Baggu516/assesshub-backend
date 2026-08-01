export async function logActivity({
  models,
  orgId,
  actorId,
  action,
  resourceType,
  resourceId,
  metadata,
  ip,
}) {
  try {
    const { ActivityLog } = models;
    await ActivityLog.create({
      orgId,
      actorId,
      action,
      resourceType,
      resourceId,
      metadata,
      ip,
    });
  } catch (err) {
    // Audit must never break the primary request
    console.error('[activity]', err?.message || err);
  }
}
