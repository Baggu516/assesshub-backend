import { asyncHandler } from '../../utils/asyncHandler.js';
import {
  listResources,
  createResource,
  updateResource,
  deleteResource,
  downloadResource,
} from './learning-resource.service.js';

export const getResources = asyncHandler(async (req, res) => {
  const result = await listResources(req.tenantModels, req.user, req.tenant.orgId, req.query);
  res.json(result);
});

export const postResource = asyncHandler(async (req, res) => {
  const resource = await createResource(
    req.tenantModels,
    req.user,
    req.tenant.orgId,
    req.body,
    req.file
  );
  res.status(201).json({ resource });
});

export const patchResource = asyncHandler(async (req, res) => {
  const resource = await updateResource(
    req.tenantModels,
    req.user,
    req.tenant.orgId,
    req.params.id,
    req.body,
    req.file
  );
  res.json({ resource });
});

export const removeResource = asyncHandler(async (req, res) => {
  const result = await deleteResource(req.tenantModels, req.user, req.tenant.orgId, req.params.id);
  res.json(result);
});

export const getResourceFile = asyncHandler(async (req, res) => {
  const file = await downloadResource(req.tenantModels, req.user, req.tenant.orgId, req.params.id);
  res.setHeader('Content-Type', file.contentType);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${String(file.fileName).replace(/"/g, '')}"`
  );
  res.send(file.buffer);
});
