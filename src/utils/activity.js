export async function logActivity({ models, orgId, actorId, action, resourceType, resourceId, metadata, ip }) {
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
}
