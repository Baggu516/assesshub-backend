import { asyncHandler } from '../../utils/asyncHandler.js';

export const listNotifications = asyncHandler(async (req, res) => {
  const { Notification } = req.tenantModels;
  const items = await Notification.find({ orgId: req.tenant.orgId, userId: req.user._id })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  res.json({ notifications: items });
});

export const markRead = asyncHandler(async (req, res) => {
  const { Notification } = req.tenantModels;
  await Notification.updateOne(
    { _id: req.params.id, orgId: req.tenant.orgId, userId: req.user._id },
    { $set: { readAt: new Date() } }
  );
  res.status(204).send();
});
