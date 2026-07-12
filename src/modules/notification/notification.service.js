/**
 * List notifications for the authenticated user (newest first).
 */
export async function listNotificationsForUser(models, { orgId, userId, limit = 50 }) {
  return models.Notification.find({ orgId, userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

/**
 * Mark a single notification as read (scoped to the owning user).
 */
export async function markNotificationRead(models, { orgId, userId, notificationId }) {
  await models.Notification.updateOne(
    { _id: notificationId, orgId, userId },
    { $set: { readAt: new Date() } }
  );
}
