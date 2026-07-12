import { asyncHandler } from '../../utils/asyncHandler.js';
import { listNotificationsForUser, markNotificationRead } from './notification.service.js';

export const listNotifications = asyncHandler(async (req, res) => {
  const notifications = await listNotificationsForUser(req.tenantModels, {
    orgId: req.tenant.orgId,
    userId: req.user._id,
  });
  res.json({ notifications });
});

export const markRead = asyncHandler(async (req, res) => {
  await markNotificationRead(req.tenantModels, {
    orgId: req.tenant.orgId,
    userId: req.user._id,
    notificationId: req.params.id,
  });
  res.status(204).send();
});
